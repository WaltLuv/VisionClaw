import Anthropic from "@anthropic-ai/sdk";
let client:Anthropic|undefined;
export const anthropic=new Proxy({} as Anthropic,{get(_target,key){client??=new Anthropic();const value=Reflect.get(client,key);return typeof value==="function"?value.bind(client):value;}});
