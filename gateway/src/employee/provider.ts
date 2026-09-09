import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {mkdirSync,existsSync} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {Store,type Row} from './db.js';import {ToolGateway} from './tools.js';import {employeeContext} from './capabilities.js';import {selectedImages} from './artifacts.js';import {dataDir} from './config.js';
export interface AgentProvider{run(owner:string,run:Row,signal:AbortSignal):Promise<{result:string}>}
export function hermesHome(owner:string){return path.join(dataDir(),'hermes',createHash('sha256').update(owner).digest('hex'));}
export class HermesProvider implements AgentProvider{
 constructor(readonly db:Store,readonly tools:ToolGateway,readonly bridge=fileURLToPath(new URL('../../../hermes/bridge.py',import.meta.url))){}
 async run(owner:string,run:Row,signal:AbortSignal):Promise<{result:string}>{
  signal.throwIfAborted();const checkout=process.env.HERMES_CHECKOUT;if(!checkout||!existsSync(path.join(checkout,'run_agent.py')))throw Error('Hermes is not connected. Configure its server installation.');
  const python=process.env.HERMES_PYTHON??path.join(checkout,'.venv/bin/python'),profile=this.db.list(owner,'agent')[0],home=hermesHome(owner);mkdirSync(home,{recursive:true,mode:0o700});
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,LANG:'C.UTF-8',HERMES_HOME:home,PYTHONPATH:checkout,PYTHONUNBUFFERED:'1'};
  for(const k of ['SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','OPENAI_API_KEY','OPENROUTER_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','GEMINI_API_KEY'])if(process.env[k])env[k]=process.env[k];
  const history=this.db.list(owner,'message').filter(m=>m.conversationId===run.conversationId&&m.runId!==run.id).slice(0,8).reverse().map(m=>({role:m.role,content:m.text}));
  return new Promise((resolve,reject)=>{
   const child=spawn(python,[this.bridge],{cwd:checkout,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});let settled=false,seq=0,chain=Promise.resolve();
   const kill=()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}};
   const finish=(error?:Error,result?:string)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);kill();error?reject(error):resolve({result:result!});};
   const abort=()=>finish(Error('Task cancelled'));const timer=setTimeout(()=>finish(Error('Employee exceeded its execution time limit')),30*60_000);
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
   child.on('error',()=>finish(Error('Hermes Python environment could not start')));child.stdin.on('error',()=>finish(Error('Employee tool channel disconnected')));child.stderr.resume();
   const lines=createInterface({input:child.stdout});
   lines.on('line',line=>{chain=chain.then(async()=>{if(settled)return;let m:any;try{m=JSON.parse(line);}catch{return;}if(m.type==='result'){finish(undefined,m.result);return;}if(m.type==='error'){finish(Error('Hermes could not finish. Check provider authentication.'));return;}if(m.type!=='tool')return;
    let reply:any;try{reply=await this.tools.wait(owner,run.id,m.name,m.args,`${run.id}:${++seq}`,signal);}catch(e){reply={error:e instanceof Error?e.message:'Capability failed'};}
    if(!settled)child.stdin.write(JSON.stringify(reply)+'\n');
   }).catch(()=>finish(Error('Employee tool channel failed')));});
   child.on('close',()=>{void chain.finally(()=>finish(Error('Hermes exited without a result')));});
   child.stdin.write(JSON.stringify({runId:run.id,sessionId:profile?.id??owner,task:run.task,images:selectedImages(this.db,owner,run),instructions:employeeContext(this.db,owner,run),history,tools:this.tools.definitions(owner),provider:profile?.provider??process.env.HERMES_PROVIDER,model:profile?.model??process.env.HERMES_MODEL,baseUrl:process.env.HERMES_BASE_URL,apiKey:process.env.HERMES_API_KEY})+'\n');
  });
 }
}
