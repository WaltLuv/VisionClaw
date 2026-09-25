import path from 'node:path';
import {config} from '../config.js';import {validLiveViewHosts} from './browser.js';
export const dataDir=()=>path.resolve(process.env.EMPLOYEE_DATA_DIR??path.dirname(config.storePath));
export const databasePath=()=>process.env.EMPLOYEE_DB_PATH??path.join(dataDir(),'employee.sqlite');
export const publicUrl=()=>String(process.env.PUBLIC_BASE_URL??'http://localhost:8788').replace(/\/$/,'');
export function validateEmployeeConfig(){
 if(process.env.AGENT_RUNTIME&&!['anthropic','hermes','claude'].includes(process.env.AGENT_RUNTIME))throw Error('AGENT_RUNTIME must be anthropic, hermes or claude');
 // These become part of the app's Content-Security-Policy, so only plain host names are accepted.
 if(!validLiveViewHosts())throw Error('BROWSER_LIVE_VIEW_HOSTS must be host names separated by commas, like live.example.com');
 if(process.env.NODE_ENV==='production'&&!publicUrl().startsWith('https://'))throw Error('PUBLIC_BASE_URL must be an HTTPS URL in production');
 // OAuth state is signed with it. Without one, app connections fall back to a secret anyone can read in this repository.
 if(process.env.NODE_ENV==='production'&&(process.env.STATE_SECRET??'').length<32)throw Error('STATE_SECRET must be a long random value in production: at least 32 characters, for example from openssl rand -hex 32');
 for(const name of ['RUN_CAPACITY','COMPUTER_CAPACITY'])if(process.env[name]&&!/^[1-9]\d?$/.test(process.env[name]!))throw Error(`${name} must be between 1 and 99`);
}
