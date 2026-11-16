import { createElement, lazy, Suspense } from 'react';
import type { UIPlugin, UIPluginProps } from '@devlab/ui-contracts';
export { createCanvasWorkspace } from './workspace.ts';
const View = lazy(() =>
  import('./view.tsx').then((module) => ({ default: module.CanvasView })),
);
function CanvasContribution(props: UIPluginProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement(
        'div',
        { className: 'canvas-loading' },
        'Loading canvas…',
      ),
    },
    createElement(View, props),
  );
}
export const canvasPanel: UIPlugin = {
  id: 'ui-canvas',
  apiVersion: 1,
  title: 'Editable canvas',
  slot: 'canvas',
  Component: CanvasContribution,
};
