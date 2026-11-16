import type { ReactNode } from 'react';
import type { PluginHealth } from '@devlab/contracts';
import { X } from 'lucide-react';

export function IconButton({
  title,
  children,
  onClick,
  disabled = false,
  testId,
  active = false,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button${active ? ' active-icon' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** Presentation only; the shell retains dialog selection, diagnostics and keyboard ownership. */
export function SettingsPanel({ health, onClose }: {
  health: PluginHealth[] | null;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className="settings-panel"
        data-testid="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={health ? 'Kernel diagnostics' : 'Keyboard shortcuts'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <span className="settings-key">⚿</span>
          <strong>{health ? 'Kernel diagnostics' : 'Keyboard shortcuts'}</strong>
          <span className="toolbar-spacer" />
          <IconButton title="Close settings" onClick={onClose}><X size={14} /></IconButton>
        </div>
        <div className="settings-body">
          {health ? (
            <>
              {health.map((p) => (
                <div className="provider-row" key={p.id}>
                  <strong>{p.id}</strong>
                  <span>
                    {p.state} · generation {p.generation} · {p.leases}{' '}
                    leases
                  </span>
                </div>
              ))}
              <a href="/?view=kernel">Open Kernel Lab</a>
            </>
          ) : (
            <div className="shortcuts">
              <p>Ctrl / ⌘ S — Save graph</p>
              <p>Ctrl / ⌘ Z — Undo</p>
              <p>Ctrl / ⌘ Shift Z — Redo</p>
              <p>Ctrl / ⌘ L — Layout nodes</p>
              <p>Ctrl / ⌘ ` — Toggle terminal</p>
              <p>Delete — Remove selected nodes</p>
              <p>Escape — Close selection or dialog</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
