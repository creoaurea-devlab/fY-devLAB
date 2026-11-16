import { ApplicationError, WorkspaceSearchSchema, WorkspaceSearchResultSchema, type PluginDefinition,
  type WorkspaceSearchResult } from '@devlab/contracts';

export function workspaceSearch(): PluginDefinition {
  return { manifest: { id: 'workspace-search', version: '1.0.0', apiVersion: 1, provides: ['workspaceSearch'],
    requires: ['projects', 'runtimeControl'], capabilities: ['workspace:local'], reload: 'restart' }, activate(scope) {
    const projects = scope.get('projects'), diagnostics = scope.get('runtimeControl');
    let alive = true;
    const calls = new Set<AbortController>();
    const pending = new Set<Promise<unknown>>();
    scope.onDispose(async () => { alive = false; for (const call of calls) call.abort(); await Promise.allSettled([...pending]); });
    scope.provide('workspaceSearch', { search(input, signal) {
      if (!alive) return Promise.reject(new ApplicationError('NOT_READY', 'Workspace search is disposed'));
      const command = WorkspaceSearchSchema.parse(input);
      if (calls.size >= 4) return Promise.reject(new ApplicationError('NOT_READY', 'Four searches are already running'));
      const controller = new AbortController(), abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      calls.add(controller);
      const check = () => { if (controller.signal.aborted) throw new ApplicationError('CANCELLED', 'Search cancelled'); };
      const started = performance.now();
      const result: WorkspaceSearchResult = { matches: [], scanned: 0, skipped: 0, truncated: false };
      const operation = (async () => {
        let outcome: 'ok' | 'error' | 'cancelled' = 'ok';
        try {
          check(); const tree = await projects.inspect(command.projectId); check();
          const files = tree.entries.filter(file => file.kind === 'file' && file.editable && !file.path.split('/').some(part =>
            part.startsWith('.') || ['_LAB', '_preimp', '_BACKUP', 'node_modules', 'vendor', 'dist', 'secrets'].includes(part)));
          let bytes = 0;
          for (const file of files) {
            check();
            if (result.scanned >= 500 || bytes + file.bytes > 2 * 1024 * 1024) { result.truncated = true; break; }
            let text: string;
            try { text = (await projects.read(command.projectId, file.path)).text; }
            catch (error) {
              if (['PATH_DENIED', 'NOT_FOUND', 'ENOENT'].includes((error as { code?: string }).code ?? '')) { result.skipped++; continue; }
              throw error;
            }
            check(); bytes += Buffer.byteLength(text); result.scanned++;
            if (bytes > 2 * 1024 * 1024) { result.truncated = true; break; }
            const lines = text.split('\n'), needle = command.query.toLocaleLowerCase();
            for (let index = 0; index < lines.length; index++) {
              if (!lines[index]!.toLocaleLowerCase().includes(needle)) continue;
              result.matches.push({ path: file.path, line: index + 1, text: lines[index]!.slice(0, 240) });
              if (result.matches.length >= command.maxResults) { result.truncated = true; break; }
            }
            if (result.truncated) break;
          }
          check(); return WorkspaceSearchResultSchema.parse(result);
        } catch (error) { outcome = controller.signal.aborted ? 'cancelled' : 'error'; throw error; }
        finally {
          calls.delete(controller); signal?.removeEventListener('abort', abort);
          diagnostics.record({ at: new Date().toISOString(), operation: 'workspace-search', outcome,
            durationMs: performance.now() - started, matches: result.matches.length });
        }
      })();
      pending.add(operation); void operation.finally(() => pending.delete(operation)).catch(() => {});
      return operation;
    } });
  } };
}
