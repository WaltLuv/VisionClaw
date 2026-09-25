import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import express from 'express';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/employee/db.js';import {BrowserCapability,embeddableLiveUrl,validLiveViewHosts,liveFrameSources,browserClock} from '../src/employee/browser.js';import {installEmployee} from '../src/employee/routes.js';import {tokenHash} from '../src/employee/auth.js';import {initStore} from '../src/store.js';

/**
 * Watching the employee browse, and taking the browser from it. A stand-in
 * Browser Use service on loopback records every pause, resume and cancel, so
 * the tests can hold the gateway to one rule above all: it never tells the
 * owner they have the browser unless the provider actually paused the agent.
 */
interface Service{url:string;calls:string[];status:string;refuse:Set<string>;live:string;close():Promise<void>}
async function browserUse():Promise<Service>{
 const svc={calls:[] as string[],status:'running',refuse:new Set<string>(),live:'https://live.browser-use.com/view?session=abc'} as Service;
 const server=createServer((req,res)=>{
  const url=req.url??'',json=(code:number,v:unknown)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(v));};
  req.resume();
  if(req.method==='POST'&&url==='/api/v4/runs')return json(200,{id:'bu-1'});
  const m=url.match(/^\/api\/v4\/runs\/([^/]+)(?:\/(\w+))?$/);if(!m)return json(404,{});
  const [,,action]=m;
  if(req.method==='POST'){svc.calls.push(action!);return svc.refuse.has(action!)?json(409,{detail:'refused'}):json(200,{});}
  if(action==='events')return json(200,{events:[{type:'browser.ready',data:{live_view_url:svc.live}}]});
  if(action==='status')return json(200,{status:svc.status});
  return json(200,{status:svc.status,result:'Found it'});
 });
 server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',()=>r()));
 svc.url=`http://127.0.0.1:${(server.address() as any).port}/api/v4`;
 svc.close=async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));};
 return svc;
}
const waitFor=async(check:()=>boolean,what:string,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error(`Timed out waiting for ${what}`);};
function env(svc:Service){const keys={BROWSER_USE_API_KEY:'fixture-key',BROWSER_USE_API_BASE:svc.url,BROWSER_POLL_MS:'20'},saved:Record<string,string|undefined>={};for(const [k,v] of Object.entries(keys)){saved[k]=process.env[k];process.env[k]=v;}return ()=>{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;};}
const ctx=(owner='alice',runId='run-1')=>({owner,runId,actionId:'a1',assertAuthorized:()=>{}});

test('you can watch, take the browser, hand it back, and the live link is gone when the job ends',async t=>{
 const svc=await browserUse(),restore=env(svc),db=new Store(':memory:'),browser=new BrowserCapability(db);
 t.after(async()=>{restore();db.close();await svc.close();});
 const job=browser.execute('Find the part',ctx());
 await waitFor(()=>!!db.list('alice','computer')[0]?.liveEmbed,'the live view');
 const id=db.list('alice','computer')[0].id;
 assert.equal(db.get('alice','computer',id)?.liveEmbed,'https://live.browser-use.com/view?session=abc');
 assert.equal(db.get('alice','computer',id)?.control,'agent','the employee drives until you take over');

 assert.equal((await browser.control('alice',id,'owner'))?.control,'owner');
 assert.deepEqual(svc.calls,['pause'],'taking over pauses the agent at the provider');
 await browser.control('alice',id,'owner');
 assert.deepEqual(svc.calls,['pause'],'a second tap does not pause twice');
 assert.equal(await browser.control('bob',id,'owner'),undefined,'someone else\'s browser does not exist for you');

 await new Promise(r=>setTimeout(r,30));
 const back=await browser.control('alice',id,'agent');
 assert.equal(back?.control,'agent');
 assert.deepEqual(svc.calls,['pause','resume']);
 assert.ok(back?.pausedMs>=30,'time with you is recorded so it does not count against the agent');

 svc.status='completed';
 assert.deepEqual(await job,{text:'Found it',computerId:id});
 const done=db.get('alice','computer',id)!;
 assert.equal(done.status,'completed');
 assert.equal(done.liveUrl,undefined,'a finished job keeps no key to its browser');
 assert.equal(done.liveEmbed,undefined);
});

test('the app never claims you have the browser when the provider did not pause it',async t=>{
 const svc=await browserUse(),restore=env(svc),db=new Store(':memory:'),browser=new BrowserCapability(db);
 t.after(async()=>{restore();db.close();await svc.close();});
 const job=browser.execute('Find the part',ctx());job.catch(()=>{});
 await waitFor(()=>!!db.list('alice','computer')[0]?.liveEmbed,'the live view');
 const id=db.list('alice','computer')[0].id;
 svc.refuse.add('pause');
 await assert.rejects(()=>browser.control('alice',id,'owner'),/still driving/);
 assert.equal(db.get('alice','computer',id)?.control,'agent','still the employee\'s: the pause was refused');
 svc.refuse.delete('pause');
 await browser.control('alice',id,'owner');
 svc.refuse.add('resume');
 await assert.rejects(()=>browser.control('alice',id,'agent'),/stays paused for you/);
 assert.equal(db.get('alice','computer',id)?.control,'owner','still yours: the resume was refused');
 await browser.cancel('alice',id);
 assert.ok(svc.calls.includes('cancel'),'stopping works even while you hold the browser');
 assert.equal(db.get('alice','computer',id)?.liveEmbed,undefined,'a cancelled job keeps no key to its browser');
});

test('only a browser provider\'s own https pages are offered for embedding',async t=>{
 const saved=process.env.BROWSER_LIVE_VIEW_HOSTS;t.after(()=>{if(saved===undefined)delete process.env.BROWSER_LIVE_VIEW_HOSTS;else process.env.BROWSER_LIVE_VIEW_HOSTS=saved;});
 delete process.env.BROWSER_LIVE_VIEW_HOSTS;
 assert.equal(embeddableLiveUrl('https://live.browser-use.com/v?s=1'),'https://live.browser-use.com/v?s=1');
 assert.equal(embeddableLiveUrl('http://live.browser-use.com/v'),null,'never over plain http');
 assert.equal(embeddableLiveUrl('https://evilbrowser-use.com/v'),null,'a look-alike domain is not a subdomain');
 assert.equal(embeddableLiveUrl('https://user:pw@live.browser-use.com/v'),null);
 assert.equal(embeddableLiveUrl('https://cdn.other.net/v'),null);
 assert.equal(embeddableLiveUrl('javascript:alert(1)'),null);
 process.env.BROWSER_LIVE_VIEW_HOSTS='live.example.com';
 assert.equal(embeddableLiveUrl('https://live.example.com/v'),'https://live.example.com/v','an owner can allow another provider');
 assert.equal(liveFrameSources(),'https://browser-use.com https://*.browser-use.com https://live.example.com https://*.live.example.com');
 for(const bad of ['*',"'unsafe-inline'",'https://x.com','a b','localhost']){process.env.BROWSER_LIVE_VIEW_HOSTS=bad;assert.equal(validLiveViewHosts(),false,`${bad} must not reach the Content-Security-Policy`);}
});

test('a live view from a host that is not allowed is kept for the glasses apps but not offered to the phone',async t=>{
 const svc=await browserUse(),restore=env(svc),db=new Store(':memory:'),browser=new BrowserCapability(db);
 t.after(async()=>{restore();db.close();await svc.close();});
 svc.live='https://cdn.other.net/view?s=9';
 const job=browser.execute('Find the part',ctx());job.catch(()=>{});
 await waitFor(()=>!!db.list('alice','computer')[0]?.liveHost,'the live view');
 const r=db.list('alice','computer')[0];
 assert.equal(r.liveUrl,'https://cdn.other.net/view?s=9','the native apps still get the link they always had');
 assert.equal(r.liveEmbed,null,'the phone app is not handed it to frame');
 assert.equal(r.liveHost,'cdn.other.net','so the phone can say which host needs allowing');
 await browser.cancel('alice',r.id);
});

test('the agent\'s time limit stops while you drive, but a forgotten take-over still ends',()=>{
 const begun=0,min=60_000;
 assert.equal(browserClock({id:'c',control:'agent'},begun,14*min),null);
 assert.match(browserClock({id:'c',control:'agent'},begun,16*min)!,/time limit/);
 assert.equal(browserClock({id:'c',control:'owner',controlSince:5*min},begun,25*min),null,'20 minutes with you do not count');
 assert.equal(browserClock({id:'c',control:'agent',pausedMs:20*min},begun,30*min),null,'nor once handed back');
 assert.match(browserClock({id:'c',control:'owner',controlSince:0},begun,46*min)!,/left with you for too long/);
});

test('HTTP: take-over needs your session and CSRF token, and is invisible to another owner',async t=>{
 const svc=await browserUse(),restore=env(svc);
 const dir=mkdtempSync(path.join(os.tmpdir(),'vc-browser-http-'));process.env.EMPLOYEE_DATA_DIR=dir;process.env.EMPLOYEE_DB_PATH=path.join(dir,'employee.sqlite');initStore(path.join(dir,'legacy.json'));
 const app=express();app.use(express.json());const ids=new Map([['fixture-a','alice'],['fixture-b','bob']]);
 const e=installEmployee(app,(req,token)=>ids.get(token??req.header('authorization')?.slice(7)??'')??null,(owner,hash)=>[...ids].some(([tk,o])=>o===owner&&tokenHash(tk)===hash),async()=>({result:'ok'}));
 const server=app.listen(0);await new Promise<void>(r=>server.on('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
 t.after(async()=>{e.stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));e.db.close();rmSync(dir,{recursive:true,force:true});delete process.env.EMPLOYEE_DB_PATH;delete process.env.EMPLOYEE_DATA_DIR;restore();await svc.close();});
 const login=async(token:string)=>{const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrf as string};};
 const a=await login('fixture-a'),b=await login('fixture-b');
 const c=e.db.put('alice','computer',{id:'comp-1',runId:'run-1',status:'working',providerId:'bu-1',control:'agent',liveUrl:'https://live.browser-use.com/v?s=1',liveEmbed:'https://live.browser-use.com/v?s=1'});
 const post=(p:string,s:{cookie:string;csrf?:string})=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json',cookie:s.cookie,...(s.csrf?{'x-csrf-token':s.csrf}:{})},body:'{}'});
 assert.equal((await post(`/api/computers/${c.id}/takeover`,{cookie:a.cookie})).status,403,'no CSRF token, no take-over');
 assert.equal((await post(`/api/computers/${c.id}/takeover`,b)).status,404,'another owner cannot even tell it exists');
 assert.deepEqual(svc.calls,[],'nothing reached the provider for either refusal');
 const ok=await post(`/api/computers/${c.id}/takeover`,a);assert.equal(ok.status,200);
 const body=await ok.json();assert.deepEqual(body,{id:'comp-1',status:'working',control:'owner'});
 assert.equal(JSON.stringify(body).includes('live.browser-use.com'),false,'the reply does not repeat the live link');
 assert.equal((await post(`/api/computers/${c.id}/handback`,a)).status,200);
 assert.deepEqual(svc.calls,['pause','resume']);
 svc.refuse.add('pause');
 const refused=await post(`/api/computers/${c.id}/takeover`,a);assert.equal(refused.status,409);
 assert.match((await refused.json()).error.message,/still driving/);
});

test('the phone app may frame a live view host and nothing else, and still runs no inline script',async()=>{
 const {appContentSecurityPolicy}=await import('../src/csp.js');
 const csp=appContentSecurityPolicy();
 assert.match(csp,/frame-src https:\/\/browser-use\.com https:\/\/\*\.browser-use\.com;/);
 assert.doesNotMatch(csp,/frame-src[^;]*https:;/,'no longer any https page at all');
 assert.match(csp,/script-src 'self';/);
 assert.match(csp,/frame-ancestors 'none'/,'and nobody may frame the app itself');
});
