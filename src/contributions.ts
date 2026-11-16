import { rulesPanel } from '@devlab/ui-rules';
import type { UIPlugin } from '@devlab/ui-contracts';
import { previewPanel } from '@devlab/ui-preview';
import { browserPanel } from '@devlab/ui-browser';
import { projectsPanel } from '@devlab/ui-projects';
import { hoodPanel } from '@devlab/ui-hood';
import { terminalPanel } from '@devlab/ui-terminal';
import { workspaceShell } from '@devlab/ui-shell';
import { canvasPanel } from '@devlab/ui-canvas';

/** Refreshable composition data; runtime owners live outside this module. */
export const catalog: readonly UIPlugin[] = [
  workspaceShell, previewPanel, projectsPanel, canvasPanel, terminalPanel,
  browserPanel, hoodPanel, rulesPanel,
];
