import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRole, roleFromFilename, matchingJob, suggestAssignments, validateAssignments, fillMissing, normalizePhotoSource } from '../src/sharedPhotoModel.js';
import { sourceDetails, importPhotos } from '../src/sharedPhotoLibrary.js';

test('all three workflows suggest shared overview and label photos but do not infer breaker coverage', () => {
  for (const source of ['directory','recall','inspection']) for (const target of ['directory','recall','inspection']) {
    const record = {kind:source,photos:[{key:'a',role:'overview'},{key:'b',role:'label'},{key:'c',role:'interior'}]};
    const roles = suggestAssignments(record,target);
    assert.equal(roles.a,'overview');assert.equal(roles.b,'label');
    if(source!==target)assert.equal(roles.c,'');
  }
  assert.equal(roleFromFilename('80-manufacturer.jpg'),'label');assert.equal(roleFromFilename('11-left-2.jpg'),'left');assert.equal(canonicalRole('right-3'),'right');
  assert.deepEqual(suggestAssignments({kind:'directory',photos:[{key:'left',role:'left'},{key:'right',role:'right'}]},'inspection'),{left:'',right:''});
});
test('existing photos are preserved, duplicates and limits are blocked, repeatable sides work', () => {
  const source = {kind:'recall',photos:[{key:'1',role:'overview'},{key:'2',role:'label'},{key:'3',role:'label'}]};
  assert.deepEqual(suggestAssignments(source,'inspection',[{role:'overview'}]),{'1':'','2':'label','3':''});
  assert.throws(()=>validateAssignments('inspection',source.photos,{'1':'overview'},[{role:'overview'}]),/already filled/);
  assert.throws(()=>validateAssignments('inspection',source.photos,{'2':'label','3':'label'}),/already filled/);
  assert.throws(()=>validateAssignments('recall',[{key:'1'}],{'1':'detail'},Array(4).fill({role:'detail'})),/four detail/);
  assert.throws(()=>validateAssignments('inspection',[{key:'1'}],{'1':'detail'},Array(10).fill({role:'detail'})),/10 photos/);
  assert.throws(()=>validateAssignments('recall',[{key:'1'}],{'1':'left'}),/valid photo/);
  assert.equal(validateAssignments('directory',[{key:'1'},{key:'2'}],{'1':'left','2':'left'}).length,2);
});
test('job matches never use customer names or addresses and distinct job IDs remain distinct', () => {
  assert.equal(matchingJob({serviceTitanId:'123'},{serviceTitanId:123}),true);
  assert.equal(matchingJob({id:'42',serviceTitanId:'123'},{id:'42',serviceTitanId:'456'}),false);
  assert.equal(matchingJob({customer:'Same person',address:'Same house'},{customer:'Same person',address:'Same house'}),false);
  assert.equal(matchingJob(null,{id:'42'}),false);
  assert.equal(matchingJob({id:'LOC-1'},{id:'LOC-1'}),true);
});
test('prefill retains entered identifiers and source references cannot copy review status or arbitrary URLs', () => {
  assert.deepEqual(fillMissing({manufacturer:'Unknown',model:'User entered',serial:''},{manufacturer:'Eaton',model:'Old model',serial:'123',reviewed:true}),{manufacturer:'Eaton',model:'User entered',serial:'123'});
  const source = normalizePhotoSource({kind:'inspection',recordId:'x',photoKey:'p',sourceDate:'2020-01-01',reusedAt:'2026-09-18',currentConditionConfirmed:true,url:'https://evil.test',status:'verified'});
  assert.equal(source.sourceDate,'2020-01-01');assert.equal(source.url,undefined);assert.equal(source.status,undefined);
  assert.equal(normalizePhotoSource({kind:'unknown'}),undefined);
});
test('directory source reads actual saved photo manifest and retains original photo provenance', async t => {
  const original=global.fetch;t.after(()=>global.fetch=original);
  const origin={kind:'recall',recordId:'RC-old',sourceDate:'2020-01-01'};
  global.fetch=async url=>new Response(JSON.stringify(url.endsWith('/photos')?{photos:[{id:'file1',name:'80-manufacturer.jpg',url:'/api/sharepoint/panel-records/7/photos/file1'}]}:{record:{job:{serviceTitanId:'100'},panel:{name:'Garage'},photoSteps:[{filename:'80-manufacturer.jpg',source:origin}]}}),{headers:{'content-type':'application/json'}});
  const source=await sourceDetails({kind:'directory',id:'7',recordId:'PNL-7'});
  assert.equal(source.photos[0].role,'label');assert.equal(source.panelName,'Garage');assert.equal(source.photos[0].source.sourceDate,'2020-01-01');
});
test('photo imports refuse arbitrary URLs and failed downloads without applying a partial draft', async t => {
  const original=global.fetch;t.after(()=>global.fetch=original);let calls=0;
  global.fetch=async()=>{calls++;return new Response('',{status:503});};
  await assert.rejects(importPhotos({kind:'inspection',photos:[{key:'p',url:'https://evil.test/photo'}]},'recall',{p:'overview'},[]),/invalid/);
  assert.equal(calls,0);
  await assert.rejects(importPhotos({kind:'inspection',photos:[{key:'p',url:'/api/panel-inspections/INS-1/photos/a.jpg'}]},'recall',{p:'overview'},[]),/could not be downloaded/);
  assert.equal(calls,1);
});
