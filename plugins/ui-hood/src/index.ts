import { createElement, lazy, Suspense } from 'react';
import type { UIPlugin, UIPluginProps } from '@devlab/ui-contracts';
const View = lazy(() =>
  import('./view.tsx').then((module) => ({ default: module.HoodView })),
);
function Contribution(props: UIPluginProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement(
        'div',
        { className: 'hood-loading-overlay', role: 'status' },
        'Opening Pop the Hood…',
      ),
    },
    createElement(View, props),
  );
}
export const hoodPanel: UIPlugin = {
  id: 'ui-hood',
  apiVersion: 1,
  title: 'Pop the Hood',
  slot: 'hood',
  Component: Contribution,
};
