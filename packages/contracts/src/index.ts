export * from './deepseek.ts';
import type { RuntimeControl, WorkspaceSearch } from './runtime.ts';
export * from './runtime.ts';
import type { RulesService } from './rules.ts';
import type { HerdrService } from './herdr.ts';
export * from './herdr.ts';
export * from './rules.ts';
import type { PreviewInspector } from './preview.ts';
import type { ProjectServers } from './servers.ts';
export * from './servers.ts';
export * from './preview.ts';
import type { BrowserHost, BrowserControl } from './browser.ts';
export * from './browser.ts';
import type { ProjectCatalog } from './projects.ts';
export * from './projects.ts';
import type { RegistryMap } from './architecture.ts';
export * from './architecture.ts';
import type { CanvasStore } from './workspace.ts';
import type { TerminalService, WorkspaceRoots } from './terminal.ts';
export * from './workspace.ts';
export * from './terminal.ts';

export interface HttpEndpoint {
  url: string;
}
export interface ServiceMap {
  runtimeControl: RuntimeControl;
  workspaceSearch: WorkspaceSearch;
  herdr: HerdrService;
  rules: RulesService;
  servers: ProjectServers;
  previewInspector: PreviewInspector;
  browsers: BrowserHost;
  browserControl: BrowserControl;
  projects: ProjectCatalog;
  architecture: RegistryMap;
  workspace: WorkspaceRoots;
  terminals: TerminalService;
  canvas: CanvasStore;
  http: HttpEndpoint;
}
export type ServiceKey = keyof ServiceMap;
export interface PluginManifest {
  id: string;
  version: string;
  apiVersion: 1;
  provides: readonly ServiceKey[];
  requires: readonly ServiceKey[];
  live?: readonly ServiceKey[];
  capabilities: readonly string[];
  reload: 'idle' | 'restart';
}
export interface PluginScope {
  get<K extends ServiceKey>(key: K): ServiceMap[K];
  ref<K extends ServiceKey>(key: K): () => ServiceMap[K];
  provide<K extends ServiceKey>(key: K, service: ServiceMap[K]): void;
  onDispose(cleanup: () => void | Promise<void>): void;
  lease(): () => void;
}
export interface PluginDefinition {
  manifest: PluginManifest;
  activate(scope: PluginScope): void | Promise<void>;
}
export interface PluginHealth {
  id: string;
  version: string;
  state: 'active' | 'failed' | 'disposed';
  generation: number;
  leases: number;
}
export class ApplicationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
  }
}
/** Stable, deterministic JSON for normalized contract values (no secrets or binary data). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
      .join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined)
    throw new ApplicationError('INVALID_JSON', 'Unsupported JSON value');
  return result;
}

export * from './ownership.ts';
export * from './preimp.ts';
