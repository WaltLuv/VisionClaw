import {test} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {installEmployee} from '../src/employee/routes.js';import {initStore} from '../src/store.js';
test('scheduled work starts for another owner while a long assignment is running',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'vc-schedule-'));process.env.EMPLOYEE_DATA_DIR=dir;process.env.EMPLOYEE_DB_PATH=path.join(dir,'db.sqlite');initStore(path.join(dir,'legacy.json'));
 let release!:()=>void;const hold=new Promise<void>(r=>release=r);const started:string[]=[];
 const e=installEmployee(express(),()=>null,()=>false,async(owner)=>{started.push(owner);if(owner==='alice')await hold;return {result:'Finished'};});
 try{e.q.create('alice',{task:'Long work'},'one');await new Promise(r=>setTimeout(r,1150));assert.deepEqual(started,['alice']);e.db.create('bob','workflow',{name:'Research',task:'Short work',scheduledAt:new Date(0).toISOString(),enabled:true});await new Promise(r=>setTimeout(r,1200));assert.deepEqual(started,['alice','bob']);}finally{release();await new Promise(r=>setTimeout(r,10));e.stop();e.db.close();rmSync(dir,{recursive:true});delete process.env.EMPLOYEE_DATA_DIR;delete process.env.EMPLOYEE_DB_PATH;}
});
