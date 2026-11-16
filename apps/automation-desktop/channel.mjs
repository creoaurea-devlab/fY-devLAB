import { randomUUID } from 'node:crypto';

/** A bounded authenticated channel over an inherited process pipe, never a listening socket. */
export function channel({ peer, token, handle, timeoutMs = 20000 }) {
  const pending = new Map(); let closed = false, incoming = 0;
  const send = message => {
    if (closed || !peer.connected) throw new Error('Automation host disconnected');
    const envelope = { version: 1, token, ...message };
    if (Buffer.byteLength(JSON.stringify(envelope)) > 8 * 1024 * 1024) throw new Error('Automation message exceeds 8 MiB');
    peer.send(envelope, error => { if (error) close(); });
  };
  const receive = async message => {
    if (!message || message.version !== 1 || message.token !== token || typeof message.id !== 'string' || message.id.length > 120) return;
    if (Buffer.byteLength(JSON.stringify(message)) > 8 * 1024 * 1024) return close();
    if (message.type === 'result') {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
    } else if (message.type === 'request') {
      if (incoming >= 32) { try { send({ id: message.id, type: 'result', error: 'Automation receiver full' }); } catch { /* Disconnected owner */ } return; }
      incoming++;
      try {
        const result = await handle(message.method, message.args);
        send({ id: message.id, type: 'result', result });
      } catch (error) { try { send({ id: message.id, type: 'result', error: error.message }); } catch { /* Disconnected owner */ } }
      finally { incoming--; }
    }
  };
  const close = () => {
    if (closed) return; closed = true;
    peer.off('message', receive); peer.off('disconnect', close);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Automation host disconnected; operation outcome may be unknown')); }
    pending.clear();
  };
  peer.on('message', receive); peer.on('disconnect', close);
  return {
    call(method, args = {}) {
      if (pending.size >= 32) return Promise.reject(new Error('Automation channel full'));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Automation operation timed out; outcome may be unknown')); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { send({ id, type: 'request', method, args }); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    }, close,
  };
}
