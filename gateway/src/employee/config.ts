import path from 'node:path';
import {config} from '../config.js';
export const dataDir=()=>path.resolve(process.env.EMPLOYEE_DATA_DIR??path.dirname(config.storePath));
export const databasePath=()=>process.env.EMPLOYEE_DB_PATH??path.join(dataDir(),'employee.sqlite');
export const publicUrl=()=>String(process.env.PUBLIC_BASE_URL??'http://localhost:8788').replace(/\/$/,'');
export function validateEmployeeConfig(){
 if(process.env.AGENT_RUNTIME&&!['anthropic','hermes'].includes(process.env.AGENT_RUNTIME))throw Error('AGENT_RUNTIME must be anthropic or hermes');
 if(process.env.NODE_ENV==='production'&&!publicUrl().startsWith('https://'))throw Error('PUBLIC_BASE_URL must be an HTTPS URL in production');
 for(const name of ['RUN_CAPACITY','COMPUTER_CAPACITY'])if(process.env[name]&&!/^[1-9]\d?$/.test(process.env[name]!))throw Error(`${name} must be between 1 and 99`);
}
