import { useCallback, useEffect, useRef, useState } from 'react';
import type { RulesService, RulesSnapshot } from '@devlab/contracts';

/** Manual read-only observation shared by the board and compact controls. */
export function useRulesSnapshot(api: RulesService | undefined, projectId: string) {
  const request = useRef(0);
  const scope = useRef({ api, projectId });
  const [response, setResponse] = useState<{ api: RulesService; snapshot: RulesSnapshot } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError('');
    try {
      if (!api) throw new Error('Rules capability is unavailable.');
      const snapshot = await api.snapshot(projectId);
      if (version !== request.current) return;
      if (snapshot.projectId !== projectId) throw new Error('Rules response belongs to a different project. Refresh to try again.');
      setResponse({ api, snapshot });
    } catch (cause) {
      if (version === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    // Compatible refresh replays effects. Reset only when actual scope changes.
    if (scope.current.api !== api || scope.current.projectId !== projectId) {
      scope.current = { api, projectId };
      setResponse(null);
    }
    void refresh();
    return () => { request.current++; };
  }, [api, projectId, refresh]);

  const snapshot = response && response.api === api && response.snapshot.projectId === projectId ? response.snapshot : null;
  return { snapshot, loading, error, refresh };
}
