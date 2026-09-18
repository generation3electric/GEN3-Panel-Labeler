import { normalizePhotoSource } from './src/sharedPhotoModel.js';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { seal, unseal, validateImages } from './recallRoutes.js';
import { inspectPhotos } from './inspectionAI.js';
import { normalizeInspection, text, ROLES } from './src/inspection/model.js';
import { createInspectionPdf } from './inspectionReport.js';
const idPattern=/^INS-\d{13}-[0-9a-f-]{36}$/;
const photoIdPattern=/^p-[0-9a-f-]{36}$/;
const upload=multer({storage:multer.memoryStorage(),limits:{files:10,fileSize:12*1024*1024,fields:2,fieldSize:2*1024*1024}}).array('photos',10);
const activeSaves=new Set();
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function parse(req){try{return JSON.parse(req.body.record);}catch{fail('The inspection form could not be read.');}}
function user(req){try{const u=JSON.parse(Buffer.from(req.headers['x-gen3-employee']||'','base64url').toString());if(u.id&&u.name)return {id:String(u.id),name:String(u.name),email:String(u.email||'')};}catch{}fail('Sign in with your GEN3 account before saving.',401);}
export function validateInspectionPhotos(files,manifest){
 if(!Array.isArray(manifest)||!files?.length||files.length>10||files.length!==manifest.length)fail('Use one to ten inspection photos.');
 if(files.reduce((sum,f)=>sum+f.size,0)>60*1024*1024)fail('Inspection photos must total less than 60 MB.');
 for(const f of files){validateImages([f]);if(!['image/jpeg','image/png'].includes(f.mimetype))fail('Inspection reports require JPEG or PNG images.');}
 if(new Set(manifest.map(p=>p.id)).size!==manifest.length)fail('Photo IDs must be unique.');
 for(const p of manifest)if(!photoIdPattern.test(p.id)||!ROLES[p.role])fail('Invalid inspection photo.');
 return manifest.map(p=>({id:p.id,role:p.role,...(p.source?{source:normalizePhotoSource(p.source)}:{})}));
}
function photoHashes(files,manifest){return files.map((f,i)=>({id:manifest[i].id,role:manifest[i].role,sha:createHash('sha256').update(f.buffer).digest('hex')}));}
export function registerInspectionRoutes(app,storage){
 const {getAccessToken,getSiteListAndDrive,graph,graphBuffer,ensureFolder,uploadFile,jobNotes}=storage;
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','private, no-store');try{await fn(req,res);}catch(e){console.warn('Panel inspection:',e.message);res.status(e.status||500).json({error:e.status?e.message:'Inspection could not finish saving. Your photos have not been cleared; retry in a moment.'});}};
 const multipart=(req,res,next)=>upload(req,res,e=>e?res.status(400).json({error:'Use up to ten JPEG/PNG photos under 12 MB each.'}):next());
 async function context(){const token=await getAccessToken();const {drive}=await getSiteListAndDrive(token);return {token,drive};}
 function prefix(ctx,id){if(!idPattern.test(id))fail('Invalid inspection ID.');return `/drives/${ctx.drive.id}/root:/Panel Inspections/${id}`;}
 async function read(ctx,id){return JSON.parse((await graphBuffer(ctx.token,`${prefix(ctx,id)}/record.json:/content`)).toString());}
 app.post('/api/panel-inspections/analyze',multipart,wrap(async(req,res)=>{
   const input=parse(req),manifest=validateInspectionPhotos(req.files,input.photos);
   const analysis=await inspectPhotos(req.files,manifest);
   const token=seal({kind:'inspection-analysis',analysis,photos:photoHashes(req.files,manifest)});
   res.json({analysis,analysisEvidence:token});
 }));
 app.post('/api/panel-inspections',multipart,wrap(async(req,res)=>{
   const reviewer=user(req),input=parse(req);if(!idPattern.test(input.id))fail('Invalid inspection ID.');
   if(activeSaves.has(input.id))fail('This inspection is still saving. Wait a moment and retry.',409);
   activeSaves.add(input.id);
   try{
     const manifest=validateInspectionPhotos(req.files,input.photos),hashes=photoHashes(req.files,manifest);
     let analysis=null;
     if(input.analysisEvidence){const evidence=unseal(input.analysisEvidence);if(evidence.kind!=='inspection-analysis'||JSON.stringify(evidence.photos)!==JSON.stringify(hashes))fail('Photos changed after AI review. Review the current photos again or restart with a manual inspection.');analysis=evidence.analysis;}
     const data=normalizeInspection(input,manifest,analysis);
     let recall=null;
     if(input.recallEvidence){const snapshot=unseal(input.recallEvidence);if(snapshot.version!==1||!Array.isArray(snapshot.notices)||!Number.isFinite(Date.parse(snapshot.checkedAt)))fail('Invalid recall evidence. Run the recall check again.');
       if(Date.now()-Date.parse(snapshot.checkedAt)>86400000)fail('The recall search is more than 24 hours old. Recheck before saving.');
       for(const key of Object.keys(data.identity))if(text(snapshot.identification?.[key],200)!==data.identity[key])fail('Label details changed after the recall lookup. Run the recall check again.');
       recall=snapshot;
     }
     const fingerprint=createHash('sha256').update(JSON.stringify({data,recall,hashes})).digest('hex');
     const ctx=await context();
     try{const existing=await read(ctx,input.id);if(existing.fingerprint!==fingerprint)fail('This inspection was already saved with different details. Open history or start a new inspection.',409);return res.json({...existing,jobNote:await jobNotes?.publish('inspection',existing)});}catch(e){if(e.status!==404)throw e;}
     const root=await ensureFolder(ctx.token,ctx.drive.id,null,'Panel Inspections');
     const folder=await ensureFolder(ctx.token,ctx.drive.id,root.id,input.id);
     const photos=[];
     for(let i=0;i<req.files.length;i++){const file=req.files[i],p=manifest[i],name=`${p.id}.${file.mimetype==='image/png'?'png':'jpg'}`;await uploadFile(ctx.token,ctx.drive.id,folder.id,name,file.buffer);photos.push({...p,name,url:`/api/panel-inspections/${input.id}/photos/${name}`});}
     const record={...data,id:input.id,fingerprint,photos,recall,reviewedBy:reviewer,savedAt:new Date().toISOString(),folderUrl:folder.webUrl,pdfUrl:`/api/panel-inspections/${input.id}/report.pdf`};
     const pdf=await createInspectionPdf(record,req.files.map((f,i)=>({id:manifest[i].id,buffer:f.buffer})));
     const pdfFile=await uploadFile(ctx.token,ctx.drive.id,folder.id,'report.pdf',pdf);
     record.reportUrl=pdfFile?.webUrl;
     await uploadFile(ctx.token,ctx.drive.id,folder.id,'record.json',Buffer.from(JSON.stringify(record,null,2)));
     res.status(201).json({...record,jobNote:await jobNotes?.publish('inspection',record)});
   }finally{activeSaves.delete(input.id);}
 }));
 app.get('/api/panel-inspections',wrap(async(req,res)=>{
   const ctx=await context();let pathname=`/drives/${ctx.drive.id}/root:/Panel Inspections:/children?$select=id,name,folder&$orderby=name%20desc&$top=20`;
   if(req.query.cursor){const c=unseal(req.query.cursor);if(c.kind!=='inspection-history'||c.drive!==ctx.drive.id)fail('Invalid history page.');pathname=c.path;}
   let page;try{page=await graph(ctx.token,pathname);}catch(e){if(e.status===404&&!req.query.cursor)return res.json({records:[],next:null,incomplete:0});throw e;}
   const folders=page.value.filter(f=>f.folder&&idPattern.test(f.name)),records=[];let incomplete=0;
   for(let i=0;i<folders.length;i+=5){const results=await Promise.allSettled(folders.slice(i,i+5).map(f=>read(ctx,f.name)));for(const r of results){if(r.status==='rejected'){incomplete++;continue;}const v=r.value;records.push({id:v.id,panelName:v.panelName,job:v.job,identity:v.identity,age:v.age,summary:v.summary,savedAt:v.savedAt,reviewedBy:v.reviewedBy.name});}}
   let next=null;if(page['@odata.nextLink']){const u=new URL(page['@odata.nextLink']);if(u.origin!=='https://graph.microsoft.com'||!u.pathname.startsWith('/v1.0/'))fail('Invalid history continuation.',502);next=seal({kind:'inspection-history',drive:ctx.drive.id,path:u.pathname.slice(5)+u.search});}
   res.json({records,next,incomplete});
 }));
 app.get('/api/panel-inspections/:id',wrap(async(req,res)=>res.json(await read(await context(),req.params.id))));
 for(const method of ['get','post']) app[method]('/api/panel-inspections/:id/job-note',wrap(async(req,res)=>{
   const record=await read(await context(),req.params.id);
   res.json(await jobNotes[method==='post'?'publish':'get']('inspection',record));
 }));
 app.get('/api/panel-inspections/:id/report.pdf',wrap(async(req,res)=>{const ctx=await context();await read(ctx,req.params.id);const bytes=await graphBuffer(ctx.token,`${prefix(ctx,req.params.id)}/report.pdf:/content`);res.type('pdf').set('Content-Disposition',`inline; filename="${req.params.id}-report.pdf"`).send(bytes);}));
 app.get('/api/panel-inspections/:id/photos/:name',wrap(async(req,res)=>{if(!/^p-[0-9a-f-]{36}\.(jpg|png)$/.test(req.params.name))fail('Invalid photo.');const ctx=await context(),record=await read(ctx,req.params.id);if(!record.photos.some(p=>p.name===req.params.name))fail('Photo not found.',404);const bytes=await graphBuffer(ctx.token,`${prefix(ctx,req.params.id)}/${req.params.name}:/content`);res.set('X-Content-Type-Options','nosniff').type(req.params.name.endsWith('png')?'png':'jpg').send(bytes);}));
}
