import { Kernel } from '@devlab/kernel';
import { agenticPlugin } from '../../plugins/agentic/src/index.mjs';
import { channel } from './channel.mjs';

if (!process.send) throw new Error('Agentic runtime requires an inherited private channel');
let kernel, connection;
process.once('message', async message => {
  try {
    if (message?.type !== 'init' || typeof message.token !== 'string' || message.token.length !== 64 || message.version !== 1) throw new Error('Invalid host startup');
    connection = channel({ peer: process, token: message.token, handle: async (method, args) => {
      if (!kernel || kernel.phase !== 'ready') throw new Error('Agentic runtime not ready');
      const service = kernel.service('agentic');
      if (method === 'list') return service.list();
      if (method === 'ensure') return service.ensure(args.contextId);
      if (method === 'start') return service.start(args.sessionId, args.input);
      if (method === 'stop') return service.stop(args.sessionId);
      if (method === 'memory') return service.memory(args.sessionId, args.operation, args.arguments);
      if (method === 'close') { await kernel.close(); return { closed: true }; }
      throw new Error('Unknown Agentic operation');
    } });
    kernel = new Kernel(['automation.agentic']);
    await kernel.start([agenticPlugin({ ...message.config, browser: {
      observe: contextId => connection.call('browser.observe', { contextId }),
      release: contextId => connection.call('browser.release', { contextId }),
    } })]);
    await connection.call('hostReady', { version: 1 });
  } catch (error) { console.error('Agentic startup failed:', error.message); process.exitCode = 1; process.disconnect(); }
});
process.once('disconnect', () => { void kernel?.close().finally(() => process.exit()); });
