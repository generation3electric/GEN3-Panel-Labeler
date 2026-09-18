import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotice, candidateFor, checkRecalls, applyDecisions, fetchCpscQuery, brandAliases } from '../recallCheck.js';
import { seal, unseal, validateImages, registerRecallRoutes } from '../recallRoutes.js';
import express from 'express';

const raw = { RecallID: 22159, RecallNumber: '22159', Title: 'Schneider Electric Recalls Electrical Panels', URL: 'https://www.cpsc.gov/Recalls/2022/example', RecallDate: '2022-06-16', Description: 'Square D QO model QO130M200PRB manufactured with date codes between 200561 and 220233. Plant code 15.', Products: [{ Name: 'Square D QO Load Centers' }], Manufacturers: [{ Name: 'Schneider Electric' }], Hazards: [{Name:'Overheating'}], Remedies: [{Name:'Contact the manufacturer.'}] };
const notice = normalizeNotice(raw);
const identity = { manufacturer: 'Square D', model: 'QO130M200PRB' };
const fetchQuery = async () => ({ notices: [notice], source: { url: 'https://www.saferproducts.gov/RestWebServices/Recall?format=json', retrievedAt: new Date().toISOString(), count: 1 } });
const decision = { outcome: 'matched', product: true, production: true, exclusions: true, note: 'Model and actual date/plant code verified against official manufacturer instructions.' };

test('brand/model match remains possible and asks for missing production identifiers', async () => {
  const r = await checkRecalls(identity, { fetchQuery });
  assert.equal(r.status, 'possible'); assert.equal(r.notices.length, 1);
  assert.equal(r.notices[0].modelFound, true); assert.deepEqual(r.notices[0].missing, ['dateCode', 'plantCode']);
  const full = await checkRecalls({ ...identity, dateCode:'210111', plantCode:'15' }, {fetchQuery});
  assert.equal(full.status, 'possible');
});
test('missing manufacturer never performs a lookup or returns no match', async () => {
  const r = await checkRecalls({model:'QO130M200PRB'}, {fetchQuery: () => { throw new Error('Must not be called'); }});
  assert.equal(r.status,'unable'); assert.deepEqual(r.sources, []);
});
test('unknown model and an empty successful search stays unable; known identifiers get scoped no-match', async () => {
  const empty = async () => ({ notices: [], source: {url:'https://www.saferproducts.gov/',count:0} });
  assert.equal((await checkRecalls({manufacturer:'Eaton',model:'Unknown'}, {fetchQuery:empty})).status,'unable');
  assert.equal((await checkRecalls({manufacturer:'Eaton',model:'BR123'}, {fetchQuery:empty})).status,'no_match');
});
test('one failed query makes entire lookup incomplete even with other successful queries', async () => {
  let n = 0;
  const r = await checkRecalls(identity, {fetchQuery: async () => { if (++n === 1) throw new Error('timeout'); return fetchQuery(); }});
  assert.equal(r.status,'unable'); assert.equal(r.errors.length,1); assert.equal(r.notices.length,1);
  assert.equal(applyDecisions(r, {[notice.id]:{...decision,outcome:'excluded'}}).status,'unable');
  assert.equal(applyDecisions({...r,identification:{...r.identification,dateCode:'210111',plantCode:'15'}}, {[notice.id]:decision}).lookupIncomplete,true);
});
test('combined and legal manufacturer names resolve to known aliases', () => {
  assert.ok(brandAliases('Eaton / Cutler-Hammer').includes('Eaton'));
  assert.ok(brandAliases('Schneider Electric USA Inc.').includes('Square D'));
  assert.ok(brandAliases('Federal Pacific Electric FPE').includes('Federal Pacific'));
});

test('short brand aliases and model tokens do not match inside unrelated words', () => {
  assert.equal(candidateFor({...notice,manufacturers:'Other',description:'A large panel',title:'Large electrical panels',products:[{name:'Electrical panels'}]}, {manufacturer:'GE',model:'QO13'}),null);
  assert.equal(candidateFor(notice, {...identity,model:'QO130'}).modelFound,false);
});
test('malformed, overbroad, failed or unofficial recall feeds are rejected', async () => {
  for (const body of ['<html>error</html>', '{}', JSON.stringify([{ ...raw, URL:'https://attacker.invalid/' }]), JSON.stringify(Array(3000).fill(raw))]) {
    await assert.rejects(fetchCpscQuery({Manufacturer:'X'},{fetchImpl: async () => new Response(body)}));
  }
  await assert.rejects(fetchCpscQuery({}, {fetchImpl: async () => new Response('', {status:503})}));
});
test('confirmed findings require all criteria and documented evidence; all exclusions yield scoped no-match', async () => {
  const snapshot = await checkRecalls({...identity,dateCode:'210111',plantCode:'15'}, {fetchQuery});
  assert.throws(() => applyDecisions(snapshot,{[notice.id]:{outcome:'matched'}}));
  assert.throws(() => applyDecisions(snapshot,{[notice.id]:{...decision,production:false}}));
  assert.throws(() => applyDecisions(snapshot,{[notice.id]:{...decision,note:'yes'}}));
  assert.throws(() => applyDecisions({...snapshot,identification:identity},{[notice.id]:decision}));
  assert.equal(applyDecisions(snapshot,{[notice.id]:decision}).status,'matched');
  assert.equal(applyDecisions(snapshot,{[notice.id]:{...decision,outcome:'excluded'}}).status,'no_match');
  assert.equal(applyDecisions(snapshot,{}).status,'possible');
  assert.throws(() => applyDecisions({...snapshot,identification:{manufacturer:'Square D',model:''}},{[notice.id]:decision}));
});
test('lookup evidence cannot be changed between official lookup and save', () => {
  const evidence = seal({status:'possible'});
  assert.equal(unseal(evidence).status,'possible');
  assert.throws(() => unseal(evidence.replace(evidence.split('.')[0],Buffer.from('{"status":"no_match"}').toString('base64url'))));
  assert.throws(() => unseal('bad.signature'));
});
test('image uploads require genuine supported headers and an overview', () => {
  const file = {buffer:Buffer.from([255,216,255,224]),mimetype:'image/jpeg',fieldname:'overview',size:4};
  assert.doesNotThrow(() => validateImages([file],true));
  assert.throws(() => validateImages([{...file,fieldname:'label'}],true));
  assert.throws(() => validateImages([{...file,buffer:Buffer.from('<svg></svg>')}],true));
  assert.throws(() => validateImages([{...file,size:46*1024*1024}],true));
});

test('saved history is independent, photos write before manifest, retries are idempotent, and partial uploads do not save', async (t) => {
  const files = new Map(); let failPhoto = false; const writes = []; const noteCalls = [];
  const notFound = () => Object.assign(new Error('Not found'), {status:404});
  const app = express(); app.use(express.json());
  registerRecallRoutes(app, {
    jobNotes:{publish:async(kind,record)=>{assert.ok(files.has(`${record.id}/record.json`));noteCalls.push({kind,record});return {status:'failed',message:'Retry job note'};},get:async()=>({status:'failed'})},
    getAccessToken:async () => 'test', getSiteListAndDrive:async () => ({drive:{id:'drive'}}),
    graph:async () => ({value:[]}), ensureFolder:async (_t,_d,_p,name) => ({id:name,webUrl:'https://example.sharepoint.com/RecallChecks'}),
    graphBuffer:async (_t,path) => { const match = path.match(/Recall Checks\/(RC-[^/]+)\/([^:]+):\/content/); const key=match && `${match[1]}/${match[2]}`; if (!files.has(key)) throw notFound(); return files.get(key); },
    uploadFile:async (_t,_d,id,name,buffer) => { if (failPhoto && name.startsWith('photo')) throw new Error('Upload failure'); writes.push(name); files.set(`${id}/${name}`,buffer); },
  });
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await checkRecalls(identity, {fetchQuery});
  const input = { id:'RC-1770000000000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', evidence:seal(snapshot), decisions:{}, labelUnavailable:'Label damaged', panelName:'Main Panel'};
  const user = Buffer.from(JSON.stringify({id:'employee',name:'Test Employee'})).toString('base64url');
  const form = (overrides={}) => { const f=new FormData();f.append('overview',new Blob([Buffer.from([255,216,255,224])],{type:'image/jpeg'}),'overview.jpg');f.append('record',JSON.stringify({...input,...overrides}));return f; };
  let r=await fetch(base+'/api/recall-checks',{method:'POST',body:form()});assert.equal(r.status,401);
  r=await fetch(base+'/api/recall-checks',{method:'POST',headers:{'x-gen3-employee':user},body:form()});assert.equal(r.status,201);
  const saved=await r.json();assert.equal(saved.status,'possible');assert.equal(saved.checkedBy.name,'Test Employee');assert.equal(writes.at(-1),'record.json');assert.equal(saved.jobNote.status,'failed');assert.equal(noteCalls.length,1);
  const noteResponse=await fetch(base+`/api/recall-checks/${saved.id}/job-note`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({job:{serviceTitanId:'wrong-job'}})});assert.equal((await noteResponse.json()).status,'failed');assert.equal(noteCalls.length,2);assert.equal(noteCalls[1].record.job,null);
  assert.equal((await (await fetch(base+`/api/recall-checks/${saved.id}/job-note`)).json()).status,'failed');
  const count=writes.length;
  r=await fetch(base+'/api/recall-checks',{method:'POST',headers:{'x-gen3-employee':user},body:form()});assert.equal(r.status,200);assert.equal(writes.length,count);
  r=await fetch(base+'/api/recall-checks',{method:'POST',headers:{'x-gen3-employee':user},body:form({notes:'Changed after save'})});assert.equal(r.status,409);
  r=await fetch(base+`/api/recall-checks/${input.id}`);assert.equal((await r.json()).id,input.id);
  failPhoto=true;const newId='RC-1770000000001-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  r=await fetch(base+'/api/recall-checks',{method:'POST',headers:{'x-gen3-employee':user},body:form({id:newId})});assert.equal(r.status,500);assert.equal(files.has(`${newId}/record.json`),false);
  failPhoto=false;
  const source={kind:'inspection',recordId:'INS-source',photoKey:'p-overview',sourceDate:'2025-01-01',reusedAt:'2026-09-18',currentConditionConfirmed:true};
  const reused=await fetch(base+'/api/recall-checks',{method:'POST',headers:{'x-gen3-employee':user},body:form({id:'RC-1770000000002-cccccccc-cccc-cccc-cccc-cccccccccccc',photoSources:[{role:'label',source:{...source,photoKey:'wrong'}},{role:'overview',source}]})});
  assert.equal(reused.status,201);assert.deepEqual((await reused.json()).photos[0].source,source);

});
