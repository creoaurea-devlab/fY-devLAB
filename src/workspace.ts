import { createPreviewWorkspace } from '@devlab/ui-preview';
import { UIRegistry } from '@devlab/ui-host';
import { createCanvasWorkspace } from '@devlab/ui-canvas';
import { createProjectWorkspace } from '@devlab/ui-projects';
import type { ApplicationClient, CanvasWorkspace } from '@devlab/ui-contracts';
import { catalog } from './contributions.ts';

/** Browser domain owners outlive view mounts and accepted contribution updates. */
export function createRuntime(
  client: ApplicationClient,
  options: {
    kernel?: boolean;
    projectId?: string;
    initialMode?: 'flow' | 'build';
    initialOutput?: 'terminal' | 'servers' | 'herdr';
  } = {},
) {
  const registry = new UIRegistry();
  const unregister = catalog.map(plugin => registry.register(plugin));
  const owners = new Map<string, CanvasWorkspace>();
  const getCanvas = (id: string) => {
    let owner = owners.get(id);
    if (!owner) {
      owner = createCanvasWorkspace(client.canvas!, id);
      owners.set(id, owner);
      void owner.reload();
    }
    return owner;
  };
  const workspace = options.kernel ? undefined : getCanvas('default');
  const projectWorkspace = options.kernel
    ? undefined
    : createProjectWorkspace(client, getCanvas, { initialProjectId: options.projectId,
      initialMode: options.initialMode, initialOutput: options.initialOutput });
  const previewWorkspace = projectWorkspace
    ? createPreviewWorkspace({
        projectId: options.projectId ?? 'default',
      })
    : undefined;
  let previewProjects: unknown,
    previewProjectId = '',
    previewLocation = '';
  const syncPreview = () => {
    const state = projectWorkspace?.snapshot();
    if (!state) return;
    const location = state.projects.find((p) => p.base)?.workspaceId ?? '';
    if (
      state.projects === previewProjects &&
      state.projectId === previewProjectId &&
      location === previewLocation
    )
      return;
    previewWorkspace?.syncProjects(state.projects, state.projectId, location);
    previewProjects = state.projects;
    previewProjectId = state.projectId;
    previewLocation = location;
  };
  const unsubscribe = projectWorkspace?.subscribe(syncPreview);
  syncPreview();
  const ready = projectWorkspace?.start() ?? Promise.resolve();
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      projectWorkspace?.dispose();
      previewWorkspace?.dispose();
      for (const owner of owners.values()) owner.dispose();
      unregister.reverse().forEach(remove => remove());
    },
    client,
    registry,
    owners,
    workspace,
    projectWorkspace,
    previewWorkspace,
    ready,
  };
}
