/**
 * Keeps credentials out of anything that leaves the process: error bodies sent
 * to a client, and structured logs. Two independent passes, because either one
 * alone misses the common case.
 *
 * By name: a field called token/secret/api_key is replaced whatever it holds,
 * which covers a nested provider error object we have never seen before.
 *
 * By value: the process's own secrets are scrubbed out of free text, which is
 * where they actually appear -- an upstream failure quoting the request URL, a
 * stack trace with a header in it. A name-only pass would let that straight
 * through because the string is just a message.
 */
const SECRET_NAME=/(secret|token|password|passphrase|api[_-]?key|apikey|authorization|credential|cookie|signature|bearer|private[_-]?key|client[_-]?secret)/i;
const PLACEHOLDER='[redacted]';
// Short values would match far too much ordinary text; real credentials are long.
const MIN_SECRET_LENGTH=8;

/** Secret values held by this process, longest first so an embedded prefix cannot leave a tail behind. */
export function processSecrets(env:NodeJS.ProcessEnv=process.env):string[]{
 return [...new Set(Object.entries(env).filter(([k,v])=>SECRET_NAME.test(k)&&typeof v==='string'&&v.length>=MIN_SECRET_LENGTH).map(([,v])=>v!))].sort((a,b)=>b.length-a.length);
}

export function redactText(text:string,secrets=processSecrets()):string{
 let out=text;for(const secret of secrets)if(secret&&out.includes(secret))out=out.split(secret).join(PLACEHOLDER);return out;
}

/** Recursive: nested objects, arrays, Errors and cyclic references all get the same treatment. */
export function redact(value:unknown,secrets=processSecrets(),seen=new WeakSet<object>(),depth=0):unknown{
 if(typeof value==='string')return redactText(value,secrets);
 if(value===null||typeof value!=='object')return value;
 if(depth>8)return '[truncated]';
 if(seen.has(value))return '[circular]';
 seen.add(value);
 if(value instanceof Error)return {name:value.name,message:redactText(value.message,secrets)};
 if(Array.isArray(value))return value.map(v=>redact(v,secrets,seen,depth+1));
 return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v])=>[k,SECRET_NAME.test(k)?PLACEHOLDER:redact(v,secrets,seen,depth+1)]));
}
