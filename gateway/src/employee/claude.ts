import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {createServer} from 'node:http';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {randomBytes,timingSafeEqual} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {Store,type Row} from './db.js';import {ToolGateway} from './tools.js';import {employeeContext} from './capabilities.js';import {selectedImages} from './artifacts.js';import type {AgentProvider} from './provider.js';

/**
 * Claude Code as the employee's brain, signed in with the owner's own Claude
 * subscription.
 *
 * Anthropic allows "an end user signing in to the unmodified Claude Code
 * binary with their own Claude subscription", and does not allow an
 * application to "collect, store, or intermediate Claude.ai credentials" or to
 * "route requests through Free, Pro, or Max plan credentials on behalf of
 * their users" (code.claude.com/docs/en/legal-and-compliance). So:
 *  - the owner signs Claude Code in themselves, through Anthropic's own flow
 *    (`claude auth login`, as the service user). This file never reads,
 *    stores or forwards any Claude credential, and never passes an API key;
 *  - the binary is run exactly as published;
 *  - only the one owner named in CLAUDE_CODE_OWNER can have tasks run on it,
 *    because anyone else's task would be running on that owner's plan.
 *
 * Governance is the same as for every other runtime: all of Claude Code's own
 * tools are switched off, and the only tools it has are the gateway's governed
 * capabilities, reached through claude-bridge.mjs. The startup report is
 * checked on every run, so a future Claude Code that quietly re-enabled a
 * built-in tool would stop the run rather than widen what the employee can do.
 */
export const CLAUDE_TOOL_PREFIX='mcp__visionclaw__';
const BRIDGE=fileURLToPath(new URL('./claude-bridge.mjs',import.meta.url));
export interface ClaudeCodeOptions{bin?:string;/** Merged over the allowlisted environment; tests point Claude Code at a fixture model with it. */env?:NodeJS.ProcessEnv;timeoutMs?:number}

/** The fixed part of the command line. Exported so the offline contract test runs exactly what production runs. */
export function claudeArgs(mcpConfig:string,systemPrompt:string,allowed:string[],model?:string){
 return ['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
  '--tools','',                          // every built-in tool off: no shell, files, web or agents
  '--strict-mcp-config','--mcp-config',mcpConfig, // no MCP server but ours, whatever the machine has configured
  '--permission-mode','dontAsk','--permission-prompts','none', // anything not allowed below is refused, never asked
  '--allowedTools',allowed.join(','),
  '--disable-slash-commands','--no-session-persistence',
  '--system-prompt-file',systemPrompt,
  ...(model?['--model',model]:[])];
}

/** Model credentials are Claude Code's own business; the gateway's service keys must never reach it. */
export function claudeEnv(extra:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv{
 const env:NodeJS.ProcessEnv={PATH:process.env.PATH,LANG:'C.UTF-8',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',
  // A governed call can wait on the owner's approval for up to its 30-minute expiry.
  MCP_TOOL_TIMEOUT:String(35*60_000),MCP_TIMEOUT:'30000'};
 // HOME is how Claude Code finds the login the owner made; the gateway never opens it.
 for(const k of ['HOME','USER','CLAUDE_CONFIG_DIR','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'])if(process.env[k])env[k]=process.env[k];
 return {...env,...extra};
}

export class ClaudeCodeProvider implements AgentProvider{
 constructor(readonly db:Store,readonly tools:ToolGateway,readonly options:ClaudeCodeOptions={}){}
 async run(owner:string,run:Row,signal:AbortSignal):Promise<{result:string}>{
  signal.throwIfAborted();
  const allowedOwner=process.env.CLAUDE_CODE_OWNER;
  if(!allowedOwner)throw Error('Claude Code is not set up on this server.');
  if(owner!==allowedOwner)throw Error("Claude Code on this server runs on its owner's own Claude subscription, so it can only carry out that owner's tasks.");
  const defs=this.tools.definitions(owner),allowed=defs.map(d=>CLAUDE_TOOL_PREFIX+d.name),known=new Set(allowed);
  const dir=mkdtempSync(path.join(tmpdir(),'vc-claude-')),work=path.join(dir,'work');mkdirSync(work,{mode:0o700});
  const socket=path.join(dir,'tools.sock'),token=randomBytes(32).toString('hex'),expected=Buffer.from(`Bearer ${token}`);
  const history=this.db.list(owner,'message').filter(m=>m.conversationId===run.conversationId&&m.runId!==run.id).slice(0,8).reverse().map(m=>`${m.role==='user'?'Owner':'You'}: ${String(m.text).slice(0,2000)}`);
  const system=employeeContext(this.db,owner,run)+(history.length?`\nRecent conversation, oldest first:\n${history.join('\n')}`:'');
  writeFileSync(path.join(dir,'system.txt'),system,{mode:0o600});
  writeFileSync(path.join(dir,'mcp.json'),JSON.stringify({mcpServers:{visionclaw:{type:'stdio',command:process.execPath,args:[BRIDGE],env:{VC_SOCKET:socket,VC_TOKEN:token}}}}),{mode:0o600});
  let seq=0,verify!:(ok:boolean)=>void;
  // No capability runs until Claude Code's startup report has been checked:
  // the report and the first call travel on different pipes, so without this
  // a call could land before a bad report was read.
  const verified=new Promise<boolean>(resolve=>{verify=resolve;});
  const channel=createServer(async(req,res)=>{
   const reply=(code:number,value:unknown)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));};
   const auth=Buffer.from(String(req.headers.authorization??''));
   if(req.method!=='POST'||auth.length!==expected.length||!timingSafeEqual(auth,expected)){reply(401,{error:'Not this run'});return;}
   let body:any={};try{let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw||'{}');}catch{reply(400,{error:'Unreadable request'});return;}
   if(req.url==='/tools'){reply(200,{tools:defs.map(({name,description,parameters})=>{const {$schema:_,...schema}=parameters as Record<string,unknown>;return {name,description,inputSchema:{...schema,type:'object'}};})});return;}
   if(req.url!=='/call'||typeof body.name!=='string'){reply(404,{error:'Unknown request'});return;}
   if(!await verified){reply(200,{result:{error:'This run was stopped before any work was done'},isError:true});return;}
   try{reply(200,{result:await this.tools.wait(owner,run.id,body.name,body.arguments,`${run.id}:${++seq}`,signal)});}
   catch(e){reply(200,{result:{error:e instanceof Error?e.message:'Capability failed'},isError:true});}
  });
  await new Promise<void>((resolve,reject)=>{channel.once('error',reject);channel.listen(socket,()=>resolve());});
  const content:any[]=[{type:'text',text:String(run.task)},...selectedImages(this.db,owner,run).map((data:string)=>({type:'image',source:{type:'base64',media_type:'image/jpeg',data}}))];
  const cleanup=()=>{channel.closeAllConnections();channel.close();rmSync(dir,{recursive:true,force:true});};
  try{
   return await new Promise<{result:string}>((resolve,reject)=>{
    const child=spawn(this.options.bin??process.env.CLAUDE_CODE_BIN??'claude',claudeArgs(path.join(dir,'mcp.json'),path.join(dir,'system.txt'),allowed,process.env.CLAUDE_CODE_MODEL),{cwd:work,env:claudeEnv(this.options.env),stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    let settled=false,started=false;
    const kill=()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const finish=(error?:Error,result?:string)=>{if(settled)return;settled=true;verify(false);clearTimeout(timer);signal.removeEventListener('abort',abort);kill();error?reject(error):resolve({result:result!});};
    const abort=()=>finish(Error('Task cancelled'));
    const timer=setTimeout(()=>finish(Error('Employee exceeded its execution time limit')),this.options.timeoutMs??30*60_000);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
    child.on('error',()=>finish(Error('Claude Code is not installed on this server.')));child.stdin.on('error',()=>{});child.stderr.resume();
    createInterface({input:child.stdout}).on('line',line=>{
     let m:any;try{m=JSON.parse(line);}catch{return;}
     if(m.type==='system'&&m.subtype==='init'){
      started=true;
      // What the brain could actually use on this run, on the record for the owner.
      this.db.event(owner,'runtime.started',{runId:run.id,runtime:'claude',tools:m.tools??[],servers:(m.mcp_servers??[]).map((s:any)=>`${s.name}:${s.status}`)});
      const extra=(m.tools??[]).filter((t:string)=>!known.has(t)),servers=(m.mcp_servers??[]) as {name:string;status:string}[];
      if(extra.length){finish(Error('Claude Code started with a tool this app does not govern, so the task was stopped. Update the gateway before using this Claude Code version.'));return;}
      if(servers.some(s=>s.name!=='visionclaw')||servers.find(s=>s.name==='visionclaw')?.status!=='connected'){finish(Error('Claude Code could not reach the employee tools, so the task was stopped.'));return;}
      verify(true);return;
     }
     if(m.type!=='result')return;
     if(m.subtype==='success'&&!m.is_error&&typeof m.result==='string'){finish(undefined,m.result);return;}
     // Claude Code's own error text can carry paths and account details; the owner gets a next step instead.
     finish(Error('Claude Code could not finish this task. Check that it is signed in on the server: bash deploy/doctor.sh'));
    });
    child.on('close',()=>finish(Error(started?'Claude Code stopped without a result.':'Claude Code did not start. Check it is installed and signed in: bash deploy/doctor.sh')));
    child.stdin.end(JSON.stringify({type:'user',message:{role:'user',content}})+'\n');
   });
  }finally{cleanup();}
 }
}
