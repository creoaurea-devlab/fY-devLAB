import type { UIPlugin } from '@devlab/ui-contracts';
import { WorkspaceShell } from './view.tsx';
import './devlab.css';
export const workspaceShell: UIPlugin = {
  id: 'ui-shell',
  apiVersion: 1,
  title: 'CA devLAB workspace',
  slot: 'workspace',
  Component: WorkspaceShell,
};
