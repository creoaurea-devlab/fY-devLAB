import type { PluginDefinition } from '@devlab/contracts';
import { readAgentTraffic, readRulesSnapshot } from './snapshot.ts';

export function rulesLocal(): PluginDefinition {
  return {
    manifest: { id: 'rules-local', version: '1.0.0', apiVersion: 1, provides: ['rules'],
      requires: ['projects'], capabilities: ['workspace:local', 'process:local'], reload: 'restart' },
    activate(scope) {
      const projects = scope.get('projects');
      const shutdown = new AbortController();
      scope.onDispose(() => shutdown.abort());
scope.provide('rules', {
  snapshot: async projectId => readRulesSnapshot(await projects.root(projectId), projectId, shutdown.signal),
  activity: async projectId => readAgentTraffic(await projects.root(projectId), projectId, shutdown.signal),
});
    },
  };
}
