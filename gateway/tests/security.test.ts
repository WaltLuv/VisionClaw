import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import sharp from 'sharp';
import {Store} from '../src/employee/db.js';import {saveAttachment} from '../src/employee/artifacts.js';import {redact,redactText,processSecrets} from '../src/employee/redact.js';

/** A genuinely valid PNG, so the decoder is exercised rather than a malformed-input path. */
const png=()=>sharp({create:{width:8,height:8,channels:3,background:{r:10,g:20,b:30}}}).png().toBuffer();

// Uploads are attacker-controlled bytes with an attacker-controlled name and
// content type. The type is decided from the bytes, never from the header the
// caller sent.
test('uploads are accepted by their actual bytes, not the declared type',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'vc-up-'));process.env.EMPLOYEE_DATA_DIR=dir;const db=new Store(':memory:');
 try{
  const png2=await saveAttachment(db,'alice',await png(),'shot.png','image/png');
  assert.equal(png2.mime,'image/jpeg','images are re-encoded, so any payload riding in the original container is dropped');
  assert.equal(png2.kind,'photo');

  // An SVG is an executable document in a browser. It is not in the allowlist,
  // and claiming to be a PNG must not get it through.
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(()=>saveAttachment(db,'alice',svg,'x.png','image/png'),/JPEG, PNG, PDF, MP4 or plain text/);
  await assert.rejects(()=>saveAttachment(db,'alice',Buffer.from('<!doctype html><script>alert(1)</script>'),'x.txt','text/html'),/JPEG, PNG, PDF, MP4 or plain text/);
  // Plain text is only plain text if it really decodes as UTF-8 without NULs.
  await assert.rejects(()=>saveAttachment(db,'alice',Buffer.from([0x68,0x00,0x69]),'x.txt','text/plain'),/JPEG, PNG, PDF, MP4 or plain text/);

  await assert.rejects(()=>saveAttachment(db,'alice',Buffer.alloc(0),'empty.png','image/png'),/under 20 MB/);
  await assert.rejects(()=>saveAttachment(db,'alice',Buffer.alloc(21*1024*1024,1),'big.png','image/png'),/under 20 MB/);
 }finally{db.close();delete process.env.EMPLOYEE_DATA_DIR;rmSync(dir,{recursive:true,force:true});}
});

test('an uploaded filename cannot carry a path or markup, and bytes land private',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'vc-up2-'));process.env.EMPLOYEE_DATA_DIR=dir;const db=new Store(':memory:');
 try{
  const saved=await saveAttachment(db,'alice',await png(),'../../etc/<script>passwd</script>.png','image/png');
  assert.ok(!String(saved.name).includes('/'),`name kept a path separator: ${saved.name}`);
  assert.ok(!/[<>]/.test(String(saved.name)),`name kept markup: ${saved.name}`);
  assert.equal(path.dirname(String(saved.path)),path.join(dir,'artifacts'),'the file is written inside the artifact directory regardless of the name');
  assert.equal(statSync(String(saved.path)).mode&0o777,0o600,'artifact bytes are not world readable');
 }finally{db.close();delete process.env.EMPLOYEE_DATA_DIR;rmSync(dir,{recursive:true,force:true});}
});

test('an uploaded file belongs to the uploader alone',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'vc-up3-'));process.env.EMPLOYEE_DATA_DIR=dir;const db=new Store(':memory:');
 try{
  const saved=await saveAttachment(db,'alice',await png(),'mine.png','image/png');
  assert.equal(db.get('bob','artifact',saved.id),undefined,'another owner cannot read it');
  assert.ok(db.get('alice','artifact',saved.id));
  // Re-keying someone else's record to yourself must be refused outright.
  assert.throws(()=>db.put('bob','artifact',{...saved}),/ownership conflict/i);
 }finally{db.close();delete process.env.EMPLOYEE_DATA_DIR;rmSync(dir,{recursive:true,force:true});}
});

// Redaction, both ways round: by field name for structures we have not seen,
// and by value for the free text where credentials actually turn up.
test('secrets are removed from nested errors and logs by name',()=>{
 const out=redact({
  message:'upstream failed',
  request:{headers:{authorization:'Bearer sk-live-abcdef123456',cookie:'vc_session=deadbeef'},url:'https://api.example.com/v1/send'},
  provider:{nested:[{api_key:'sk-test-1234567890'},{clientSecret:'shhhhhhhhhh'}]},
  retries:2,
 },[]) as any;
 assert.equal(out.request.headers.authorization,'[redacted]');
 assert.equal(out.request.headers.cookie,'[redacted]');
 assert.equal(out.provider.nested[0].api_key,'[redacted]');
 assert.equal(out.provider.nested[1].clientSecret,'[redacted]');
 assert.equal(out.retries,2,'ordinary fields survive');
 assert.equal(out.request.url,'https://api.example.com/v1/send');
});

test('secrets are removed from free text by value, where a name pass cannot see them',()=>{
 const secrets=['sk-live-super-secret-value','twilio-auth-token-value'];
 assert.equal(redactText('POST failed: https://api/x?key=sk-live-super-secret-value returned 401',secrets),'POST failed: https://api/x?key=[redacted] returned 401');
 assert.equal((redact(new Error('auth rejected for twilio-auth-token-value'),secrets) as any).message,'auth rejected for [redacted]');
 assert.equal((redact({detail:{trace:['used sk-live-super-secret-value']}},secrets) as any).detail.trace[0],'used [redacted]');
});

test('the secret inventory is drawn from credential-shaped variables only',()=>{
 const found=processSecrets({API_KEY:'abcdefghij',TWILIO_AUTH_TOKEN:'0123456789',STATE_SECRET:'shortie1',PORT:'8788',HOME:'/root',SHORT_TOKEN:'abc'} as NodeJS.ProcessEnv);
 assert.ok(found.includes('abcdefghij'));
 assert.ok(found.includes('0123456789'));
 assert.ok(found.includes('shortie1'));
 assert.ok(!found.includes('8788'),'a port is not a secret');
 assert.ok(!found.includes('/root'),'a home directory is not a secret');
 assert.ok(!found.includes('abc'),'values too short to be credentials are ignored, or ordinary text would be shredded');
});

test('redaction survives cycles and deep nesting instead of hanging',()=>{
 const cyclic:any={token:'x'};cyclic.self=cyclic;
 const out=redact(cyclic,[]) as any;
 assert.equal(out.token,'[redacted]');
 assert.equal(out.self,'[circular]');
 let deep:any='leaf';for(let i=0;i<20;i++)deep={next:deep};
 assert.doesNotThrow(()=>redact(deep,[]));
});
