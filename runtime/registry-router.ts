import { federateRegistry } from './deepseek/registry-router.ts';
import type { RegistryClient, RegistryMap, PluginScope, ServiceKey, ServiceMap } from '@devlab/contracts';
import type { PluginDefinition, PluginHealth } from '@devlab/contracts';
import { registryMap } from '@devlab/registry-map';

/** Forward the selected runtime inventory to the existing main architecture registry.
 * Cordis owns service instances and health; the artifact owns source/ownership data.
 * Keeping callbacks avoids a second cached registry or lifecycle authority.
 */
export function registryRouter(options: {
  artifact: string;
  plugins: () => readonly PluginDefinition[];
  health: () => PluginHealth[];
  upstream?: RegistryClient;
}): PluginDefinition {
  const definition = registryMap({
    artifact: options.artifact,
    manifests: () => options.plugins().map(plugin => plugin.manifest),
    health: options.health,
  });
  if (!options.upstream) return definition;
  return { ...definition, activate(scope) {
    const proxy: PluginScope = { ...scope, provide<K extends ServiceKey>(key: K, service: ServiceMap[K]) {
      if (key === 'architecture') scope.provide('architecture', federateRegistry(service as RegistryMap, options.upstream!));
      else scope.provide(key, service);
    } };
    return definition.activate(proxy);
  } };
}
