import {createHash,randomBytes} from 'node:crypto';
import type {Request,Response} from 'express';
import {Store} from './db.js';
export const tokenHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export type GrantCheck=(owner:string,hash:string)=>boolean;
export function session(db:Store,req:Request,valid:GrantCheck){
 const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('vc_session='))?.slice(11);if(!token)return null;
 const hash=tokenHash(token),s=db.sql.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash,Date.now());
 if(!s)return null;
 if(!valid(String(s.owner),String(s.grant_hash))){db.sql.prepare('DELETE FROM sessions WHERE hash=?').run(hash);return null;}
 return {owner:String(s.owner),csrf:String(s.csrf),hash};
}
export function issueSession(db:Store,res:Response,owner:string,accessToken:string){const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.sql.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(tokenHash(token),owner,csrf,Date.now()+7*86400_000,tokenHash(accessToken));res.cookie('vc_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:7*86400_000});return csrf;}
