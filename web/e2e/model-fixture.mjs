// A local OpenAI-compatible model, so the employee's decisions in an end-to-end
// run are fixed and the test asserts the system's behaviour rather than a live
// model's wording. No provider credential is involved.
import {createServer} from 'node:http';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const call = (name, args) => ({role: 'assistant', content: null, tool_calls: [{index: 0, id: `call-${name}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]});

const reply = (task, alreadyCalledTool, toolResults = 0) => {
  // Browsing it does itself, in a browser it opens: one step per turn.
  if (/\bsurf\b/i.test(task)) {
    if (toolResults === 0) return call('browser_open', {purpose: 'Check the hardware shop for the Moen 1222 cartridge'});
    if (toolResults === 1) return call('browser_goto', {url: process.env.E2E_SHOP_URL});
    if (toolResults === 2) return call('browser_read', {});
    return {role: 'assistant', content: 'The hardware shop has the Moen 1222 cartridge: 3 in stock.'};
  }
  if (alreadyCalledTool && /\blook up\b|\bversion\b|\bweather\b|\bjacket\b/i.test(task)) {
    return {role: 'assistant', content: 'I read the package registry. The latest published version is listed there under dist-tags.'};
  }
  if (alreadyCalledTool && /\bbrowse\b/i.test(task)) return {role: 'assistant', content: 'I checked the spec sheet in the browser.'};
  if (alreadyCalledTool) return {role: 'assistant', content: 'Done. The note is saved as task evidence.'};
  // Work that needs a real website: the employee asks for a browser, which is
  // approval-gated, and the owner can watch it and take it over.
  if (/\bbrowse\b/i.test(task)) {
    return {role: 'assistant', content: null, tool_calls: [{index: 0, id: 'call-1', type: 'function', function: {name: 'browser_work', arguments: JSON.stringify({task: 'Find the M6 bolt spec sheet'})}}]};
  }
  if (/\bnote\b|\bdocument\b/i.test(task)) {
    return {role: 'assistant', content: null, tool_calls: [{index: 0, id: 'call-1', type: 'function', function: {name: 'document_create', arguments: JSON.stringify({name: 'Site note', text: 'Two boxes of M6 bolts are left on the shelf.'})}}]};
  }
  // An information question the employee cannot answer from memory: it has to
  // go and read something. The URL is a real public one, so this exercises the
  // whole path rather than a stubbed fetch.
  if (/\blook up\b|\bversion\b|\bweather\b|\bjacket\b/i.test(task)) {
    return {role: 'assistant', content: null, tool_calls: [{index: 0, id: 'call-1', type: 'function', function: {name: 'web_read', arguments: JSON.stringify({url: 'https://registry.npmjs.org/tsx'})}}]};
  }
  if (/\bprice\b|\bsuppliers?\b/i.test(task)) {
    return {role: 'assistant', content: null, tool_calls: [{index: 0, id: 'call-1', type: 'function', function: {name: 'products_search', arguments: JSON.stringify({description: 'M6 bolt 20-pack', quantity: 2})}}]};
  }
  if (/\bask\b|\bmissing\b/i.test(task)) {
    return {role: 'assistant', content: null, tool_calls: [{index: 0, id: 'call-1', type: 'function', function: {name: 'ask_user', arguments: JSON.stringify({question: 'Which room should I use?'})}}]};
  }
  return {role: 'assistant', content: 'The shelf holds two boxes of bolts.'};
};

export function startModelFixture() {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/models')) {res.end(JSON.stringify({data: [{id: 'fixture-model'}]})); return;}
    if (!req.url?.endsWith('/chat/completions')) {res.statusCode = 404; res.end('{}'); return;}
    const input = JSON.parse(body || '{}');
    const messages = input.messages ?? [];
    const task = messages.filter(m => m.role === 'user').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join(' ');
    // A task the caller asked to take a while, so cancellation and surviving a
    // disconnect have something in flight to act on.
    if (/\bslowly\b/i.test(task)) await sleep(Number(process.env.E2E_SLOW_MS ?? 8000));
    const toolResults = messages.filter(m => m.role === 'tool').length;
    // Once its browser is open, it pauses a moment before the next step, so the owner can take over first.
    if (/\bsurf\b/i.test(task) && toolResults === 1) await sleep(Number(process.env.E2E_SURF_PAUSE_MS ?? 5000));
    const message = reply(task, toolResults > 0, toolResults);
    const finish = message.tool_calls ? 'tool_calls' : 'stop';
    if (input.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end(
        `data: ${JSON.stringify({id: 'fx', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{index: 0, delta: message, finish_reason: null}]})}\n\n` +
        `data: ${JSON.stringify({id: 'fx', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{index: 0, delta: {}, finish_reason: finish}]})}\n\n` +
        'data: [DONE]\n\n',
      );
      return;
    }
    res.end(JSON.stringify({id: 'fx', object: 'chat.completion', created: 1, model: 'fixture-model', choices: [{index: 0, message, finish_reason: finish}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
  });
  server.listen(0);
  return new Promise(resolve => server.on('listening', () => resolve({server, port: server.address().port})));
}
