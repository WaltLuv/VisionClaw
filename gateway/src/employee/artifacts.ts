import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {Store,type Row} from './db.js';
import {dataDir} from './config.js';
export async function saveAttachment(db:Store,owner:string,bytes:Buffer,name:string,hint=''){
 if(!bytes.length||bytes.length>20*1024*1024)throw Error('Choose a file under 20 MB');let mime='',data=bytes;
 if(bytes[0]===255&&bytes[1]===216||bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){data=await sharp(bytes,{limitInputPixels:25000000,failOn:'warning'}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();mime='image/jpeg';}
 else if(bytes.subarray(0,5).toString()==='%PDF-')mime='application/pdf';
 else if(bytes.subarray(4,8).toString()==='ftyp')mime='video/mp4';
 else if(hint==='text/plain'&&!bytes.includes(0)){new TextDecoder('utf-8',{fatal:true}).decode(bytes);mime='text/plain';}
 else throw Error('Use a JPEG, PNG, PDF, MP4 or plain text file');
 const id=randomUUID(),dir=path.join(dataDir(),'artifacts');mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,id);writeFileSync(file,data,{mode:0o600});
 try{return db.put(owner,'artifact',{id,kind:mime.startsWith('image')?'photo':'file',name:name.replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,120)||'Attachment',path:file,mime,size:data.length,createdAt:new Date().toISOString()});}catch(e){unlinkSync(file);throw e;}
}
export function artifactBytes(a:Row){return a.path?readFileSync(a.path):Buffer.from(a.base64??'','base64');}
export function selectedImages(db:Store,owner:string,run:Row){return (run.context?.attachments??[]).map((id:string)=>db.get(owner,'artifact',id)).filter((a:Row|undefined)=>a?.mime==='image/jpeg').map((a:Row)=>artifactBytes(a).toString('base64'));}
export async function extractAttachment(a:Row){if(a.text)return String(a.text);if(a.mime==='text/plain')return artifactBytes(a).toString('utf8').slice(0,100000);if(a.mime==='application/pdf'){
 const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:new Uint8Array(artifactBytes(a))});try{return (await parser.getText()).text.slice(0,100000);}finally{await parser.destroy();}
 }throw Error('Use the attached image in the model input. Video analysis requires a connected video-capable tool.');}
