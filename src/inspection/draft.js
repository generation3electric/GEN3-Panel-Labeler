export async function inspectionDraft(action, value) {
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('gen3-panel-inspections',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',action==='get'?'readonly':'readwrite'),store=tx.objectStore('drafts');const r=action==='get'?store.get('active'):action==='delete'?store.delete('active'):store.put(value,'active');tx.oncomplete=()=>{db.close();resolve(r.result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Draft not saved'));};});
}
export async function preparePhoto(file) {
 if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
 if(file.size>25*1024*1024)throw new Error('Use a photo under 25 MB.');
 const url=URL.createObjectURL(file);
 try{
  const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not be opened. Export it as JPEG or take another photo.'));image.src=url;});
  const scale=Math.min(1,3000/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.93));if(!blob)throw new Error('The photo could not be prepared. Try another image.');
  return new File([blob],'inspection-photo.jpg',{type:'image/jpeg'});
 }finally{URL.revokeObjectURL(url);}
}
