import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
let thread = 0;
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (!message.id) return;
  if (message.result && message.id === 'tool-1') {
    if (!message.result.success) return send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'Tool rejected' } } } });
    send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reply-1', delta: 'Inspected ' } });
    send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reply-1', delta: 'the page.' } });
    return send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  }
  if (message.method === 'initialize') return send({ id: message.id, result: { userAgent: 'codex-test/0.169.0' } });
  if (message.method === 'account/read') return send({ id: message.id, result: { account: { type: 'chatgpt', email: 'private@example.test', planType: 'pro' }, requiresOpenaiAuth: true } });
  if (message.method === 'model/list') return send({ id: message.id, result: { data: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture model', inputModalities: ['text', 'image'], isDefault: true }], nextCursor: null } });
  if (message.method === 'thread/start') {
    if (message.params.dynamicTools.some(tool => tool.type !== 'function')) return send({ id: message.id, error: { code: -32602, message: 'Installed schema requires DynamicToolSpec.type=function' } });
    return send({ id: message.id, result: { thread: { id: `thread-${++thread}` } } });
  }
  if (message.method === 'mcpServerStatus/list') return send({ id: message.id, result: { data: [], nextCursor: null } });
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: message.params.threadId, turn: { id: 'turn-1' } } });
    return send({ id: 'tool-1', method: 'item/tool/call', params: { threadId: message.params.threadId, turnId: 'turn-1', callId: 'call-1', tool: 'browser_observe', arguments: {} } });
  }
  send({ id: message.id, error: { code: -32601, message: 'Unsupported fixture method' } });
});
