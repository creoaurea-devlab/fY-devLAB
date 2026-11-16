import { createElement, lazy, Suspense } from 'react';
import type { UIPlugin, UIPluginProps } from '@devlab/ui-contracts';
const View = lazy(() =>
  import('./view.tsx').then((module) => ({ default: module.PreviewView })),
);
function Contribution(props: UIPluginProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement(
        'div',
        { role: 'status' },
        'Loading project preview…',
      ),
    },
    createElement(View, props),
  );
}
export const previewPanel: UIPlugin = {
  id: 'ui-preview',
  apiVersion: 1,
  title: 'Project UI preview',
  slot: 'preview',
  Component: Contribution,
};

export { createPreviewWorkspace } from './workspace.ts';

export { openPreviewSource } from './server-state.ts';
