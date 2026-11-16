// Adapted from Puppeteer 25.4.0 ExtensionTransport (Apache-2.0, Google Inc.).
// Only the browser/tab roots are emulated. Puppeteer owns real frame/session topology.
export class DebuggerTransport {
  onmessage;
  onclose;
  #debugger;
  #closed = false;
  #page;
  #tab;
  constructor(debuggerApi, info) {
    this.#debugger = debuggerApi;
    this.#page = { ...info, type: 'page', attached: true };
    this.#tab = { ...info, targetId: `tab:${info.targetId}`, type: 'tab' };
    debuggerApi.on('message', this.#event);
    debuggerApi.on('detach', this.#detach);
  }
  static async attach(contents) {
    contents.debugger.attach('1.3');
    try {
      const { targetInfo } = await contents.debugger.sendCommand('Target.getTargetInfo');
      return new DebuggerTransport(contents.debugger, targetInfo);
    } catch (error) { contents.debugger.detach(); throw error; }
  }
  #emit(message) {
    queueMicrotask(() => { if (!this.#closed) this.onmessage?.(JSON.stringify(message)); });
  }
  #event = (_event, method, params, sessionId) => {
    this.#emit({ method, params, sessionId: sessionId || 'root-page' });
  };
  #detach = () => this.close();
  send(message) {
    if (this.#closed) throw new Error('Debugger disconnected');
    const command = JSON.parse(message);
    const { id, method, params, sessionId } = command;
    const reply = result => this.#emit({ id, sessionId, result });
    if (!sessionId && method === 'Target.getBrowserContexts') return reply({ browserContextIds: [] });
    if (!sessionId && method === 'Target.setDiscoverTargets') {
      this.#emit({ method: 'Target.targetCreated', params: { targetInfo: this.#tab } });
      this.#emit({ method: 'Target.targetCreated', params: { targetInfo: this.#page } });
      return reply({});
    }
    if (method === 'Target.setAutoAttach' && (!sessionId || sessionId === 'root-tab')) {
      this.#emit({ method: 'Target.attachedToTarget', sessionId, params: {
        targetInfo: sessionId ? this.#page : this.#tab,
        sessionId: sessionId ? 'root-page' : 'root-tab', waitingForDebugger: false,
      } });
      return reply({});
    }
    if (method === 'Browser.close' || method === 'Target.createTarget') {
      return this.#emit({ id, sessionId, error: { code: -32601, message: 'Host owns page lifetime' } });
    }
    void this.#debugger.sendCommand(method, params, sessionId === 'root-page' ? undefined : sessionId)
      .then(reply, error => this.#emit({ id, sessionId, error: { code: -32000, message: error.message } }));
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#debugger.removeListener('message', this.#event);
    this.#debugger.removeListener('detach', this.#detach);
    if (this.#debugger.isAttached()) this.#debugger.detach();
    this.onclose?.();
  }
}
