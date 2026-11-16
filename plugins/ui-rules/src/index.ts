import { createElement, useRef, useState } from 'react';
import type { UIPlugin, UIPluginProps } from '@devlab/ui-contracts';
import { RulesView } from './view.tsx';
import './rules.css';

function RulesPanel(props: UIPluginProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (props.rulesOptions) return createElement(RulesView, props);
  return createElement('div', null,
    createElement('button', { type: 'button', ref: trigger, onClick: () => setOpen(true), 'aria-haspopup': 'dialog' }, 'Open Rules Board'),
    open && createElement(RulesView, { ...props, rulesOptions: {
      projectId: props.projectWorkspace?.snapshot().projectId ?? 'default',
      onClose: () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); },
    } }),
  );
}

export const rulesPanel: UIPlugin = {
  id: 'ui-rules', apiVersion: 1, title: 'Rules Board', slot: 'panel',
  Component: RulesPanel,
};
