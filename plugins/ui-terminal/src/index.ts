import { createElement, lazy, Suspense } from 'react';
import type { UIPlugin, UIPluginProps } from '@devlab/ui-contracts';
const View = lazy(() =>
  import('./view.tsx').then((module) => ({ default: module.TerminalView })),
);
function Contribution(props: UIPluginProps) {
  return createElement(
    Suspense,
    { fallback: createElement('div', null, 'Loading terminal…') },
    createElement(View, props),
  );
}
export const terminalPanel: UIPlugin = {
  id: 'ui-terminal',
  apiVersion: 1,
  title: 'Native terminal',
  slot: 'terminal',
  Component: Contribution,
};
