import type { ProjectServers, ProjectServerState } from '@devlab/contracts';

/** Present the manual setup path available in this host. */
export function previewServers(servers: ProjectServers): ProjectServers {
  const present = (state: ProjectServerState): ProjectServerState =>
    state.status === 'unconfigured'
      ? { ...state, error: 'Create devlab.preview.json in the app folder, then choose Server → Start. Automatic project preparation is not connected in this host.' }
      : state;
  return {
    inspect: async projectId => present(await servers.inspect(projectId)),
    list: async () => (await servers.list()).map(present),
    start: async projectId => present(await servers.start(projectId)),
    stop: async projectId => present(await servers.stop(projectId)),
  };
}
