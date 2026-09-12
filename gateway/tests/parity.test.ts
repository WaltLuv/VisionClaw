import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync,readFileSync,chmodSync,existsSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/employee/db.js';import {RunQueue,executeSchema} from '../src/employee/runs.js';import {ToolGateway} from '../src/employee/tools.js';import {HermesProvider,selectRuntime} from '../src/employee/provider.js';import {AnthropicManagedRuntime,governedToolsets,permittedManagedRead} from '../src/employee/managed.js';

// Which engine runs a task is the server's decision, tied to the owner. A
// caller naming its own runtime would be choosing how much of the governed tool
// surface applies to its work.
test('runtime is chosen per owner and cannot be named by the caller',()=>{
 assert.equal(selectRuntime({id:'a',runtime:'hermes'},{id:'r'}),'hermes');
 assert.equal(selectRuntime({id:'a',runtime:'anthropic'},{id:'r'}),'anthropic');
 assert.equal(selectRuntime(undefined,{id:'r'}),'anthropic','an owner with no profile keeps the preserved default');
 // executeSchema drops unknown fields, so a body asking for a runtime cannot reach the run record.
 assert.equal((executeSchema.parse({task:'Do it',runtime:'hermes'}) as any).runtime,undefined);
 // An unrecognised value resolves to the default rather than indexing into nothing and crashing.
 assert.equal(selectRuntime({id:'a',runtime:'not-a-runtime'},{id:'r'}),'anthropic');
});

// A run records its runtime when it starts, so resuming after a restart cannot
// quietly move a half-finished task onto a different engine.
test('a started run keeps its runtime even if the profile changes',()=>{
 assert.equal(selectRuntime({id:'a',runtime:'anthropic'},{id:'r',runtime:'hermes'}),'hermes');
 assert.equal(selectRuntime({id:'a',runtime:'hermes'},{id:'r',runtime:'anthropic'}),'anthropic');
});

test('one owner switching runtime does not move another owner',()=>{
 const db=new Store(':memory:');
 db.create('alice','agent',{runtime:'hermes',skills:[]});db.create('bob','agent',{runtime:'anthropic',skills:[]});
 assert.equal(selectRuntime(db.list('alice','agent')[0],{id:'r1'}),'hermes');
 assert.equal(selectRuntime(db.list('bob','agent')[0],{id:'r2'}),'anthropic');
 db.close();
});

// A provider that dies must produce a task the owner can see and retry, not a
// queue that stops serving everyone.
test('a provider failure fails only its own run and the queue keeps working',async()=>{
 const db=new Store(':memory:');let first=true;
 const q=new RunQueue(db,async()=>{if(first){first=false;throw Error('Provider connection reset');}return {result:'second run fine'};});
 const bad=q.create('a',{task:'First'},'k1');await q.tick();
 assert.equal(db.get('a','run',bad.id)?.status,'failed');
 assert.equal(db.get('a','run',bad.id)?.error,'Provider connection reset');
 const good=q.create('a',{task:'Second'},'k2');await q.tick();
 assert.equal(db.get('a','run',good.id)?.status,'completed');
 db.close();
});

test('a provider that returns nothing is a failed run, not a silent success',async()=>{
 const db=new Store(':memory:');const q=new RunQueue(db,async()=>({result:'   '}));
 const r=q.create('a',{task:'Empty'},'k');await q.tick();
 assert.equal(db.get('a','run',r.id)?.status,'failed');
 assert.equal(db.list('a','artifact').length,0,'a failed run leaves no result artifact');
 db.close();
});

// The preserved hosted runtime must still refuse in a way the owner can act on
// when it is not configured, rather than throwing something opaque.
test('the hosted runtime refuses clearly when it is not configured',async()=>{
 const db=new Store(':memory:'),key=process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_API_KEY;
 try{
  await assert.rejects(()=>new AnthropicManagedRuntime(db,new ToolGateway(db)).run('a',{id:'r',task:'x'},new AbortController().signal),/not connected/i);
 }finally{if(key!==undefined)process.env.ANTHROPIC_API_KEY=key;db.close();}
});

// Parity of governance, not of wording: whichever runtime runs, the hosted
// agent's own toolsets stay behind a prompt and only the gateway's tools are
// added as custom tools.
test('hosted runtime forces its own toolsets to ask before acting',()=>{
 const governed=governedToolsets([{type:'bash'},{type:'custom',name:'dropped'},{type:'mcp',configs:[{name:'x'}]}]);
 assert.deepEqual(governed.map(t=>t.type),['bash','mcp'],'custom toolsets are replaced by the gateway definitions');
 for(const t of governed){
  assert.equal(t.default_config.permission_policy.type,'always_ask');
  for(const c of t.configs??[])assert.equal(c.permission_policy.type,'always_ask');
 }
});

test('only explicitly listed hosted reads are auto-permitted',()=>{
 const before=process.env.MANAGED_READ_TOOLS;process.env.MANAGED_READ_TOOLS='docs:search';
 try{
  assert.equal(permittedManagedRead({type:'agent.tool_use',name:'read'}),true);
  assert.equal(permittedManagedRead({type:'agent.tool_use',name:'bash'}),false,'a shell is never an auto-permitted read');
  assert.equal(permittedManagedRead({type:'agent.tool_use',name:'write'}),false);
  assert.equal(permittedManagedRead({type:'agent.mcp_tool_use',mcp_server_name:'docs',name:'search'}),true);
  assert.equal(permittedManagedRead({type:'agent.mcp_tool_use',mcp_server_name:'docs',name:'delete'}),false);
  assert.equal(permittedManagedRead({type:'agent.mcp_tool_use',mcp_server_name:'other',name:'search'}),false);
 }finally{if(before===undefined)delete process.env.MANAGED_READ_TOOLS;else process.env.MANAGED_READ_TOOLS=before;}
});

/**
 * The Hermes subprocess is handed an explicit environment, not this process's.
 * Codex and any other model provider reach it only through that allowlist, and
 * credentials for the gateway's own integrations -- browser automation, SMS,
 * voice, suppliers, the session secret -- must never be among them: the model
 * runs attacker-influenced text, and those keys buy, send and browse.
 */
test('Hermes receives only model credentials, never the gateway service keys',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'vc-env-')),dump=path.join(dir,'env.json');
 writeFileSync(path.join(dir,'run_agent.py'),'');
 const fake=path.join(dir,'fake-python.mjs');
 writeFileSync(fake,`#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(dump)},JSON.stringify(process.env));
let seen='';process.stdin.on('data',d=>{seen+=d;if(seen.includes('\\n')){process.stdout.write(JSON.stringify({type:'result',result:'ok'})+'\\n');}});
`);
 chmodSync(fake,0o755);
 const secrets={BROWSER_USE_API_KEY:'browser-secret',TWILIO_AUTH_TOKEN:'twilio-secret',RETELL_API_KEY:'retell-secret',EBAY_CLIENT_SECRET:'ebay-secret',STATE_SECRET:'state-secret',GATEWAY_TOKENS:'tok:alice'};
 const saved:Record<string,string|undefined>={};
 for(const [k,v] of Object.entries(secrets)){saved[k]=process.env[k];process.env[k]=v;}
 const savedModel=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='codex-model-key';
 process.env.HERMES_CHECKOUT=dir;process.env.HERMES_PYTHON=fake;process.env.EMPLOYEE_DATA_DIR=dir;
 const db=new Store(':memory:');
 try{
  const run=db.put('alice','run',{id:'r',task:'Anything',context:{attachments:[]},status:'working'});db.put('alice','agent',{id:'agent',skills:[]});
  await new HermesProvider(db,new ToolGateway(db)).run('alice',run,AbortSignal.timeout(20000));
  assert.ok(existsSync(dump),'the runtime subprocess started');
  const childEnv=JSON.parse(readFileSync(dump,'utf8'));
  for(const name of Object.keys(secrets))assert.equal(childEnv[name],undefined,`${name} must not reach the model runtime`);
  // The model provider's own credential is the one thing it legitimately needs,
  // which is how a Codex-through-Hermes provider is configured at all.
  assert.equal(childEnv.OPENAI_API_KEY,'codex-model-key');
  assert.equal(childEnv.HERMES_HOME?.startsWith(dir),true,'each owner gets its own Hermes home');
 }finally{
  db.close();
  for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
  if(savedModel===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=savedModel;
  for(const k of ['HERMES_CHECKOUT','HERMES_PYTHON','EMPLOYEE_DATA_DIR'])delete process.env[k];
  rmSync(dir,{recursive:true,force:true});
 }
});
