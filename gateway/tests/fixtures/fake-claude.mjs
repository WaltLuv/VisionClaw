#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: the same stream-json protocol and
// the same MCP client role, driving the gateway's real bridge. Everything on
// the gateway side of the bridge is the production path; only the model's
// decisions are scripted (FAKE_CLAUDE_SCRIPT).
import {readFileSync, writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const argv = process.argv.slice(2), flag = n => {const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1];};
if (argv[0] === 'auth') {if (process.env.FAKE_CLAUDE_SLOW_MS) await new Promise(r => setTimeout(r, Number(process.env.FAKE_CLAUDE_SLOW_MS))); process.stdout.write(JSON.stringify({loggedIn: process.env.FAKE_CLAUDE_LOGGED_IN === '1'})); process.exit(0);}
const out = v => process.stdout.write(JSON.stringify(v) + '\n');
const script = JSON.parse(process.env.FAKE_CLAUDE_SCRIPT ?? '{}');
const message = await new Promise(resolve => createInterface({input: process.stdin}).once('line', l => resolve(JSON.parse(l))));
if (process.env.FAKE_CLAUDE_RECORD) writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({argv, env: process.env, message, system: readFileSync(flag('--system-prompt-file'), 'utf8'), mcp: JSON.parse(readFileSync(flag('--mcp-config'), 'utf8'))}));
if (script.crash) process.exit(3);

const {command, args, env} = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8')).mcpServers.visionclaw;
const client = new Client({name: 'fake-claude', version: '0'});
await client.connect(new StdioClientTransport({command, args, env: {...env, PATH: process.env.PATH ?? ''}}));
const tools = (await client.listTools()).tools.map(t => `mcp__visionclaw__${t.name}`);
out({type: 'system', subtype: 'init', tools: [...tools, ...(script.extraTools ?? [])], mcp_servers: [{name: 'visionclaw', status: 'connected'}, ...(script.extraServers ?? [])]});
if (process.env.FAKE_CLAUDE_READY) writeFileSync(process.env.FAKE_CLAUDE_READY, '1');

const seen = [];
for (const call of script.calls ?? []) {
  const r = await client.callTool({name: call.name, arguments: call.arguments});
  seen.push(r.content?.[0]?.text ?? '');
}
if (script.fail) out({type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 401 {"error":"invalid x-api-key sk-ant-SECRET at /home/owner/.claude"}'});
else out({type: 'result', subtype: 'success', is_error: false, result: (script.final ?? 'done').replace('{results}', seen.join(' | '))});
await client.close();
