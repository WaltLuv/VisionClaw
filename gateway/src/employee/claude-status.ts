import {execFile} from 'node:child_process';import {claudeEnv} from './claude.js';
/**
 * Whether Claude Code can take this owner's tasks: it is theirs, it is
 * installed, and it says it is signed in. The answer comes from Claude Code
 * itself (`claude auth status`); the gateway reads only `loggedIn` and never
 * touches the login.
 *
 * The phone asks on every refresh and waits for the answer, and the check may
 * go online. So a known answer is returned at once and re-checked behind it,
 * and the very first one is waited for only briefly.
 */
const cache=new Map<string,{at:number;ok:boolean}>(),inflight=new Map<string,Promise<boolean>>();
const check=(bin:string,env:NodeJS.ProcessEnv)=>new Promise<boolean>(resolve=>execFile(bin,['auth','status','--json'],{timeout:15000,env},(err,stdout)=>{
 if(err){resolve(false);return;}
 try{resolve(JSON.parse(stdout).loggedIn===true);}catch{resolve(false);}
}));
export async function claudeCodeStatus(owner:string,{bin=process.env.CLAUDE_CODE_BIN??'claude',env=claudeEnv(),cacheMs=60_000,waitMs=5_000}:{bin?:string;env?:NodeJS.ProcessEnv;cacheMs?:number;waitMs?:number}={}):Promise<boolean>{
 if(!process.env.CLAUDE_CODE_OWNER||owner!==process.env.CLAUDE_CODE_OWNER)return false;
 if(!cacheMs)return check(bin,env);
 const key=[bin,env.HOME,env.CLAUDE_CONFIG_DIR].join('\0'),hit=cache.get(key);
 if(!inflight.has(key)&&(!hit||Date.now()-hit.at>=cacheMs))inflight.set(key,check(bin,env).then(ok=>{cache.set(key,{at:Date.now(),ok});return ok;}).finally(()=>inflight.delete(key)));
 if(hit)return hit.ok;
 return Promise.race([inflight.get(key)!,new Promise<boolean>(r=>setTimeout(()=>r(false),waitMs).unref())]);
}
