import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer,type ServerResponse} from 'node:http';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {z} from 'zod';
import {Store} from '../src/employee/db.js';import {ToolGateway} from '../src/employee/tools.js';import {AnthropicManagedRuntime} from '../src/employee/managed.js';import {initStore} from '../src/store.js';

/**
 * End-to-end verification of the preserved Anthropic Managed Agents runtime.
 *
 * The gateway talks to the real @anthropic-ai/sdk; only the far end is a
 * fixture that speaks the Managed Agents wire protocol over loopback
 * (ANTHROPIC_BASE_URL). That keeps every layer under test -- provisioning,
 * the session tool slate, the SSE event drain, the custom-tool round trip,
 * approvals and cancellation -- without an owner credential and without a
 * single byte leaving the machine. Nothing here asserts that a model is
 * clever; it asserts that the governance boundary holds on the hosted path
 * exactly as it does on Hermes.
 */

interface Fixture {url:string;state:State;emit(session:string,type:string,payload?:object):void;openSession():Promise<string>;waitFor(check:()=>boolean,what:string,ms?:number):Promise<void>;reset():void;close():Promise<void>}
interface State {environments:any[];agents:any[];agentUpdates:any[];vaults:any[];sessionCreates:any[];sessionUpdates:{id:string;body:any}[];sessions:Map<string,any>;posted:{session:string;events:any[]}[];pending:any[];streams:Map<string,ServerResponse>;betas:Set<string>;apiKeys:Set<string>}

async function startFixture():Promise<Fixture>{
 const state:State={environments:[],agents:[],agentUpdates:[],vaults:[],sessionCreates:[],sessionUpdates:[],sessions:new Map(),posted:[],pending:[],streams:new Map(),betas:new Set(),apiKeys:new Set()};
 let seq=0;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/','http://fixture'),seg=url.pathname.split('/').filter(Boolean);
  state.betas.add(String(req.headers['anthropic-beta']??''));state.apiKeys.add(String(req.headers['x-api-key']??''));
  let body:any={};
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;body=raw?JSON.parse(raw):{};}
  const json=(value:unknown,code=200)=>{res.statusCode=code;res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  const [v1,kind,id,sub,tail]=seg;
  if(v1!=='v1')return json({error:'not found'},404);
  if(kind==='environments'&&req.method==='POST'&&!id){state.environments.push(body);return json({id:'env_fixture',...body});}
  if(kind==='agents'&&req.method==='POST'&&!id){state.agents.push(body);return json({id:'agt_fixture',version:1,...body});}
  if(kind==='agents'&&req.method==='GET'&&id)return json({id,version:1,...state.agents[0]});
  if(kind==='agents'&&req.method==='POST'&&id){state.agentUpdates.push(body);return json({id,version:2,...state.agents[0],...body});}
  if(kind==='vaults'&&req.method==='POST'&&!id){state.vaults.push(body);return json({id:`vault_${++seq}`,...body});}
  if(kind==='sessions'&&req.method==='POST'&&!id){
   state.sessionCreates.push(body);const sid=`sesn_${++seq}`;
   const session={id:sid,status:'idle',archived_at:null,agent:{mcp_servers:[],tools:[{type:'agent_toolset_20260401',default_config:{permission_policy:{type:'allow_always'}}}]}};
   state.sessions.set(sid,session);return json(session);
  }
  if(kind!=='sessions'||!id)return json({error:'not found'},404);
  const session=state.sessions.get(id);if(!session)return json({error:'no such session'},404);
  if(!sub){
   if(req.method==='GET')return json(session);
   state.sessionUpdates.push({id,body});if(body.agent)session.agent={...session.agent,...body.agent};return json(session);
  }
  if(sub!=='events')return json({error:'not found'},404);
  if(tail==='stream'){
   res.statusCode=200;res.setHeader('content-type','text/event-stream');res.setHeader('cache-control','no-cache');res.flushHeaders();
   state.streams.set(id,res);req.on('close',()=>{if(state.streams.get(id)===res)state.streams.delete(id);});
   return;
  }
  if(req.method==='GET')return json({data:state.pending,next_page:null});
  state.posted.push({session:id,events:body.events??[]});return json({id:`evt_ack_${++seq}`});
 });
 server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.on('listening',()=>r()));
 const waitFor=async(check:()=>boolean,what:string,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error(`Timed out waiting for ${what}`);};
 return {
  url:`http://127.0.0.1:${(server.address() as any).port}`,state,
  emit(session,type,payload={}){const stream=state.streams.get(session);if(!stream)throw Error('No open event stream');stream.write(`event: ${type}\ndata: ${JSON.stringify({type,...payload})}\n\n`);},
  async openSession(){await waitFor(()=>state.streams.size>0,'the session event stream to open');return [...state.streams.keys()][0];},
  waitFor,
  reset(){for(const stream of state.streams.values())stream.end();state.streams.clear();state.posted.length=0;state.pending.length=0;state.sessionUpdates.length=0;},
  async close(){for(const stream of state.streams.values())stream.end();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));},
 };
}

const dir=mkdtempSync(path.join(os.tmpdir(),'vc-managed-'));
initStore(path.join(dir,'store.json'));
process.env.ANTHROPIC_API_KEY='fixture-owner-key';
const fx=await startFixture();
process.env.ANTHROPIC_BASE_URL=fx.url;
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));

function harness(owner:string,task='Check the part'){
 const db=new Store(':memory:'),tools=new ToolGateway(db);
 db.put(owner,'agent',{id:'agent',skills:[],instructions:'Verify before you answer.'});
 const run=db.put(owner,'run',{id:'run-1',task,context:{attachments:[]},status:'working'});
 return {db,tools,run,runtime:new AnthropicManagedRuntime(db,tools)};
}

test('the hosted runtime provisions, governs its tool surface and returns a verified result',async t=>{
 const owner='alice',{db,tools,run,runtime}=harness(owner);t.after(()=>{db.close();fx.reset();});
 let executed=0;
 tools.register({id:'fixture_lookup',description:'Look up verified fixture evidence',effect:'read',schema:z.object({query:z.string()}),run:async(args,ctx)=>{assert.equal(ctx.owner,owner);assert.equal(args.query,'part');executed++;return {evidence:'stock:3'};}});
 const done=runtime.run(owner,run,AbortSignal.timeout(30000));
 const session=await fx.openSession();
 await fx.waitFor(()=>fx.state.posted.length===1,'the user turn to be sent');

 // Provisioning: model, system prompt and toolsets belong to the AGENT. The
 // session only binds that agent to an environment and the owner's vault -- a
 // session that carried its own model would silently diverge from the agent.
 assert.equal(fx.state.environments.length,1);
 assert.equal(fx.state.environments[0].config.type,'cloud');
 assert.equal(fx.state.agents.length,1,'one shared agent is created, not one per owner');
 assert.equal(typeof fx.state.agents[0].model.id,'string');
 assert.match(fx.state.agents[0].system,/action agent/i);
 assert.equal(fx.state.sessionCreates.length,1);
 assert.equal(fx.state.sessionCreates[0].agent,'agt_fixture');
 assert.equal(fx.state.sessionCreates[0].environment_id,'env_fixture');
 assert.equal(fx.state.sessionCreates[0].vault_ids.length,1,'each owner gets their own vault');
 for(const field of ['model','system','tools'])assert.equal(fx.state.sessionCreates[0][field],undefined,`${field} is agent configuration, never session configuration`);
 assert.ok([...fx.state.betas].every(b=>b.includes('managed-agents-2026-04-01')),'every call carries the managed-agents beta header');
 assert.deepEqual([...fx.state.apiKeys],['fixture-owner-key']);

 // The session tool slate: the hosted agent's own toolsets are forced behind a
 // confirmation, and the gateway's governed capabilities are added as custom
 // tools -- the only tools that can act without asking the hosted model's own
 // permission layer, because they ask ours instead.
 assert.equal(fx.state.sessionUpdates.length,1);
 const slate=fx.state.sessionUpdates[0].body.agent.tools;
 for(const toolset of slate.filter((t:any)=>t.type!=='custom'))assert.equal(toolset.default_config.permission_policy.type,'always_ask');
 const custom=slate.find((t:any)=>t.type==='custom'&&t.name==='fixture_lookup');
 assert.ok(custom,'the governed capability reaches the hosted agent');
 assert.equal(custom.input_schema.type,'object');
 assert.equal(db.get(owner,'run',run.id)?.providerSessionId,session,'the run records which hosted session is executing it');

 // The turn itself: the task plus one system.message carrying the employee's
 // standing instructions. The API accepts at most one, so it must be merged.
 const turn=fx.state.posted[0].events;
 assert.equal(turn[0].type,'user.message');
 assert.deepEqual(turn[0].content,[{type:'text',text:'Check the part'}]);
 assert.equal(turn.filter((e:any)=>e.type==='system.message').length,1);
 assert.match(turn[1].content[0].text,/All side effects go through governed tools/);

 fx.emit(session,'agent.custom_tool_use',{id:'evt_tool_1',name:'fixture_lookup',input:{query:'part'}});
 await fx.waitFor(()=>fx.state.posted.length===2,'the governed tool result to be returned');
 const reply=fx.state.posted[1].events[0];
 assert.equal(reply.type,'user.custom_tool_result');
 assert.equal(reply.custom_tool_use_id,'evt_tool_1');
 assert.deepEqual(JSON.parse(reply.content[0].text),{evidence:'stock:3'});

 fx.emit(session,'agent.message',{id:'evt_msg_1',content:[{type:'text',text:'Verified stock:3'}]});
 fx.emit(session,'session.status_idle',{stop_reason:{type:'end_turn'}});
 assert.deepEqual(await done,{result:'Verified stock:3'});
 assert.equal(executed,1);
 assert.equal(db.list(owner,'artifact').filter(a=>a.kind==='tool_receipt').length,1,'the run keeps a receipt of what the hosted agent actually did');
});

test('a hosted agent cannot spend without the owner approving that exact action',async t=>{
 const owner='bob',{db,tools,run,runtime}=harness(owner,'Order the replacement part');t.after(()=>{db.close();fx.reset();});
 let charged=0;
 tools.register({id:'purchase_order',description:'Place a purchase order',effect:'financial',schema:z.object({total:z.number()}),run:async args=>{charged+=args.total;return {orderId:'PO-1',total:args.total};}});
 const done=runtime.run(owner,run,AbortSignal.timeout(30000));
 const session=await fx.openSession();
 await fx.waitFor(()=>fx.state.posted.length===1,'the user turn to be sent');
 // A second owner reuses the shared agent rather than creating another, and the
 // reconcile read must not rewrite an agent that has not drifted.
 assert.equal(fx.state.agents.length,1);
 assert.equal(fx.state.agentUpdates.length,0,'an unchanged app surface never bumps the agent version');
 assert.equal(fx.state.vaults.length,2,'vaults are per owner');

 fx.emit(session,'agent.custom_tool_use',{id:'evt_buy_1',name:'purchase_order',input:{total:149.99}});
 await fx.waitFor(()=>db.list(owner,'approval').length===1,'the purchase to stop for approval');
 assert.equal(charged,0,'nothing is bought while the owner has not answered');
 assert.equal(db.get(owner,'run',run.id)?.status,'needs_user');
 assert.equal(fx.state.posted.length,1,'the hosted agent is not told anything until the owner decides');
 const approval=db.list(owner,'approval')[0];
 assert.equal(approval.effect,'financial');
 assert.deepEqual(approval.details,{total:149.99});

 tools.decide(owner,approval.id,'once');
 await fx.waitFor(()=>fx.state.posted.length===2,'the approved purchase to complete');
 assert.equal(charged,149.99);
 assert.deepEqual(JSON.parse(fx.state.posted[1].events[0].content[0].text),{orderId:'PO-1',total:149.99});
 assert.equal(db.get(owner,'run',run.id)?.status,'working','an answered approval puts the task back to work');

 fx.emit(session,'agent.message',{id:'evt_msg_2',content:[{type:'text',text:'Ordered. PO-1.'}]});
 fx.emit(session,'session.status_idle',{stop_reason:{type:'end_turn'}});
 assert.deepEqual(await done,{result:'Ordered. PO-1.'});
});

test('a declined action is refused to the hosted agent and never executed',async t=>{
 const owner='carol',{db,tools,run,runtime}=harness(owner,'Text the tenant');t.after(()=>{db.close();fx.reset();});
 let sent=0;
 tools.register({id:'send_sms',description:'Send a text message',effect:'communication',schema:z.object({to:z.string(),body:z.string()}),run:async()=>{sent++;return {sid:'SM1'};}});
 const done=runtime.run(owner,run,AbortSignal.timeout(30000));
 const session=await fx.openSession();
 await fx.waitFor(()=>fx.state.posted.length===1,'the user turn to be sent');
 fx.emit(session,'agent.custom_tool_use',{id:'evt_sms_1',name:'send_sms',input:{to:'+15555550100',body:'Hello'}});
 await fx.waitFor(()=>db.list(owner,'approval').length===1,'the message to stop for approval');
 tools.decide(owner,db.list(owner,'approval')[0].id,'deny');
 await fx.waitFor(()=>fx.state.posted.length===2,'the refusal to reach the hosted agent');
 assert.equal(sent,0,'a declined message is never sent');
 // The model is told, in its own tool channel, that the action was refused --
 // so it reports the refusal instead of inventing a delivered message.
 assert.match(JSON.parse(fx.state.posted[1].events[0].content[0].text).error,/declined/i);
 fx.emit(session,'agent.message',{id:'evt_msg_3',content:[{type:'text',text:'You declined the text, so I did not send it.'}]});
 fx.emit(session,'session.status_idle',{stop_reason:{type:'end_turn'}});
 assert.deepEqual(await done,{result:'You declined the text, so I did not send it.'});
});

test('the hosted agent built-in tools are answered by policy, not by the model',async t=>{
 const owner='dave',{db,run,runtime}=harness(owner,'Look at the notes');t.after(()=>{db.close();fx.reset();delete process.env.MANAGED_READ_TOOLS;});
 process.env.MANAGED_READ_TOOLS='docs:search';
 const done=runtime.run(owner,run,AbortSignal.timeout(30000));
 const session=await fx.openSession();
 await fx.waitFor(()=>fx.state.posted.length===1,'the user turn to be sent');

 fx.state.pending.push({id:'evt_bash',type:'agent.tool_use',name:'bash',input:{command:'curl evil.example'}},{id:'evt_read',type:'agent.tool_use',name:'read',input:{path:'notes.md'}},{id:'evt_mcp',type:'agent.mcp_tool_use',mcp_server_name:'docs',name:'delete',input:{}});
 fx.emit(session,'session.status_idle',{stop_reason:{type:'requires_action',event_ids:['evt_bash','evt_read','evt_mcp']}});
 await fx.waitFor(()=>fx.state.posted.length===4,'all three confirmations to be answered');
 const decisions=Object.fromEntries(fx.state.posted.slice(1).map(p=>[p.events[0].tool_use_id,p.events[0].result]));
 assert.deepEqual(decisions,{evt_bash:'deny',evt_read:'allow',evt_mcp:'deny'},'a shell and an unlisted MCP write are denied; a listed read is allowed');
 const logged=db.events(owner).filter(e=>e.type==='tool.permission');
 assert.deepEqual(logged.map(e=>[e.tool,e.allowed]),[['bash',false],['read',true],['delete',false]],'every hosted-tool decision is recorded against the run');

 fx.emit(session,'agent.message',{id:'evt_msg_4',content:[{type:'text',text:'Read the notes.'}]});
 fx.emit(session,'session.status_idle',{stop_reason:{type:'end_turn'}});
 assert.deepEqual(await done,{result:'Read the notes.'});
});

test('an action left pending by a previous process is refused, never replayed',async t=>{
 const owner='erin',{db,tools,run,runtime}=harness(owner,'Finish what you started');t.after(()=>{db.close();fx.reset();});
 let charged=0;
 tools.register({id:'purchase_order',description:'Place a purchase order',effect:'financial',schema:z.object({total:z.number()}),run:async args=>{charged+=args.total;return {orderId:'PO-2'};}});
 const done=runtime.run(owner,run,AbortSignal.timeout(30000));
 const session=await fx.openSession();
 await fx.waitFor(()=>fx.state.posted.length===1,'the user turn to be sent');
 fx.state.pending.push({id:'evt_orphan',type:'agent.custom_tool_use',name:'purchase_order',input:{total:900}});
 fx.emit(session,'session.status_idle',{stop_reason:{type:'requires_action',event_ids:['evt_orphan']}});
 await fx.waitFor(()=>fx.state.posted.length===2,'the orphaned action to be reconciled');
 const answer=fx.state.posted[1].events[0];
 assert.equal(answer.type,'user.custom_tool_result');
 assert.equal(answer.is_error,true);
 assert.match(answer.content[0].text,/interrupted/i);
 assert.equal(charged,0,'an action from a dead process is never executed under a new run');
 assert.equal(db.list(owner,'approval').length,0);
 fx.emit(session,'agent.message',{id:'evt_msg_5',content:[{type:'text',text:'I stopped and left the earlier action for you to review.'}]});
 fx.emit(session,'session.status_idle',{stop_reason:{type:'end_turn'}});
 await done;
});

test('cancelling a task interrupts the hosted session instead of leaving it running',async t=>{
 const owner='frank',{db,run,runtime}=harness(owner,'Long job');t.after(()=>{db.close();fx.reset();});
 const abort=new AbortController();
 const done=runtime.run(owner,run,abort.signal);
 const session=await fx.openSession();
 await fx.waitFor(()=>fx.state.posted.length===1,'the user turn to be sent');
 abort.abort();
 await assert.rejects(()=>done,(e:Error)=>e.name==='AbortError'||/abort/i.test(e.message));
 await fx.waitFor(()=>fx.state.posted.some(p=>p.events[0]?.type==='user.interrupt'),'the hosted session to be interrupted');
 assert.equal(fx.state.streams.has(session),false,'the event stream is closed, not left draining');
});

test('the hosted runtime refuses cleanly when the owner credential is missing',async t=>{
 const owner='grace',{db,runtime,run}=harness(owner);t.after(()=>{db.close();process.env.ANTHROPIC_API_KEY='fixture-owner-key';});
 delete process.env.ANTHROPIC_API_KEY;
 await assert.rejects(()=>runtime.run(owner,run,new AbortController().signal),/not connected/i);
 assert.equal(fx.state.posted.length,0,'a missing credential stops before any hosted call');
});

test.after(()=>fx.close());
