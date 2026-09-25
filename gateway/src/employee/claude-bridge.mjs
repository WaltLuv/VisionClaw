// Claude Code starts this as its only MCP server. It exposes the gateway's
// governed capabilities and nothing else, and it holds no logic of its own:
// every list and every call is forwarded to the gateway run that launched it,
// over a Unix socket in that run's private directory, carrying that run's
// token. Approvals, ownership, idempotency and receipts all stay in the
// gateway's ToolGateway exactly as they are for Hermes and Managed Agents.
//
// Plain JavaScript on purpose: Claude Code runs it with `node` directly, so it
// must not need a TypeScript loader.
import {request} from 'node:http';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';

const socketPath = process.env.VC_SOCKET, token = process.env.VC_TOKEN;
if (!socketPath || !token) {
  process.stderr.write('visionclaw bridge: missing run channel\n');
  process.exit(2);
}

// No timeout here: a governed call can legitimately wait many minutes for the
// owner to approve it on their phone. Claude Code's own MCP_TOOL_TIMEOUT, set
// by the gateway, is the one clock on this hop.
function ask(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const req = request({socketPath, path, method: 'POST', headers: {'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: `Bearer ${token}`}}, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {text += chunk;});
      res.on('end', () => {
        try {
          const value = JSON.parse(text || '{}');
          res.statusCode === 200 ? resolve(value) : reject(new Error(value.error ?? `Gateway refused (${res.statusCode})`));
        } catch {reject(new Error('Gateway sent an unreadable reply'));}
      });
    });
    req.on('error', () => reject(new Error('The gateway run that owns this tool channel has ended')));
    req.end(payload);
  });
}

const server = new Server({name: 'visionclaw', version: '1.0.0'}, {capabilities: {tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: (await ask('/tools')).tools}));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const reply = await ask('/call', {name: request.params.name, arguments: request.params.arguments ?? {}});
    return {content: [{type: 'text', text: JSON.stringify(reply.result)}], isError: !!reply.isError};
  } catch (e) {
    return {content: [{type: 'text', text: JSON.stringify({error: e instanceof Error ? e.message : 'Capability failed'})}], isError: true};
  }
});
await server.connect(new StdioServerTransport());
