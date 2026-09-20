import {test} from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../src/employee/db.js';import {ToolGateway} from '../src/employee/tools.js';
import {assertPublicUrl,htmlToText,isPrivateAddress,registerWeb} from '../src/employee/web.js';

const reply=(body:string,init:ResponseInit&{url?:string}={})=>{const r=new Response(body,{headers:{'content-type':'text/html'},...init});if(init.url)Object.defineProperty(r,'url',{value:init.url});return r;};
function gateway(http:typeof fetch){const db=new Store(':memory:'),t=new ToolGateway(db);registerWeb(t,http);db.put('a','run',{id:'r',status:'working'});return {db,t};}

// The model picks these URLs after reading pages it does not control, so this is
// an outbound request an attacker can aim. It matters most here because the
// gateway shares a machine with Hermes and whatever else is on that VM.
test('only the public internet is reachable',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.5','172.16.0.1','172.31.255.255','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fd00::1','fe80::1'])
  assert.equal(isPrivateAddress(ip),true,`${ip} must be refused`);
 for(const ip of ['8.8.8.8','1.1.1.1','93.184.216.34','172.15.0.1','172.32.0.1','2606:4700::1111'])
  assert.equal(isPrivateAddress(ip),false,`${ip} is ordinary internet`);
});

test('an address that is not an ordinary web page is refused',async()=>{
 await assert.rejects(()=>assertPublicUrl('http://127.0.0.1:8788/api/state'),/not on the public internet/);
 await assert.rejects(()=>assertPublicUrl('http://[::1]/'),/not on the public internet/);
 // The cloud metadata endpoint is the classic way to steal a machine's credentials.
 await assert.rejects(()=>assertPublicUrl('http://169.254.169.254/latest/meta-data/'),/not on the public internet/);
 await assert.rejects(()=>assertPublicUrl('file:///etc/passwd'),/Only web addresses/);
 await assert.rejects(()=>assertPublicUrl('ftp://example.com/x'),/Only web addresses/);
 await assert.rejects(()=>assertPublicUrl('http://user:secret@example.com/'),/carries credentials/);
 await assert.rejects(()=>assertPublicUrl('not a url'),/not a valid web address/);
});

test('a redirect cannot land somewhere private after a public start',async()=>{
 const {db,t}=gateway(async()=>reply('<p>inside</p>',{url:'http://127.0.0.1:9/secrets'}));
 await assert.rejects(()=>t.invoke('a','r','web_read',{url:'https://example.com'},'k'),/not on the public internet/);
 db.close();
});

test('a page is returned as readable text, without its scripts or markup',()=>{
 const text=htmlToText('<html><head><title>T</title><style>.a{color:red}</style></head><body><script>steal()</script><h1>Roof</h1><p>Two tiles are cracked.</p><p>Ladder &amp; harness needed.</p></body></html>');
 assert.ok(!/steal\(\)|color:red|<p>/.test(text),`markup survived: ${text}`);
 assert.match(text,/Roof/);assert.match(text,/Two tiles are cracked\./);
 assert.match(text,/Ladder & harness needed\./,'entities are decoded');
});

test('reading a page returns its address, title and text',async()=>{
 const {db,t}=gateway(async()=>reply('<title>Weather</title><body><p>18C and raining</p>',{url:'https://example.com/w'}));
 const r=await t.invoke('a','r','web_read',{url:'https://example.com/w'},'k');
 assert.equal(r.title,'Weather');
 assert.match(r.text,/18C and raining/);
 assert.equal(r.truncated,false);
 assert.equal(r.url,'https://example.com/w');
 db.close();
});

test('a very long page is cut rather than returned whole, and says it was cut',async()=>{
 const {db,t}=gateway(async()=>reply('<body>'+'word '.repeat(60_000)));
 const r=await t.invoke('a','r','web_read',{url:'https://example.com'},'k');
 assert.equal(r.text.length,100_000);
 assert.equal(r.truncated,true,'the employee is told the page was cut, so it does not treat it as complete');
 db.close();
});

test('a page that is too large to hold is refused outright',async()=>{
 const {db,t}=gateway(async()=>reply('x'.repeat(2_000_001)));
 await assert.rejects(()=>t.invoke('a','r','web_read',{url:'https://example.com'},'k'),/too large/);
 db.close();
});

test('a page that did not load is an error, not empty text',async()=>{
 const {db,t}=gateway(async()=>reply('nope',{status:404}));
 await assert.rejects(()=>t.invoke('a','r','web_read',{url:'https://example.com'},'k'),/HTTP 404/);
 db.close();
});

test('json is returned as it came, not mangled into prose',async()=>{
 const {db,t}=gateway(async()=>new Response('{"temp_f":61,"desc":"Light rain"}',{headers:{'content-type':'application/json'}}));
 const r=await t.invoke('a','r','web_read',{url:'https://example.com/api'},'k');
 assert.deepEqual(JSON.parse(r.text),{temp_f:61,desc:'Light rain'});
 db.close();
});

test('search says it is not connected rather than inventing results',async()=>{
 const saved=process.env.SEARCH_API_KEY;delete process.env.SEARCH_API_KEY;
 try{
  const {db,t}=gateway(async()=>{throw Error('must not be called');});
  await assert.rejects(()=>t.invoke('a','r','web_search',{query:'anything'},'k'),/not connected/);
  db.close();
 }finally{if(saved!==undefined)process.env.SEARCH_API_KEY=saved;}
});

test('search results normalize across provider shapes',async()=>{
 const saved=process.env.SEARCH_API_KEY;process.env.SEARCH_API_KEY='fixture-only';
 try{
  for(const body of [
   {web:{results:[{title:'A',url:'https://a.test',description:'one'}]}},
   {results:[{title:'A',url:'https://a.test',content:'one'}]},
   {organic_results:[{title:'A',link:'https://a.test',snippet:'one'}]},
  ]){
   const {db,t}=gateway(async()=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}));
   const r=await t.invoke('a','r','web_search',{query:'roof repair'},'k');
   assert.deepEqual(r.results.map((x:any)=>x.url),['https://a.test']);
   assert.equal(r.results[0].title,'A');
   db.close();
  }
 }finally{if(saved===undefined)delete process.env.SEARCH_API_KEY;else process.env.SEARCH_API_KEY=saved;}
});

test('reading the web needs no approval, but is recorded as an action',async()=>{
 const {db,t}=gateway(async()=>reply('<body>hello'));
 const r=await t.invoke('a','r','web_read',{url:'https://example.com'},'k');
 assert.ok(!r.approvalId,'reading a public page is not a decision for a person');
 assert.equal(db.list('a','action').find(x=>x.name==='web_read')?.status,'completed');
 db.close();
});
