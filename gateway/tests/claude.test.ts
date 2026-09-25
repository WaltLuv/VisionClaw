import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer,request} from 'node:http';import {mkdtempSync,rmSync,readFileSync,existsSync,statSync} from 'node:fs';import {execFileSync} from 'node:child_process';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {z} from 'zod';
import {Store} from '../src/employee/db.js';import {ToolGateway} from '../src/employee/tools.js';import {ClaudeCodeProvider,CLAUDE_TOOL_PREFIX} from '../src/employee/claude.js';import {selectRuntime} from '../src/employee/provider.js';

/**
 * Claude Code as a runtime, on the owner's own Claude subscription.
 *
 * Most of these drive a stand-in CLI (fixtures/fake-claude.mjs) that speaks
 * Claude Code's stream-json protocol and acts as the MCP client of the
 * gateway's REAL bridge, socket channel and ToolGateway. Only the model's
 * choices are scripted, so the assertions are about governance, not wording.
 *
 * The last test runs the real, unmodified `claude` binary wherever that is
 * safe (see its skip conditions).
 */
const FAKE=fileURLToPath(new URL('./fixtures/fake-claude.mjs',import.meta.url));
const tmp=mkdtempSync(path.join(os.tmpdir(),'vc-claude-test-'));process.on('exit',()=>rmSync(tmp,{recursive:true,force:true}));
process.env.CLAUDE_CODE_OWNER='alice';
let n=0;const recordFile=()=>path.join(tmp,`record-${++n}.json`);
const waitFor=async(check:()=>boolean,what:string,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error(`Timed out waiting for ${what}`);};
function harness(owner='alice',task='Check the part'){
 const db=new Store(':memory:'),tools=new ToolGateway(db);
 db.put(owner,'agent',{id:'agent',skills:[],instructions:'Verify before you answer.'});
 const run=db.put(owner,'run',{id:'run-1',task,context:{attachments:[]},status:'working'});
 return {db,tools,run};
}
const fake=(db:Store,tools:ToolGateway,script:object,env:NodeJS.ProcessEnv={})=>new ClaudeCodeProvider(db,tools,{bin:FAKE,env:{FAKE_CLAUDE_SCRIPT:JSON.stringify(script),...env},timeoutMs:30000});
const lookup=(onRun:()=>void)=>({id:'fixture_lookup',description:'Look up verified fixture evidence',effect:'read' as const,schema:z.object({query:z.string()}),run:async()=>{onRun();return {evidence:'stock:3'};}});

test('Claude Code runs a governed read through the gateway and returns the verified result',async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 let executed=0;tools.register(lookup(()=>executed++));
 const record=recordFile();
 const out=await fake(db,tools,{calls:[{name:'fixture_lookup',arguments:{query:'part'}}],final:'Verified {results}'},{FAKE_CLAUDE_RECORD:record}).run('alice',run,AbortSignal.timeout(30000));
 assert.equal(out.result,'Verified {"evidence":"stock:3"}');
 assert.equal(executed,1);
 assert.equal(db.list('alice','artifact').filter(a=>a.kind==='tool_receipt').length,1,'a receipt of what the brain actually did');
 const started=db.events('alice').find(e=>e.type==='runtime.started');
 assert.deepEqual(started?.tools,[`${CLAUDE_TOOL_PREFIX}fixture_lookup`],'the owner can see exactly which tools the brain had');

 const rec=JSON.parse(readFileSync(record,'utf8')),arg=(f:string)=>rec.argv[rec.argv.indexOf(f)+1];
 assert.equal(arg('--tools'),'','every one of Claude Code\'s own tools is switched off');
 assert.ok(rec.argv.includes('--strict-mcp-config'),'no MCP server from the machine\'s own configuration');
 assert.equal(arg('--allowedTools'),`${CLAUDE_TOOL_PREFIX}fixture_lookup`);
 assert.equal(arg('--permission-mode'),'dontAsk');
 assert.equal(arg('--permission-prompts'),'none','anything not allowed is refused, never asked of nobody');
 assert.ok(!rec.argv.includes('--dangerously-skip-permissions')&&!rec.argv.includes('--bare'));
 assert.match(rec.system,/All side effects go through governed tools/,'the employee\'s standing instructions are the system prompt');
 assert.deepEqual(rec.message.message.content,[{type:'text',text:'Check the part'}]);
 assert.ok(!existsSync(path.dirname(arg('--mcp-config'))),'the run\'s private directory is removed afterwards');
});

test('a camera still reaches Claude Code as an image, not a description',async t=>{
 const {db,tools}=harness();t.after(()=>db.close());
 const photo=db.put('alice','artifact',{id:'photo-1',kind:'photo',mime:'image/jpeg',base64:Buffer.from('fake-jpeg').toString('base64')});
 const run=db.put('alice','run',{id:'run-2',task:'What is this?',context:{attachments:[photo.id]},status:'working'});
 const record=recordFile();
 await fake(db,tools,{final:'A part.'},{FAKE_CLAUDE_RECORD:record}).run('alice',run,AbortSignal.timeout(30000));
 const content=JSON.parse(readFileSync(record,'utf8')).message.message.content;
 assert.deepEqual(content[1],{type:'image',source:{type:'base64',media_type:'image/jpeg',data:Buffer.from('fake-jpeg').toString('base64')}});
});

// Anthropic: no application may "route requests through Free, Pro, or Max plan
// credentials on behalf of their users". Another owner's task would be exactly that.
test('only the owner whose subscription it is can have tasks run on it',async t=>{
 const {db,tools,run}=harness('bob');t.after(()=>db.close());
 const record=recordFile();
 await assert.rejects(()=>fake(db,tools,{},{FAKE_CLAUDE_RECORD:record}).run('bob',run,AbortSignal.timeout(30000)),/only carry out that owner's tasks/);
 assert.equal(existsSync(record),false,'Claude Code is never started for anyone else');
 const saved=process.env.CLAUDE_CODE_OWNER;delete process.env.CLAUDE_CODE_OWNER;
 try{await assert.rejects(()=>fake(db,tools,{}).run('alice',run,AbortSignal.timeout(30000)),/not set up/);}finally{process.env.CLAUDE_CODE_OWNER=saved;}
});

test('a purchase waits for the owner and is charged only after approval',async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 let charged=0;tools.register({id:'purchase_order',description:'Place a purchase order',effect:'financial',schema:z.object({total:z.number()}),run:async a=>{charged+=a.total;return {orderId:'PO-1',total:a.total};}});
 const done=fake(db,tools,{calls:[{name:'purchase_order',arguments:{total:149.99}}],final:'{results}'}).run('alice',run,AbortSignal.timeout(30000));
 await waitFor(()=>db.list('alice','approval').length===1,'the purchase to stop for approval');
 assert.equal(charged,0,'nothing is bought while the owner has not answered');
 assert.equal(db.get('alice','run',run.id)?.status,'needs_user');
 tools.decide('alice',db.list('alice','approval')[0].id,'once');
 assert.match((await done).result,/"orderId":"PO-1"/);
 assert.equal(charged,149.99);
});

test('a declined message is never sent and Claude Code is told it was declined',async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 let sent=0;tools.register({id:'send_sms',description:'Send a text message',effect:'communication',schema:z.object({to:z.string(),body:z.string()}),run:async()=>{sent++;return {sid:'SM1'};}});
 const done=fake(db,tools,{calls:[{name:'send_sms',arguments:{to:'+15555550100',body:'Hi'}}],final:'{results}'}).run('alice',run,AbortSignal.timeout(30000));
 await waitFor(()=>db.list('alice','approval').length===1,'the message to stop for approval');
 tools.decide('alice',db.list('alice','approval')[0].id,'deny');
 assert.match((await done).result,/declined/i);
 assert.equal(sent,0);
});

test('a Claude Code that starts with any tool the gateway does not govern is stopped before doing anything',async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 let executed=0;tools.register(lookup(()=>executed++));
 await assert.rejects(()=>fake(db,tools,{extraTools:['Bash'],calls:[{name:'fixture_lookup',arguments:{query:'part'}}]}).run('alice',run,AbortSignal.timeout(30000)),/does not govern/);
 assert.equal(executed,0,'the call that raced the startup report was refused, not run');
 await assert.rejects(()=>fake(db,tools,{extraServers:[{name:'filesystem',status:'connected'}]}).run('alice',run,AbortSignal.timeout(30000)),/could not reach the employee tools/);
});

test('Claude Code receives no service keys and no API key: it signs in with its own login',async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 const secrets={ANTHROPIC_API_KEY:'sk-ant-api-key',CLAUDE_CODE_OAUTH_TOKEN:'oauth-token',BROWSER_USE_API_KEY:'bu',TWILIO_AUTH_TOKEN:'tw',RETELL_API_KEY:'rt',STATE_SECRET:'st',GATEWAY_TOKENS:'tok:alice',GATEWAY_SERVICE_TOKEN:'svc'};
 const saved:Record<string,string|undefined>={};for(const [k,v] of Object.entries(secrets)){saved[k]=process.env[k];process.env[k]=v;}
 const record=recordFile();
 try{await fake(db,tools,{final:'ok'},{FAKE_CLAUDE_RECORD:record}).run('alice',run,AbortSignal.timeout(30000));}
 finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
 const env=JSON.parse(readFileSync(record,'utf8')).env;
 for(const k of Object.keys(secrets))assert.equal(env[k],undefined,`${k} must not reach Claude Code`);
 assert.equal(env.HOME,process.env.HOME,'HOME is how Claude Code finds the login its owner made');
 assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,'1');
 assert.ok(Number(env.MCP_TOOL_TIMEOUT)>=30*60_000,'a call may wait out a 30-minute approval');
});

test('the tool channel is private to its run',async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 tools.register({id:'purchase_order',description:'Place a purchase order',effect:'financial',schema:z.object({total:z.number()}),run:async()=>({orderId:'PO-9'})});
 const record=recordFile(),abort=new AbortController();
 const done=fake(db,tools,{calls:[{name:'purchase_order',arguments:{total:5}}]},{FAKE_CLAUDE_RECORD:record}).run('alice',run,abort.signal);
 await waitFor(()=>db.list('alice','approval').length===1,'the run to be waiting');
 const {mcp,argv}=JSON.parse(readFileSync(record,'utf8')),{VC_SOCKET:socket,VC_TOKEN:token}=mcp.mcpServers.visionclaw.env;
 assert.equal(statSync(path.dirname(argv[argv.indexOf('--mcp-config')+1])).mode&0o777,0o700,'only the service user can reach the socket');
 const post=(auth:string|null)=>new Promise<number>(resolve=>{const r=request({socketPath:socket,path:'/call',method:'POST',headers:auth?{authorization:auth}:{}},res=>{res.resume();resolve(res.statusCode!);});r.end(JSON.stringify({name:'purchase_order',arguments:{total:5}}));});
 assert.equal(await post(null),401);
 assert.equal(await post(`Bearer ${'0'.repeat(token.length)}`),401,'a guessed token is refused');
 abort.abort();
 await assert.rejects(()=>done,/cancelled/i);
 assert.equal(existsSync(socket),false,'the channel is gone once the run ends');
});

test('Claude Code\'s own error text never reaches the owner; a next step does',async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 await assert.rejects(()=>fake(db,tools,{fail:true}).run('alice',run,AbortSignal.timeout(30000)),(e:Error)=>/doctor/.test(e.message)&&!/sk-ant|\/home\//.test(e.message));
 await assert.rejects(()=>fake(db,tools,{crash:true}).run('alice',run,AbortSignal.timeout(30000)),/did not start/);
 await assert.rejects(()=>new ClaudeCodeProvider(db,tools,{bin:path.join(tmp,'no-such-claude')}).run('alice',run,AbortSignal.timeout(30000)),/not installed/);
});

test('an owner set to Claude Code is routed to it, and a started run keeps it',()=>{
 assert.equal(selectRuntime({id:'a',runtime:'claude'},{id:'r'}),'claude');
 assert.equal(selectRuntime({id:'a',runtime:'anthropic'},{id:'r',runtime:'claude'}),'claude');
 assert.equal(selectRuntime({id:'a',runtime:'claude'},{id:'r',runtime:'hermes'}),'hermes');
});

// ---------------------------------------------------------------------------
// The real binary. Claude Code is pointed at a fixture Messages API on
// loopback with a fixture key and an empty HOME, so on an ordinary machine it
// has no credential but the fixture's and nowhere else to send traffic.
//
// Skipped inside a Claude Code cloud session that has a network: there the
// CLI is bound to that session's own account and does not honour
// ANTHROPIC_BASE_URL, so a model call would bill that account. Offline (e.g.
// `unshare -rn`) it runs: the startup contract is checked, and the model half
// is skipped with the reason if the fixture never hears from the CLI.
const realBin=(()=>{try{return process.env.CLAUDE_CODE_BIN??execFileSync('sh',['-c','command -v claude'],{encoding:'utf8'}).trim();}catch{return '';}})();
const online=Object.values(os.networkInterfaces()).flat().some(a=>a&&!a.internal);
const skipReal=!realBin?'Claude Code is not installed (set CLAUDE_CODE_BIN)':process.env.CLAUDE_CODE_REMOTE&&online?'inside a Claude Code cloud session with a network, the CLI would bill that session\'s account; run offline with `unshare -rn` or on the server':false;

test('the unmodified Claude Code binary gets only the governed tools and completes a governed call',{skip:skipReal,timeout:180000},async t=>{
 const {db,tools,run}=harness();t.after(()=>db.close());
 let executed=0;tools.register(lookup(()=>executed++));
 const seen:any[]=[];
 const model=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};seen.push({path:req.url,body});
  if(req.method!=='POST'||!req.url?.startsWith('/v1/messages')||req.url.includes('count_tokens')){res.writeHead(req.url?.includes('count_tokens')?200:404,{'content-type':'application/json'});res.end(req.url?.includes('count_tokens')?'{"input_tokens":1}':'{}');return;}
  const results=(body.messages??[]).flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((c:any)=>c.type==='tool_result'):[]);
  const tool=(body.tools??[]).map((x:any)=>x.name).find((x:string)=>x.endsWith('fixture_lookup'));
  // How Claude Code wraps an MCP result for the API is its business; what matters is that the gateway's evidence arrived.
  const text=results.length?(JSON.stringify(results).includes('stock:3')?'Verified stock:3':'Tool result did not carry the evidence'):'OK';
  const block=tool&&!results.length?{type:'tool_use',id:'toolu_fixture',name:tool,input:{query:'part'}}:{type:'text',text};
  const stop=block.type==='tool_use'?'tool_use':'end_turn',msg={id:'msg_fixture',type:'message',role:'assistant',model:body.model??'fixture',content:[] as any[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}};
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({...msg,content:[block],stop_reason:stop}));return;}
  const ev=(type:string,data:object)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  res.writeHead(200,{'content-type':'text/event-stream'});ev('message_start',{message:msg});
  if(block.type==='tool_use'){ev('content_block_start',{index:0,content_block:{...block,input:{}}});ev('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});}
  else{ev('content_block_start',{index:0,content_block:{type:'text',text:''}});ev('content_block_delta',{index:0,delta:{type:'text_delta',text:block.text}});}
  ev('content_block_stop',{index:0});ev('message_delta',{delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:1}});ev('message_stop',{});res.end();
 });
 model.listen(0,'127.0.0.1');await new Promise<void>(r=>model.on('listening',()=>r()));t.after(()=>{model.closeAllConnections();model.close();});
 const home=mkdtempSync(path.join(tmp,'home-')),abort=new AbortController();
 const done=new ClaudeCodeProvider(db,tools,{bin:realBin,timeoutMs:150000,env:{HOME:home,ANTHROPIC_API_KEY:'fixture-key',ANTHROPIC_BASE_URL:`http://127.0.0.1:${(model.address() as any).port}`,HTTPS_PROXY:'http://127.0.0.1:9',HTTP_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost'}}).run('alice',run,abort.signal);
 done.catch(()=>{});
 await waitFor(()=>db.events('alice').some(e=>e.type==='runtime.started'),'Claude Code to report its startup tools',90000);
 const started=db.events('alice').find(e=>e.type==='runtime.started')!;
 assert.deepEqual(started.tools,[`${CLAUDE_TOOL_PREFIX}fixture_lookup`],'the real binary starts with the governed tool and nothing else');
 assert.deepEqual(started.servers,['visionclaw:connected']);
 try{await waitFor(()=>seen.some(s=>s.path?.startsWith('/v1/messages')),'the fixture model to be called',20000);}
 catch{abort.abort();await done.catch(()=>{});t.skip('startup contract verified; this Claude Code build does not send model traffic to ANTHROPIC_BASE_URL, so the model half cannot run here');return;}
 assert.equal((await done).result,'Verified stock:3');
 assert.equal(executed,1);
 const offered=seen.filter(s=>s.body.tools?.length).map(s=>s.body.tools.map((x:any)=>x.name));
 assert.ok(offered.length&&offered.every(names=>names.every((x:string)=>x.startsWith(CLAUDE_TOOL_PREFIX))),'the model is never offered one of Claude Code\'s own tools');
});

test('the phone is told Claude Code is ready only when it is this owner\'s and signed in',async()=>{
 const {claudeCodeStatus}=await import('../src/employee/claude-status.js');
 const env={PATH:process.env.PATH};
 assert.equal(await claudeCodeStatus('alice',{bin:FAKE,env:{...env,FAKE_CLAUDE_LOGGED_IN:'1'},cacheMs:0}),true);
 assert.equal(await claudeCodeStatus('alice',{bin:FAKE,env:{...env,FAKE_CLAUDE_LOGGED_IN:'0'},cacheMs:0}),false,'installed but not signed in');
 assert.equal(await claudeCodeStatus('bob',{bin:FAKE,env:{...env,FAKE_CLAUDE_LOGGED_IN:'1'},cacheMs:0}),false,'someone else\'s subscription');
 assert.equal(await claudeCodeStatus('alice',{bin:path.join(tmp,'no-such-claude'),env,cacheMs:0}),false,'not installed');
});

test('a slow sign-in check never holds up the phone',async()=>{
 const {claudeCodeStatus}=await import('../src/employee/claude-status.js');
 const opts={bin:FAKE,env:{PATH:process.env.PATH,HOME:path.join(tmp,'slow-home'),FAKE_CLAUDE_LOGGED_IN:'1',FAKE_CLAUDE_SLOW_MS:'1500'},waitMs:100};
 const started=Date.now();
 assert.equal(await claudeCodeStatus('alice',opts),false,'no answer yet, so not ready yet');
 assert.ok(Date.now()-started<1000,'the phone was not kept waiting for the check');
 let ready=false;for(const end=Date.now()+10000;!ready&&Date.now()<end;){ready=await claudeCodeStatus('alice',opts);if(!ready)await new Promise(r=>setTimeout(r,100));}
 assert.equal(ready,true,'the answer lands on a later refresh');
 const again=Date.now();assert.equal(await claudeCodeStatus('alice',opts),true);assert.ok(Date.now()-again<200,'and is served at once from then on');
});
