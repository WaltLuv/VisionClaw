import type {AgentProvider} from './provider.js';import {Store,type Row} from './db.js';import {ToolGateway} from './tools.js';import {employeeContext} from './capabilities.js';import {selectedImages} from './artifacts.js';
import {ensureUser} from '../provision.js';import {anthropic} from '../cma.js';import {runTurn,turnHooks} from '../turn.js';
export function governedToolsets(sets:any[]){return sets.filter(t=>t.type!=='custom').map(t=>({...t,default_config:{enabled:true,permission_policy:{type:'always_ask'}},configs:(t.configs??[]).map((c:any)=>({...c,permission_policy:{type:'always_ask'}}))}));}
export function permittedManagedRead(event:any){
 if(event.type==='agent.tool_use')return ['read','glob','grep'].includes(event.name);
 if(event.type!=='agent.mcp_tool_use')return false;
 const key=`${event.mcp_server_name}:${event.name}`;
 return (process.env.MANAGED_READ_TOOLS??'').split(',').includes(key);
}
export class AnthropicManagedRuntime implements AgentProvider{
 constructor(readonly db:Store,readonly tools:ToolGateway){}
 async run(owner:string,run:Row,signal:AbortSignal){
  signal.throwIfAborted();if(!process.env.ANTHROPIC_API_KEY)throw Error('Hosted employee is not connected. Configure Anthropic or choose a configured Hermes runtime.');
  const {sessionId}=await ensureUser(owner);signal.throwIfAborted();const existing=await anthropic.beta.sessions.retrieve(sessionId);signal.throwIfAborted();
  await anthropic.beta.sessions.update(sessionId,{agent:{tools:[...governedToolsets(existing.agent?.tools??[]),...this.tools.definitions(owner).map(d=>({type:'custom' as const,name:d.name,description:d.description,input_schema:{...d.parameters,type:'object' as const}}))]}});
  signal.throwIfAborted();this.db.put(owner,'run',{...this.db.get(owner,'run',run.id)!,providerSessionId:sessionId});
  turnHooks.set(sessionId,{
   custom:async(event:any)=>{signal.throwIfAborted();try{return await this.tools.wait(owner,run.id,event.name,event.input,event.id,signal);}catch(e){return {error:e instanceof Error?e.message:'Capability failed'};}},
   confirm:async(event:any)=>{signal.throwIfAborted();const allow=permittedManagedRead(event);this.db.event(owner,'tool.permission',{runId:run.id,tool:event.name,server:event.mcp_server_name,allowed:allow});return allow;},
  });
  try{const images=selectedImages(this.db,owner,run);const result=await runTurn(sessionId,run.task,30*60_000,()=>{},[employeeContext(this.db,owner,run)],images[0],signal,images.slice(1));signal.throwIfAborted();if(result.deferred)throw Error('Hosted agent exceeded its execution time limit');return {result:result.text??''};}
  finally{turnHooks.delete(sessionId);}
 }
}
