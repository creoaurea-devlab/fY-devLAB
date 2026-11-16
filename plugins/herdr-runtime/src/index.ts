import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { lockController } from '@devlab/terminal-pty';
import { ApplicationError, HerdrCommandSchema, ProjectIdSchema, type HerdrSnapshot, type PluginDefinition, type TerminalSession } from '@devlab/contracts';
import { availability, capsule, privateDirectory, socketDirectory, herdrLauncher, HERDR_VERSION, HERDR_PROTOCOL, POLICY_REVISION } from './capsule.ts';
import { request, subscribe } from './protocol.ts';

export { availability as herdrAvailability, herdrLauncher } from './capsule.ts';
export { request as herdrRequest } from './protocol.ts';
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const Binding = z.object({ root: z.string(), pid: z.number().int().positive(), identity: z.string(), namespacePid: z.number().int().positive(), namespaceIdentity: z.string(), revision: z.literal(POLICY_REVISION) }).strict();
const Remote = z.object({ version: z.literal(HERDR_VERSION), protocol: z.literal(HERDR_PROTOCOL),
  workspaces: z.array(z.object({ workspace_id: z.string(), label: z.string(), focused: z.boolean() })).max(256),
  panes: z.array(z.object({ pane_id: z.string(), workspace_id: z.string(), tab_id: z.string(), label: z.string().nullish(), title: z.string().nullish(), focused: z.boolean(),
    agent: z.string().nullish(), agent_status: z.enum(['idle', 'working', 'blocked', 'done', 'unknown']) })).max(1024),
  layouts: z.array(z.object({ tab_id: z.string(), zoomed: z.boolean() })).max(1024),
});
async function identity(pid: number) {
  try { const s = await readFile(`/proc/${pid}/stat`, 'utf8'); const fields = s.slice(s.lastIndexOf(')') + 2).split(' '); return fields[0] === 'Z' ? null : fields[19] ?? null; }
  catch { return null; }
}

/** One independently contained server per admitted project. Browser commands carry
 * only IDs and bounded actions; all process arguments, mounts and policy are host-owned. */
export function herdrRuntime(options: { stateDirectory: string; binary?: string; bwrap?: string; preserveOnDispose?: boolean }): PluginDefinition {
  const binary = options.binary ?? join(homedir(), '.local/bin/herdr'), bwrap = options.bwrap ?? herdrLauncher();
  return {
    manifest: { id: 'herdr-runtime', version: '0.1.0', apiVersion: 1, provides: ['herdr'], requires: ['workspace', 'terminals'], capabilities: ['process:local', 'storage:local'], reload: 'restart' },
    async activate(scope) {
      const roots = scope.get('workspace'), terminals = scope.get('terminals');
      let alive = true, hasWriter = false;
      let writer: Promise<() => Promise<void>> | undefined;
      async function acquireWriter() {
        const directory = resolve(options.stateDirectory); await privateDirectory(directory);
        const file = await open(join(directory, 'host.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.()) throw new Error('Invalid Herdr host lock.');
          await lockController(file);
          return async () => { await file.close(); };
        } catch (error) {
          await file.close();
          throw new ApplicationError('CONFLICT', 'Herdr runtime store cannot be acquired: ' + (error as Error).message);
        }
      }
      const queues = new Map<string, Promise<unknown>>(), attachments = new Map<string, TerminalSession>();
      const watchers = new Set<() => void>();
      const owned = new Map<string, { launch: Awaited<ReturnType<typeof capsule>>; binding: z.infer<typeof Binding>; file: string }>();
      let probe: { expires: number; value: Promise<string | null> } | undefined;
      const available = () => {
        if (!probe || Date.now() > probe.expires) probe = { expires: Date.now() + 15000, value: availability(binary, bwrap) };
        return probe.value;
      };
      const active = () => { if (!alive) throw new ApplicationError('NOT_READY', 'Herdr host has closed.'); };
      async function paths(projectId: string) {
        const root = await realpath(await roots.resolve(ProjectIdSchema.parse(projectId), '.'));
        const key = createHash('sha256').update(projectId).digest('hex').slice(0, 20);
        const directory = join(resolve(options.stateDirectory), key);
        return { root, directory, file: join(directory, 'binding.json') };
      }
      async function savedBinding(p: Awaited<ReturnType<typeof paths>>) {
        let binding: z.infer<typeof Binding>;
        try {
          await privateDirectory(p.directory, false);
          const info = await lstat(p.file);
          if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw new Error('Invalid Herdr binding file.');
          binding = Binding.parse(JSON.parse(await readFile(p.file, 'utf8')));
        } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
        if (binding.root !== p.root) throw new ApplicationError('CONFLICT', 'Saved Herdr project root changed.');
        return binding;
      }
      async function runtime(projectId: string) {
        const p = await paths(projectId);
        const cached = owned.get(projectId);
        if (cached) {
          if (cached.binding.root !== p.root) throw new ApplicationError('CONFLICT', 'Project root changed while Herdr was running.');
          if (await identity(cached.binding.namespacePid) === cached.binding.namespaceIdentity) return cached;
          owned.delete(projectId);
        }
        const binding = await savedBinding(p); if (!binding) return null;
        if (await identity(binding.namespacePid) !== binding.namespaceIdentity) return null;
        // Reconstruct deterministic paths without rewriting files belonging to a live server.
        const launch = await makeCapsule(p.directory, p.root, false);
        const value = { launch, binding, file: p.file }; owned.set(projectId, value); return value;
      }
      async function makeCapsule(directory: string, root: string, fresh: boolean) {
        // capsule preparation is serialized; live recovery verifies the same pinned bytes.
        if (!fresh) {
          const hash = createHash('sha256').update(await readFile(join(directory, 'herdr'))).digest('hex');
          const original = createHash('sha256').update(await readFile(binary)).digest('hex');
          if (hash !== original) throw new ApplicationError('CONFLICT', 'Saved Herdr distribution changed.');
        }
        return capsule(directory, root, binary, bwrap, fresh);
      }
      async function remote(projectId: string) {
        const r = await runtime(projectId);
        if (!r) throw new ApplicationError('NOT_READY', 'Start this project’s Herdr runtime first.');
        const info = await lstat(r.launch.socket);
        if (!info.isSocket() || info.uid !== process.getuid?.()) throw new ApplicationError('PATH_DENIED', 'Herdr socket ownership changed.');
        const data = Remote.parse((await request(r.launch.socket, 'session.snapshot')).snapshot);
        return { r, data };
      }
      async function detach(projectId: string) {
        const attachment = attachments.get(projectId);
        if (attachment) { await terminals.close(attachment.id); attachments.delete(projectId); }
      }
      async function clearStopped(projectId: string) {
        const p = await paths(projectId), binding = await savedBinding(p);
        if (!binding) return; // Unknown endpoints are never adopted or deleted.
        if (await identity(binding.namespacePid) === binding.namespaceIdentity) throw new ApplicationError('CONFLICT', 'Herdr runtime is still running.');
        const directory = socketDirectory(p.directory);
        try { await privateDirectory(directory, false); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        for (const name of ['herdr.sock', 'herdr-client.sock']) {
          const path = join(directory, name);
          const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
          if (!info) continue;
          if (!info.isSocket() || info.uid !== process.getuid?.()) throw new ApplicationError('PATH_DENIED', 'Herdr endpoint ownership changed.');
          // A live foreign listener is not stale, even when the saved PID has exited.
          await new Promise<void>((done, fail) => {
            const socket = createConnection(path);
            const finish = (error?: Error) => { socket.destroy(); error ? fail(error) : done(); };
            socket.setTimeout(1000, () => finish(new Error('Herdr endpoint liveness is uncertain.')));
            socket.once('connect', () => finish(new ApplicationError('CONFLICT', 'Herdr endpoint has a live unverified owner.')));
            socket.once('error', error => finish(['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '') ? undefined : error));
          });
          const current = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
          if (!current) continue;
          if (current.ino !== info.ino || current.dev !== info.dev) throw new ApplicationError('CONFLICT', 'Herdr endpoint changed during cleanup.');
          await unlink(path);
        }
        await unlink(p.file); owned.delete(projectId);
      }
      async function stop(projectId: string) {
        await detach(projectId);
        const r = await runtime(projectId); if (!r) { await clearStopped(projectId); return; }
        // Kill the dedicated namespace owner, never an arbitrary inherited PID.
        const signal = async (value: NodeJS.Signals) => {
          for (const [pid, token, target] of [[r.binding.namespacePid, r.binding.namespaceIdentity, r.binding.namespacePid], [r.binding.pid, r.binding.identity, -r.binding.pid]] as const) {
            if (await identity(pid) === token) {
              try { process.kill(target, value); }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
            }
          }
        };
        await signal('SIGTERM');
        for (let attempt = 0; attempt < 30 && await identity(r.binding.namespacePid) === r.binding.namespaceIdentity; attempt++) await delay(50);
        await signal('SIGKILL');
        for (let attempt = 0; attempt < 30 && await identity(r.binding.namespacePid) === r.binding.namespaceIdentity; attempt++) await delay(50);
        if (await identity(r.binding.namespacePid) === r.binding.namespaceIdentity) throw new Error('Herdr runtime exit was not observed.');
        await clearStopped(projectId);
      }
      async function start(projectId: string) {
        if (await runtime(projectId)) { await remote(projectId); return; }
        const reason = await available(); if (reason) throw new ApplicationError('HERDR_UNAVAILABLE', reason);
        const p = await paths(projectId);
        await privateDirectory(resolve(options.stateDirectory));
        await clearStopped(projectId);
        const launch = await makeCapsule(p.directory, p.root, true);
        // Refuse any existing endpoint instead of adopting a process without a binding.
        for (const path of [launch.socket, join(socketDirectory(p.directory), 'herdr-client.sock')]) {
          if (await lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }))
            throw new ApplicationError('CONFLICT', 'Herdr socket already exists without a verified live owner.');
        }
        const args = [...launch.args]; args.splice(args.indexOf('--'), 0, '--info-fd', '3');
        const child = spawn(launch.executable, [...args, 'server'], { cwd: launch.cwd, env: launch.env, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
        let diagnostics = '', launchError: Error | undefined, namespace: { pid: number; token: string } | undefined;
        child.stderr!.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096); });
        child.once('error', error => { launchError = error; });
        try {
          const namespacePid = await new Promise<number>((done, fail) => {
            const info = child.stdio[3] as import('node:net').Socket;
            let data = '', settled = false;
            const finish = (error?: Error, pid?: number) => { if (settled) return; settled = true; clearTimeout(timer); info.destroy(); error ? fail(error) : done(pid!); };
            const timer = setTimeout(() => finish(new Error('Herdr namespace identity timed out.')), 5000);
            info.on('error', error => finish(error));
            info.on('close', () => finish(new Error('Herdr namespace identity was not provided.')));
            info.on('data', chunk => {
              data += chunk; if (data.length > 4096) return finish(new Error('Invalid Herdr namespace metadata.'));
              let value; try { value = JSON.parse(data); } catch { return; }
              const pid = value['child-pid'];
              if (!Number.isSafeInteger(pid) || pid < 1) return finish(new Error('Invalid Herdr namespace PID.'));
              finish(undefined, pid);
            });
          });
          const token = child.pid && await identity(child.pid);
          const namespaceIdentity = await identity(namespacePid);
          if (namespaceIdentity) namespace = { pid: namespacePid, token: namespaceIdentity };
          if (!token || !namespaceIdentity) throw new Error('Herdr process identity is unavailable.');
          const binding: z.infer<typeof Binding> = { root: p.root, pid: child.pid!, identity: token, namespacePid, namespaceIdentity, revision: POLICY_REVISION };
          await writeFile(p.file + '.tmp', JSON.stringify(binding), { mode: 0o600 }); await rename(p.file + '.tmp', p.file);
          owned.set(projectId, { launch, binding, file: p.file });
          for (let attempt = 0; attempt < 100; attempt++) {
            if (launchError) throw launchError;
            if (child.exitCode !== null || child.signalCode !== null) throw new Error(diagnostics || 'Herdr exited during startup.');
            try {
              const pong = await request(launch.socket, 'ping');
              if (pong.version !== HERDR_VERSION || pong.protocol !== HERDR_PROTOCOL) throw new Error('Herdr server version mismatch.');
              child.unref();
              (child.stderr as import('node:net').Socket).unref();
              return;
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error; }
            await delay(50);
          }
          throw new Error('Herdr did not become ready within five seconds.');
        } catch (error) {
          if (owned.has(projectId)) { await stop(projectId); throw error; }
          if (namespace && await identity(namespace.pid) === namespace.token) {
            try { process.kill(namespace.pid, 'SIGKILL'); } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure; }
          }
          if (child.pid && child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* child has exited */ } }
          for (let attempt = 0; attempt < 30 && child.pid && await identity(child.pid); attempt++) await delay(50);
          await clearStopped(projectId);
          throw error;
        }
      }
      async function snapshot(projectId: string): Promise<HerdrSnapshot> {
        active(); await paths(projectId);
        const value: HerdrSnapshot = { projectId, state: 'stopped', message: 'Private project runtime. Network access is disabled.', version: HERDR_VERSION, protocol: HERDR_PROTOCOL,
          policy: { mode: 'contained-project', network: 'offline', revision: POLICY_REVISION, projectPath: '/workspace' }, workspaces: [], panes: [], attachment: null };
        const saved = attachments.get(projectId);
        if (saved) { const current = terminals.inspect(saved.id); if (current.status === 'running') value.attachment = current; else attachments.delete(projectId); }
        try {
          if (await runtime(projectId)) {
            const { data } = await remote(projectId); value.state = 'running';
            value.workspaces = data.workspaces.map(w => ({ id: w.workspace_id, label: w.label, focused: w.focused }));
            value.panes = data.panes.map(p => ({ id: p.pane_id, workspaceId: p.workspace_id, tabId: p.tab_id, label: p.label || p.title || p.pane_id, focused: p.focused,
              zoomed: data.layouts.some(layout => layout.tab_id === p.tab_id && layout.zoomed), agent: p.agent ?? null, agentStatus: p.agent_status }));
          } else {
            const reason = await available(); if (reason) { value.state = 'unavailable'; value.message = reason; }
          }
        } catch (error) { value.state = 'error'; value.message = (error as Error).message; }
        return value;
      }
      scope.provide('herdr', {
        subscribe(projectId, changed) {
          active(); const id = ProjectIdSchema.parse(projectId);
          let closed = false, connection: (() => void) | undefined, retry: ReturnType<typeof setTimeout> | undefined, notice: ReturnType<typeof setTimeout> | undefined;
          const notify = () => { if (!closed && !notice) { notice = setTimeout(() => { notice = undefined; if (!closed) changed(); }, 50); notice.unref(); } };
          const reconnect = (ms: number) => {
            connection?.(); connection = undefined; clearTimeout(retry); notify();
            if (!closed) { retry = setTimeout(() => void connect(), ms); retry.unref(); }
          };
          const connect = async () => {
            try {
              const { r, data } = await remote(id); if (closed) return;
              connection = subscribe(r.launch.socket, data.panes.map(p => p.pane_id), event => {
                notify(); if (['pane_created', 'pane_closed'].includes(event)) reconnect(100);
              }, () => reconnect(2000));
            } catch { reconnect(2000); }
          };
          const stop = () => { if (closed) return; closed = true; connection?.(); clearTimeout(retry); clearTimeout(notice); watchers.delete(stop); };
          watchers.add(stop); void connect(); return stop;
        },
        snapshot(projectId) {
          const id = ProjectIdSchema.parse(projectId);
          return (queues.get(id) ?? Promise.resolve()).then(() => snapshot(id));
        },
        command(projectId, input) {
          active(); const id = ProjectIdSchema.parse(projectId), command = HerdrCommandSchema.parse(input);
          const work = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
            active(); const release = scope.lease();
            try {
              writer ??= acquireWriter().catch(error => { writer = undefined; throw error; });
              await writer; hasWriter = true;
              await paths(id);
              if (command.type === 'start') await start(id);
              else if (command.type === 'stop') await stop(id);
              else if (command.type === 'detach') await detach(id);
              else {
                const { r, data } = await remote(id);
                if ('paneId' in command && !data.panes.some(p => p.pane_id === command.paneId)) throw new ApplicationError('PATH_DENIED', 'Pane is not part of this project runtime.');
                switch (command.type) {
                  case 'attach': {
                    if (!terminals.attachManaged) throw new ApplicationError('SERVICE_UNAVAILABLE', 'Managed terminal attachment is unavailable.');
                    const attachment = await terminals.attachManaged({ projectId: id, nodeId: 'herdr:' + id, ...r.launch, args: r.launch.clientArgs, cols: 100, rows: 30 });
                    attachments.set(id, attachment); break;
                  }
                  case 'create': await request(r.launch.socket, 'workspace.create', { label: command.label, cwd: '/workspace', focus: true }); break;
                  case 'select':
                    if (!data.workspaces.some(w => w.workspace_id === command.workspaceId)) throw new ApplicationError('PATH_DENIED', 'Workspace is outside this runtime.');
                    await request(r.launch.socket, 'workspace.focus', { workspace_id: command.workspaceId }); break;
                  case 'split': await request(r.launch.socket, 'pane.split', { target_pane_id: command.paneId, direction: command.direction, cwd: '/workspace', focus: true }); break;
                  case 'focus': await request(r.launch.socket, 'pane.focus', { pane_id: command.paneId }); break;
                  case 'zoom': await request(r.launch.socket, 'pane.zoom', { pane_id: command.paneId, mode: command.mode }); break;
                  case 'resize': await request(r.launch.socket, 'pane.resize', { pane_id: command.paneId, direction: command.direction, amount: command.amount }); break;
                  case 'rename': await request(r.launch.socket, 'pane.rename', { pane_id: command.paneId, label: command.label }); break;
                  case 'close': await request(r.launch.socket, 'pane.close', { pane_id: command.paneId }); break;
                  case 'input': await request(r.launch.socket, 'pane.send_input', { pane_id: command.paneId, text: command.text }); break;
                  case 'key': await request(r.launch.socket, 'pane.send_input', { pane_id: command.paneId, keys: [command.key] }); break;
                }
              }
              return await snapshot(id);
            } finally { release(); }
          });
          const settled = work.then(() => {}, () => {}); queues.set(id, settled);
          void settled.then(() => { if (queues.get(id) === settled) queues.delete(id); });
          return work;
        },
      });
      scope.onDispose(async () => {
        alive = false; for (const stop of watchers) stop(); await Promise.allSettled(queues.values());
        const results = await Promise.allSettled([...new Set([...owned.keys(), ...attachments.keys()])].map(async id => {
          if (options.preserveOnDispose || !hasWriter) await detach(id); else await stop(id);
        }));
        const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (writer) await (await writer)();
        if (errors.length) throw new AggregateError(errors.map(r => r.reason), 'Herdr cleanup failed');
      });
    },
  };
}
