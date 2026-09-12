import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync}from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/employee/db.js';import {ToolGateway} from '../src/employee/tools.js';import {McpConnections} from '../src/employee/mcp.js';import {BrowserCapability} from '../src/employee/browser.js';

function withConfig<T>(value:string|undefined,fn:()=>T):T{
 const dir=mkdtempSync(path.join(os.tmpdir(),'vc-mcp-')),file=path.join(dir,'mcp.json'),before=process.env.MCP_CONFIG_PATH;
 try{if(value===undefined){delete process.env.MCP_CONFIG_PATH;}else{writeFileSync(file,value);process.env.MCP_CONFIG_PATH=file;}return fn();}
 finally{if(before===undefined)delete process.env.MCP_CONFIG_PATH;else process.env.MCP_CONFIG_PATH=before;rmSync(dir,{recursive:true,force:true});}
}

const valid=[{id:'docs',url:'https://mcp.example.test/mcp',owners:['alice'],tools:{search:{effect:'read',inputSchema:{type:'object',properties:{q:{type:'string'}}}}}}];

test('a usable MCP configuration is loaded and exposed only to its owners',()=>{
 withConfig(JSON.stringify(valid),()=>{
  const mcp=new McpConnections();
  assert.equal(mcp.error,undefined);
  assert.equal(mcp.config.length,1);
  const db=new Store(':memory:'),t=new ToolGateway(db);mcp.register(t,db);
  assert.ok(t.definitions('alice').some(d=>d.name==='mcp_docs_search'),'the owner sees the connected tool');
  assert.ok(!t.definitions('bob').some(d=>d.name==='mcp_docs_search'),'another owner does not');
  db.close();
 });
});

// A broken connector file must cost the employee that connector, not the whole
// product. The gateway reports it rather than failing to start.
test('a malformed MCP configuration disables only the connectors',()=>{
 for(const [label,body] of [
  ['unparseable JSON','{ not json'],
  ['wrong shape',JSON.stringify([{id:'docs'}])],
  ['an id that is not a safe tool-name fragment',JSON.stringify([{...valid[0],id:'Bad Id!'}])],
  ['an unknown side-effect class',JSON.stringify([{...valid[0],tools:{search:{effect:'launch_missiles',inputSchema:{type:'object'}}}}])],
  ['a connector with no owner',JSON.stringify([{...valid[0],owners:[]}])],
 ] as const){
  withConfig(body,()=>{
   const mcp=new McpConnections();
   assert.deepEqual(mcp.config,[],`${label}: no connector is loaded`);
   assert.match(mcp.error??'',/other capabilities remain available/,`${label}: the failure is reported`);
  });
 }
});

// A plaintext connector URL would put the bearer token and every tool argument
// on the wire in clear.
test('an MCP connector reached over plain http is refused',()=>{
 withConfig(JSON.stringify([{...valid[0],url:'http://mcp.example.test/mcp'}]),()=>{
  const mcp=new McpConnections();
  assert.deepEqual(mcp.config,[]);
  assert.ok(mcp.error);
 });
});

test('no MCP configuration is a quiet absence, not an error',()=>{
 withConfig(undefined,()=>{
  const mcp=new McpConnections();
  assert.deepEqual(mcp.config,[]);
  assert.equal(mcp.error,undefined);
 });
});

// Checkout must go through the exact-quote adapter, which re-prices and requires
// approval of a specific total. A connector exposing its own checkout tool
// alongside would be a second, ungoverned path to spending money.
test('a connector cannot expose its checkout tools as ordinary tools',()=>{
 withConfig(JSON.stringify([{...valid[0],checkout:{quote:'search',refresh:'refresh',order:'order'}}]),()=>{
  const db=new Store(':memory:'),t=new ToolGateway(db);
  assert.throws(()=>new McpConnections().register(t,db),/exact-quote adapter/);
  db.close();
 });
});

test('a connector is unusable by someone it does not list, and without its credential',async()=>{
 await withConfig(JSON.stringify([{...valid[0],tokenEnv:'DOCS_TOKEN'}]),async()=>{
  const mcp=new McpConnections();
  await assert.rejects(()=>mcp.withClient('docs','bob',async()=>'reached'),/not authorized/);
  await assert.rejects(()=>mcp.withClient('nope','alice',async()=>'reached'),/not authorized/);
  const before=process.env.DOCS_TOKEN;delete process.env.DOCS_TOKEN;
  try{await assert.rejects(()=>mcp.withClient('docs','alice',async()=>'reached'),/credential is missing/);}
  finally{if(before!==undefined)process.env.DOCS_TOKEN=before;}
 });
});

// --- browser / computer use ----------------------------------------------

test('browser work refuses clearly when it is not connected',async()=>{
 const db=new Store(':memory:'),before=process.env.BROWSER_USE_API_KEY;delete process.env.BROWSER_USE_API_KEY;
 const t=new ToolGateway(db);new BrowserCapability(db).register(t);
 db.put('a','run',{id:'r',status:'working'});
 try{
  const pending=await t.invoke('a','r','browser_work',{task:'Look something up'},'k');
  assert.ok(pending.approvalId,'computer use is gated before it is attempted');
  t.decide('a',pending.approvalId,'once');
  await assert.rejects(()=>t.invoke('a','r','browser_work',{task:'Look something up'},'k'),/not connected/);
 }finally{if(before!==undefined)process.env.BROWSER_USE_API_KEY=before;db.close();}
});

test('cancelling a browser session that never reached the provider needs no provider call',async()=>{
 const db=new Store(':memory:'),browser=new BrowserCapability(db);
 const ticket=db.create('a','computer',{runId:'r',status:'queued',task:'x'});
 await browser.cancel('a',ticket.id);
 assert.equal(db.get('a','computer',ticket.id)!.status,'cancelled');
 db.close();
});

test('cancelling an already finished browser session changes nothing',async()=>{
 const db=new Store(':memory:'),browser=new BrowserCapability(db);
 for(const status of ['completed','failed','cancelled','closed']){
  const ticket=db.create('a','computer',{runId:'r',status,task:'x'});
  await browser.cancel('a',ticket.id);
  assert.equal(db.get('a','computer',ticket.id)!.status,status);
 }
 db.close();
});

// A browser left running after its task ended is both a cost and an open
// session on whatever site it was on.
test('cleanup closes browser sessions whose task has finished, and leaves live ones alone',async()=>{
 const db=new Store(':memory:'),browser=new BrowserCapability(db);
 db.put('a','run',{id:'done',status:'completed'});db.put('a','run',{id:'live',status:'working'});
 const orphan=db.create('a','computer',{runId:'done',status:'queued',task:'x'});
 const active=db.create('a','computer',{runId:'live',status:'queued',task:'y'});
 await browser.cleanup();
 assert.equal(db.get('a','computer',orphan.id)!.status,'cancelled');
 assert.equal(db.get('a','computer',active.id)!.status,'queued');
 db.close();
});

test('one owner cannot cancel another owner browser session',async()=>{
 const db=new Store(':memory:'),browser=new BrowserCapability(db);
 const ticket=db.create('a','computer',{runId:'r',status:'queued',task:'x'});
 await browser.cancel('b',ticket.id);
 assert.equal(db.get('a','computer',ticket.id)!.status,'queued','the other owner sees no such session and changes nothing');
 db.close();
});
