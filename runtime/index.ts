import { deepSeekRegistryClient } from './deepseek/registry-router.ts';
import { runtimeControl } from './plugins/control.ts';
import { workspaceSearch } from './plugins/workspace-search.ts';
import factoryPreview from '../devlab.preview.json' with { type: 'json' };
import { rulesLocal } from '@devlab/rules-local';
import { join } from 'node:path';
import type { Kernel } from '@devlab/kernel';
import { PreviewDescriptorSchema, ApplicationError, type PluginDefinition } from '@devlab/contracts';
import { canvasStore } from '@devlab/canvas-store';
import selection from './plugins.json' with { type: 'json' };
import { registryRouter } from './registry-router.ts';
import { httpTransport } from '@devlab/transport-http';
import { localProjects } from '@devlab/project-local';
import { projectServer } from '@devlab/project-server';
import { previewInspector } from '@devlab/preview-inspector';
import { terminalPty } from '@devlab/terminal-pty';
import { herdrRuntime } from '../plugins/herdr-runtime/src/index.ts';

export const grants = ['storage:local', 'network:loopback', 'workspace:local', 'process:local', 'browser:local', 'terminal:local'] as const;

export type PluginSelection = Readonly<Record<string, boolean>>;

// Both the server and artifact builder use these exact factory manifests.
export function profile(kernel: Kernel, root: string, port: number, data = join(root, '.data'), previewPort = PreviewDescriptorSchema.parse(factoryPreview).port, overrides: PluginSelection = {}) {
  if (!Number.isInteger(previewPort) || previewPort < 1024 || previewPort > 65535) throw new Error('Preview port must be from1024to65535');
  const webRoot = process.env.DEVLAB_BUILD_DIR ?? join(root, 'dist');
  const compose = (chosen: PluginSelection): { candidates: PluginDefinition[]; definitions: PluginDefinition[] } => {
  const enabled: PluginSelection = { ...selection, ...chosen };
  let definitions: PluginDefinition[] = [];
  const candidates: PluginDefinition[] = [
    canvasStore(data),
    localProjects({ root, projectsRoot: join(data, 'projects'), registryFile: join(data, 'project-roots.json') }),
    terminalPty({ stateDirectory: join(data, 'terminals'), registryPath: join(root, '.context/modules/registry.yaml'),
      tmuxPath: join(root, '.tools/tmux/bin/tmux'), preserveOnDispose: data === join(root, '.data') }),
    runtimeControl({ file: join(data, 'runtime-plugins.json'), defaults: selection,
      catalog: proposed => (proposed ? compose(proposed).candidates : candidates).map(plugin => plugin.manifest),
      running: () => definitions.map(plugin => plugin.manifest), health: () => kernel.health() }),
    workspaceSearch(),
    rulesLocal(),
    herdrRuntime({ stateDirectory: join(data, 'herdr'), preserveOnDispose: data === join(root, '.data') }),
    projectServer({ cacheDirectory: join(data, 'server-cache') }),
    // The unchanged HTTP preview routes require this adapter; activation launches no browser.
    previewInspector(),
    registryRouter({ artifact: join(webRoot, 'architecture.json'),
      plugins: () => definitions, health: () => kernel.health(),
      ...(process.env.DEVLAB_DEEPSEEK_ORIGIN ? { upstream: deepSeekRegistryClient(process.env.DEVLAB_DEEPSEEK_ORIGIN) } : {}) }),
    httpTransport({ port, allowedOrigins: [`http://127.0.0.1:${previewPort}`], canvas: enabled['canvas-store'] !== false, architecture: enabled['registry-map'] !== false,
      runtime: enabled['runtime-control'] !== false, search: enabled['workspace-search'] !== false,
      herdr: enabled['herdr-runtime'] !== false,
      projects: enabled['project-local'] !== false, servers: enabled['project-server'] !== false,
      terminals: enabled['terminal-pty'] !== false, rules: enabled['rules-local'] !== false, webRoot,
      diagnostics: () => ({ phase: kernel.phase, plugins: kernel.health() }) }),
  ];
  const ids = new Set(candidates.map(plugin => plugin.manifest.id));
  for (const [id, value] of Object.entries(enabled)) {
    if (!ids.has(id) || typeof value !== 'boolean')
      throw new ApplicationError('INVALID_PLUGIN_SELECTION', `Unknown plugin or non-boolean selection: ${id}`);
  }
  definitions = candidates.filter(plugin => enabled[plugin.manifest.id] !== false);
  return { candidates, definitions };
  };
  return compose(overrides).definitions;
}
