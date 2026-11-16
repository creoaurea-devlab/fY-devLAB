/** Neutral metadata for a separately owned native DeepSeek Harness process. */
export interface DeepSeekPackage {
  id: string; version: string; source: string; description: string; license: string;
  private: boolean; kind: 'bundle' | 'package'; installed: boolean;
  platform: boolean; dependencies: string[]; sourceHash: string; distribution: 'review' | 'notice';
}
export interface DeepSeekEntry { id: string; module: string; enabled: boolean;
  state: 'active' | 'pending' | 'loading' | 'failed' | 'disposed' | 'unloading' | 'disabled';
  requires: string[]; error?: string; }
export interface DeepSeekSelection { id: string; enabled: boolean; config: unknown; }
export interface DeepSeekProbe { id: string; outcome: 'active' | 'pending' | 'failed' | 'library' | 'unavailable' | 'timeout';
  off: boolean; on: boolean; cleanup: boolean; reason?: string; durationMs: number; }
export interface DeepSeekInventory { name: 'DeepSeek Harness Runtime'; revision: string; packages: DeepSeekPackage[];
  entries: DeepSeekEntry[]; tests: DeepSeekProbe[]; running: boolean; upstreamRevision: string; }
