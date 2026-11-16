import { useSyncExternalStore } from 'react';
import type { ProjectWorkspace, ProjectWorkspaceState } from '@devlab/ui-contracts';
export function ProjectEditor({ owner, retainedState }: { owner: ProjectWorkspace; retainedState?: ProjectWorkspaceState }) {
  const current = useSyncExternalStore(owner.subscribe, owner.snapshot);
  const state = retainedState ?? current,
    editor = state.editor;
  if (!editor) return null;
  return (
    <aside
      className="project-editor"
      aria-label="File editor"
      data-testid="project-editor"
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault();
          void owner.saveFile().catch(() => {});
        }
      }}
    >
      <header>
        <div>
          <strong>
            {editor.path.split('/').at(-1)}
            {editor.dirty ? ' · unsaved' : ''}
          </strong>
          <small>{editor.path}</small>
        </div>
        <button
          aria-label="Close file editor"
          onClick={() => owner.closeEditor()}
        >
          ×
        </button>
      </header>
      {editor.loading ? (
        <p>Loading file…</p>
      ) : (
        <textarea
          aria-label="File contents"
          value={editor.text}
          readOnly={editor.readOnly}
          spellCheck={false}
          onChange={(event) => owner.changeText(event.target.value)}
        />
      )}
      {state.error && (
        <p className="project-editor-error" role="alert">
          {state.error}
        </p>
      )}
      <footer>
        <span>
          {editor.readOnly
            ? 'Metadata only'
            : editor.dirty
              ? 'Draft retained in this project'
              : 'Saved on disk'}
        </span>
        {!editor.readOnly && (
          <button
            className="project-primary"
            disabled={!editor.dirty || editor.loading || state.busy}
            onClick={() => void owner.saveFile().catch(() => {})}
          >
            Save file
          </button>
        )}
        <button
          onClick={() => {
            if (
              !editor.dirty ||
              confirm('Discard this file draft and reload from disk?')
            )
              void owner.openFile(editor.path, true);
          }}
        >
          Reload file
        </button>
      </footer>
    </aside>
  );
}
