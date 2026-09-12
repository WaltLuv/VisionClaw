// A local OpenAI-compatible model, so the employee's decisions in an end-to-end
// run are fixed and the test asserts the system's behaviour rather than a live
// model's wording. No provider credential is involved.
import {createServer} from 'node:http';

const reply = (task, alreadyCalledTool) => {
  if (alreadyCalledTool) return {role: 'assistant', content: 'Done. The note is saved as task evidence.'};
  if (/\bnote\b|\bdocument\b/i.test(task)) {
    return {role: 'assistant', content: null, tool_calls: [{index: 0, id: 'call-1', type: 'function', function: {name: 'document_create', arguments: JSON.stringify({name: 'Site note', text: 'Two boxes of M6 bolts are left on the shelf.'})}}]};
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
    const message = reply(task, messages.some(m => m.role === 'tool'));
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
