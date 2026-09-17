import PDFDocument from 'pdfkit';
import { CONDITIONS, AREAS, ROLES, SYMPTOMS, PRIORITIES } from './src/inspection/model.js';
import { STATUS_LABELS } from './recallCheck.js';

export function createInspectionPdf(record, photos) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'LETTER',margin:45,bufferPages:true,info:{Title:`GEN3 Panel Inspection - ${record.panelName}`,Author:'GEN3 Electric & HVAC'}});
    const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const width=522;
    const clean=s=>String(s??'').replace(/[\u0000-\u0008]/g,'').replace(/[–—]/g,'-');
    function block(value,{size=10,bold=false,color='#243c53',gap=8}={}){
      const s=clean(value);doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);
      const height=doc.heightOfString(s,{width});if(doc.y+height>720)doc.addPage();
      doc.fillColor(color).text(s,{width});doc.y+=gap;
    }
    function heading(title){if(doc.y>650)doc.addPage();block(title,{size:15,bold:true,gap:10});}
    block('GEN3 ELECTRIC & HVAC',{size:13,bold:true});
    block('Panel Inspection',{size:25,bold:true});
    block('First version - technician-reviewed visual report',{size:10});
    block(`${record.panelName}\n${record.job?.customer || 'Standalone inspection'}${record.job?.id?` - Job #${record.job.id}`:''}\n${record.job?.address || ''}`,{size:12});
    block(`Reviewed by ${record.reviewedBy.name}\nSaved ${new Date(record.savedAt).toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern\nRecord ${record.id}`);
    heading(CONDITIONS[record.summary.condition]);
    block(record.summary.complete?'Recorded visual scope reviewed.':'INCOMPLETE SCOPE - see missing views, pending findings and inspection limits below.',{bold:true,color:record.summary.complete?'#243c53':'#854b15'});
    if(record.summary.pendingUrgent)block('An unverified urgent AI/technician concern still needs prompt review.',{bold:true,color:'#902b23'});
    block(record.scope);
    heading('Identification and manufacturing age');
    block(record.identificationReviewed?'Label readings reviewed by technician.':'Label readings NOT YET reviewed.',{bold:true});
    block(`Manufacturer: ${record.identity.manufacturer || 'Unknown'}\nFamily: ${record.identity.productFamily || 'Unknown'}\nPanel model: ${record.identity.model || 'Unknown'}\nSerial: ${record.identity.serialNumber || 'Unavailable'}\nDate code: ${record.identity.dateCode || 'Unavailable'}`);
    block(`${record.age.label}${record.age.ageLabel?`\n${record.age.ageLabel}`:''}`,{bold:true});
    block(`${record.age.reason}\n${record.age.evidence || ''}`);
    if(record.age.sourceUrl)block(`Age reference: ${record.age.sourceUrl}`,{size:9});
    block(record.installation.year?`Installation year: ${record.installation.year}\nInstallation evidence: ${record.installation.evidence}`:'Installation date: unknown. Manufacturing age does not establish time in service.');
    heading('Recall search');
    if(record.recall){block(`${STATUS_LABELS[record.recall.status]}\nChecked ${record.recall.checkedAt}\n${record.recall.message}`);block(record.recall.scope,{size:9});for(const n of record.recall.notices)block(`Recall #${n.number}: ${n.title}\n${n.url}`,{size:9});}
    else block('Not checked as part of this inspection. No recall clearance is implied.');
    heading('Reported symptoms');
    for(const [key,label] of Object.entries(SYMPTOMS))block(`${label}: ${record.symptoms[key] || 'Not recorded'}`,{gap:3});
    if(record.symptomNotes)block(record.symptomNotes);
    heading('Inspection scope');
    for(const [key,label] of Object.entries(AREAS)){const area=record.coverage[key];block(`${label}: ${area.status==='reviewed'?'Reviewed':area.status==='not_inspected'?'Not inspected':'Pending'}${area.reason?` - ${area.reason}`:''}`,{gap:5});}
    for(const role of record.summary.missingPhotos)block(`Missing ${ROLES[role]}: ${record.skippedPhotos[role] || 'Not recorded'}`,{gap:4});
    for(const w of record.qualityWarnings)block(`Photo limitation (${record.photos.find(p=>p.id===w.photoId)?.role || w.photoId}): ${w.reason}\nTechnician response: ${record.qualityReviews[w.photoId] || 'Not reviewed'}`,{gap:6});
    heading('Findings and next steps');
    const visible=record.findings.filter(f=>f.status!=='dismissed');
    if(!visible.length)block('No concerns were recorded in the reviewed scope. Unseen or untested conditions remain outside this report.');
    for(const f of visible){const number=record.findings.indexOf(f)+1;block(`${number}. ${f.title}`,{size:12,bold:true});block(`${f.status==='confirmed'?'Technician confirmed':'UNVERIFIED - further review needed'} | ${PRIORITIES[f.priority]}`,{bold:true});block(`Observed: ${f.observation}\nNext step: ${f.recommendation || 'Technician follow-up needed.'}\nReview evidence: ${f.reviewNote || 'Pending'}`);}
    if(record.notes){heading('Technician notes');block(record.notes);}
    block(record.summary.needsOfficeReview?'Office review requested / needed.':'No office review requested.',{bold:true});
    for(const photo of record.photos){
      doc.addPage();heading(ROLES[photo.role]);
      const bytes=photos.find(p=>p.id===photo.id)?.buffer;if(!bytes)throw new Error('A report photo is missing.');
      const img=doc.openImage(bytes);const scale=Math.min(width/img.width,430/img.height);const w=img.width*scale,h=img.height*scale;const x=45+(width-w)/2,y=doc.y+6;
      doc.image(bytes,x,y,{width:w,height:h});
      const markers=visible.filter(f=>f.photoId===photo.id && f.x!==null && f.y!==null);
      for(const f of markers){const px=x+w*f.x/100,py=y+h*f.y/100;doc.save().circle(px,py,10).fill('#0c294a');doc.font('Helvetica-Bold').fontSize(10).fillColor('white').text(String(record.findings.indexOf(f)+1),px-10,py-4,{width:20,align:'center',lineBreak:false});doc.restore();}
      doc.x=45;doc.y=y+h+18;block('Numbered markers locate recorded observations. Unverified findings still need technician review.',{size:9});
      for(const f of markers)block(`${record.findings.indexOf(f)+1}. ${f.title} (${f.status==='confirmed'?'confirmed':'unverified'})`,{size:9,gap:4});
    }
    const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#61768a').text(`GEN3 Panel Inspection | ${i+1} of ${range.count}`,45,733,{width,lineBreak:false,align:'right'});}
    doc.end();
  });
}
