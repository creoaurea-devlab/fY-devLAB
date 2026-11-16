import { createElement, lazy, Suspense } from 'react';
import type { UIPlugin, UIPluginProps } from '@devlab/ui-contracts';
export { createProjectWorkspace } from './workspace.ts';
const View = lazy(() =>
  import('./view.tsx').then((module) => ({ default: module.ProjectsView })),
);
function Contribution(props: UIPluginProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement(
        'div',
        { className: 'projects-loading' },
        'Loading project…',
      ),
    },
    createElement(View, props),
  );
}
export const projectsPanel: UIPlugin = {
  id: 'ui-projects',
  apiVersion: 1,
  title: 'Projects and build canvas',
  slot: 'project',
  Component: Contribution,
};
