import { useEffect, useState } from 'react';
import type { ApplicationClient } from '@devlab/ui-contracts';
import type { ProjectServerState } from '@devlab/contracts';
export function ServerSessions({ client }: { client: ApplicationClient }) {
  const [servers, setServers] = useState<ProjectServerState[]>([]),
    [labels, setLabels] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [next, projects] = await Promise.all([
          client.servers?.list(),
          client.projects?.list(),
        ]);
        if (!closed) {
          setServers(next ?? []);
          setLabels(
            Object.fromEntries((projects ?? []).map((p) => [p.id, p.label])),
          );
          setError('');
        }
      } catch (e) {
        if (!closed) setError(String(e));
      } finally {
        if (!closed) timer = setTimeout(() => void refresh(), 1000);
      }
    }
    void refresh();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [client]);
  async function action(id: string, stop = false) {
    setBusy(id);
    setError('');
    try {
      if (stop) await client.servers?.stop(id);
      else await client.servers?.start(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="server-sessions" aria-label="Project servers">
      <p>
        Project servers stay running while you switch views. Start runs the
        project’s configured commands.
      </p>
      {error && <p role="alert">{error}</p>}
      {!client.servers && <p>Server capability is unavailable.</p>}
      {servers.map((server) => (
        <article key={server.projectId} data-server-state={server.status}>
          <div>
            <strong>{labels[server.projectId] ?? server.projectId}</strong>
            <span>{server.status}</span>
            {server.url && (
              <a href={server.url} target="_blank" rel="noreferrer">
                {server.url}
              </a>
            )}
            <button
              disabled={
                busy === server.projectId ||
                [
                  'unconfigured',
                  'invalid',
                  'ready',
                  'starting',
                  'installing',
                ].includes(server.status)
              }
              onClick={() => void action(server.projectId)}
            >
              Start
            </button>
            <button
              disabled={
                !['ready', 'starting', 'installing', 'failed'].includes(
                  server.status,
                )
              }
              onClick={() => void action(server.projectId, true)}
            >
              Stop
            </button>
            {server.status === 'ready' && (
              <button
                onClick={() =>
                  void (async () => {
                    await action(server.projectId, true);
                    await action(server.projectId);
                  })()
                }
              >
                Restart
              </button>
            )}
          </div>
          {server.error && <p role="alert">{server.error}</p>}
          {server.status === 'unconfigured' && (
            <small>Prepare this project to configure its preview.</small>
          )}
          {!!server.logs.length && (
            <details>
              <summary>Server logs</summary>
              <pre>{server.logs.join('')}</pre>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
