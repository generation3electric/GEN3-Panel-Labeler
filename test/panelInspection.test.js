import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHash} from 'node:crypto';
import {AREAS,SYMPTOMS,ageBand,estimateAge,conditionSummary,normalizeInspection} from '../src/inspection/model.js';
import {registerInspectionRoutes,validateInspectionPhotos} from '../inspectionRoutes.js';
import {seal} from '../recallRoutes.js';
import {inspectPhotos} from '../inspectionAI.js';
const now=new Date('2026-09-17T12:00:00Z');
const identity={manufacturer:'Square D',productFamily:'QO',model:'QO130M200',dateCode:'171022',serialNumber:'',plantCode:''};
const evidence={mode:'date_code',component:'enclosure',verified:true};
const pid='p-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const photos=[{id:pid,role:'overview'}];
const complete=()=>({photos:['overview','interior','label','surroundings'].map((role,i)=>({id:`p-${i}`,role})),coverage:Object.fromEntries(Object.keys(AREAS).map(k=>[k,{status:'reviewed'}])),symptoms:Object.fromEntries(Object.keys(SYMPTOMS).map(k=>[k,'no'])),findings:[],identificationReviewed:true});
const finding={id:'ai-first',source:'ai',category:'moisture',title:'Apparent corrosion',observation:'Discoloration is visible on the enclosure.',priority:'repair',status:'pending',photoId:pid,x:50,y:40,reviewNote:'',recommendation:'Arrange an electrician assessment of the affected components.'};
const input=()=>({...complete(),id:'INS-1770000000000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',photos,identity,ageEvidence:evidence,installation:{year:'',evidence:''},panelName:'Test panel',reportReviewed:true,skippedPhotos:{interior:'Not safely accessible',label:'Label missing',surroundings:'Obstructed at this visit'}});

test('age uses verified supported component evidence, never appearance or a breaker date',()=>{
 const r=estimateAge(identity,evidence,now);assert.equal(r.kind,'decoded');assert.equal(r.yearFrom,2017);assert.match(r.label,/week 10/);assert.match(r.sourceUrl,/se.com/);
 for(const e of [{...evidence,verified:false},{...evidence,component:'breaker'},{...evidence,component:'cover'},{mode:'unknown'}])assert.equal(estimateAge(identity,e,now).kind,'unknown');
 for(const i of [{...identity,manufacturer:'Other'},{...identity,model:'QOC30'},{...identity,dateCode:'1710'},{...identity,dateCode:'271022'},{...identity,dateCode:'175422'},{...identity,dateCode:'170022'}])assert.equal(estimateAge(i,evidence,now).kind,'unknown');
});
test('age spectrum keeps legacy/outdated separate from recall and condition',()=>{
 assert.equal(ageBand(1973,1973,now).key,'legacy');
 assert.match(ageBand(1973,1973,now).label,/outdated/i);
 assert.equal(ageBand(1982,1982,now).key,'older');
 assert.equal(ageBand(1995,1995,now).key,'mature');
 assert.equal(ageBand(2015,2015,now).key,'newer');
});
test('documentary age range requires a verified source and remains separate from installation',()=>{
 const ev={mode:'documented_range',yearFrom:'1980',yearTo:'1985',sourceNote:'Manufacturer production records identify this model.',verified:true,sourceUrl:'javascript:alert(1)'};
 assert.equal(estimateAge({},ev,now).kind,'documented_range');assert.equal(estimateAge({},ev,now).sourceUrl,'');
 for(const e of [{...ev,verified:false},{...ev,yearTo:'1970'},{...ev,yearTo:'2027'},{...ev,sourceNote:'Looks old'}])assert.equal(estimateAge({},e,now).kind,'unknown');
});
test('urgent and repair findings remain visible even when scope is incomplete',()=>{
 const r={...complete(),photos:[],findings:[{...finding,status:'confirmed',priority:'urgent'}]};
 assert.equal(conditionSummary(r).condition,'urgent');assert.equal(conditionSummary(r).complete,false);assert.equal(conditionSummary(r).needsOfficeReview,true);
 r.findings[0].priority='repair';assert.equal(conditionSummary(r).condition,'repair');
});
test('pending findings, missing views, unanswered symptoms, and unresolved quality prevent clear status',()=>{
 assert.equal(conditionSummary(complete()).condition,'clear');
 for(const r of [{...complete(),findings:[{...finding,priority:'urgent'}]},{...complete(),photos:[]},{...complete(),coverage:{}},{...complete(),symptoms:{}},{...complete(),identificationReviewed:false},{...complete(),qualityWarnings:[{photoId:pid,reason:'Blurred'}]}])assert.equal(conditionSummary(r).condition,'incomplete');
 const r=complete();r.symptoms.odor='yes';assert.equal(conditionSummary(r).condition,'attention');
 assert.equal(conditionSummary({...complete(),findings:[{...finding,priority:'urgent'}]}).pendingUrgent,true);
});
test('normalization enforces review evidence, preserves AI suggestions, and separates installation evidence',()=>{
 assert.equal(normalizeInspection(input(),photos,null,now).summary.complete,false);
 assert.throws(()=>normalizeInspection({...input(),reportReviewed:false},photos));
 assert.throws(()=>normalizeInspection({...input(),findings:[]},photos,{findings:[finding]}),/instead of deleting/);
 assert.throws(()=>normalizeInspection({...input(),findings:[{...finding,status:'confirmed'}]},photos),/evidence/);
 assert.throws(()=>normalizeInspection({...input(),findings:[{...finding,status:'confirmed',reviewNote:'Confirmed on site',recommendation:''}]},photos),/next step/);
 assert.throws(()=>normalizeInspection({...input(),skippedPhotos:{}},photos),/Photograph/);
 assert.throws(()=>normalizeInspection({...input(),installation:{year:'2020',evidence:''}},photos),/installation year/);
 const r=normalizeInspection({...input(),findings:[{...finding,status:'dismissed',reviewNote:'Surface dirt confirmed during the visit.'}]},photos,{findings:[finding]},now);
 assert.equal(r.originalAnalysis.findings[0].status,'pending');assert.equal(r.findings[0].status,'dismissed');
});
test('inspection photo validation rejects unsupported media, duplicate IDs, and oversized sets',()=>{
 const f={buffer:Buffer.from([255,216,255,224]),mimetype:'image/jpeg',size:4};
 assert.equal(validateInspectionPhotos([f],photos).length,1);
 assert.throws(()=>validateInspectionPhotos([f,f],[photos[0],photos[0]]),/unique/);
 assert.throws(()=>validateInspectionPhotos([{...f,mimetype:'image/gif'}],photos));
 assert.throws(()=>validateInspectionPhotos([{...f,size:61*1024*1024}],photos));
});

test('save binds AI evidence to photos, preserves partial drafts, commits manifest last, and is idempotent',async(t)=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG3sAAAAASUVORK5CYII=','base64');
 const files=new Map(),writes=[],noteCalls=[];let failFile='';
 const app=express();app.use(express.json());
 registerInspectionRoutes(app,{jobNotes:{publish:async(kind,record)=>{assert.ok(files.has(`${record.id}/record.json`));noteCalls.push({kind,record});return {status:'failed',message:'Retry job note'};},get:async()=>({status:'failed'})},getAccessToken:async()=> 'test',getSiteListAndDrive:async()=>({drive:{id:'drive'}}),
 ensureFolder:async(_t,_d,_p,name)=>({id:name,webUrl:'https://example.sharepoint.com/PanelInspections'}),
 graph:async()=>({value:[{folder:{},name:input().id}]}),
 graphBuffer:async(_t,path)=>{const m=path.match(/Panel Inspections\/(INS-[^/]+)\/([^:]+):\/content/),key=m&&`${m[1]}/${m[2]}`;if(!files.has(key))throw Object.assign(new Error('Not found'),{status:404});return files.get(key);},
 uploadFile:async(_t,_d,id,name,bytes)=>{if(name===failFile)throw new Error('Upload interrupted');writes.push(name);files.set(`${id}/${name}`,bytes);}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
 const headers={'x-gen3-employee':Buffer.from(JSON.stringify({id:'staff',name:'Test Technician'})).toString('base64url')};
 const form=(changes={})=>{const f=new FormData();f.append('photos',new Blob([png],{type:'image/png'}),'photo.png');f.append('record',JSON.stringify({...input(),...changes}));return f;};
 const post=(changes={},h=headers)=>fetch(base+'/api/panel-inspections',{method:'POST',headers:h,body:form(changes)});
 assert.equal((await post({},{})).status,401);
 const stale=seal({kind:'inspection-analysis',analysis:{findings:[]},photos:[{...photos[0],sha:'wrong'}]});assert.equal((await post({analysisEvidence:stale})).status,400);
 const signed=seal({kind:'inspection-analysis',analysis:{findings:[finding],qualityWarnings:[]},photos:[{...photos[0],sha:createHash('sha256').update(png).digest('hex')}]});assert.equal((await post({analysisEvidence:signed})).status,400);
 failFile='report.pdf';assert.equal((await post()).status,500);assert.equal(files.has(`${input().id}/record.json`),false);
 failFile='';const response=await post();assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.reviewedBy.name,'Test Technician');assert.equal(writes.at(-1),'record.json');assert.equal(saved.age.yearFrom,2017);assert.equal(saved.jobNote.status,'failed');assert.equal(noteCalls.length,1);
 const noteResponse=await fetch(base+`/api/panel-inspections/${saved.id}/job-note`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({job:{serviceTitanId:'wrong-job'}})});assert.equal((await noteResponse.json()).status,'failed');assert.equal(noteCalls.length,2);assert.equal(noteCalls[1].record.job,null);
 assert.equal((await (await fetch(base+`/api/panel-inspections/${saved.id}/job-note`)).json()).status,'failed');
 const count=writes.length;assert.equal((await post()).status,200);assert.equal(writes.length,count);assert.equal((await post({notes:'Changed'})).status,409);
 const pdf=await fetch(base+saved.pdfUrl);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.ok(Buffer.from(await pdf.arrayBuffer()).toString('ascii',0,5)==='%PDF-');
 assert.equal((await (await fetch(base+'/api/panel-inspections')).json()).records.length,1);
 assert.equal((await fetch(base+saved.photos[0].url)).status,200);
 assert.equal((await fetch(base+`/api/panel-inspections/${input().id}/photos/p-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png`)).status,404);
 const otherId='INS-1770000000001-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 const oldRecall=seal({version:1,notices:[],identification:identity,checkedAt:'2020-01-01'});assert.equal((await post({id:otherId,recallEvidence:oldRecall})).status,400);
 const mismatch=seal({version:1,notices:[],identification:{...identity,model:'Other'},checkedAt:new Date().toISOString()});assert.equal((await post({id:otherId,recallEvidence:mismatch})).status,400);
});
test('AI review suggestions are unverified and tied to supplied photo evidence',async(t)=>{
 const originalFetch=global.fetch,oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-key';t.after(()=>{global.fetch=originalFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;});
 let request;global.fetch=async(_url,opts)=>{request=JSON.parse(opts.body);return new Response(JSON.stringify({model:'test',output_text:JSON.stringify({identity,dateCodeComponent:'enclosure',findings:[{...finding,status:'confirmed'}],qualityWarnings:[]})}));};
 const r=await inspectPhotos([{buffer:Buffer.from([255,216,255,224]),mimetype:'image/jpeg'}],photos);
 assert.equal(r.findings[0].status,'pending');assert.equal(r.findings[0].source,'ai');assert.equal(r.findings[0].photoId,pid);assert.match(request.input[0].content[0].text,/Never estimate age from appearance/);
});
