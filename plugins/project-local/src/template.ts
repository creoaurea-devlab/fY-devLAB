import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Framework-neutral feature factory; the application adapts its host lifecycle. */
export function moduleFiles(id: string): Record<string, string> {
  return {
    'contracts.ts':
      'export interface ModuleContract { execute(input: string): Promise<string>; }\n',
    'adapter.ts':
      "import type { ModuleContract } from './contracts.js';\nexport function createAdapter(): ModuleContract { return { execute: async input => input }; }\n",
    'plugin.ts': `import type { ModuleContract } from './contracts.js';\nimport { createAdapter } from './adapter.js';\nexport interface ModuleHost { provide<T>(key: string, value: T): () => void; onDispose(cleanup: () => void): void; }\nexport function modulePlugin(adapter: ModuleContract = createAdapter()) { return { id: ${JSON.stringify(id)}, provides: [${JSON.stringify(id)}], activate(host: ModuleHost) { host.onDispose(host.provide(${JSON.stringify(id)}, adapter)); } }; }\n`,
  };
}

/** New web projects are runnable and contain explicit semantic UI identities. */
export function webProjectFiles(
  id: string,
  label: string,
  port: number,
): Record<string, string> {
  const safe = label.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
  return {
    'hood.project.json': JSON.stringify({ label }, null, 2) + '\n',
    'README.md': `# ${label}\n\nOpen this project in devLAB. Dependencies and the dev server are owned by the Servers module.\nRun pnpm install and pnpm run dev for standalone use.\nAgents start with AGENTS.md and .agents/DEVLAB.md before changes.\n`,
    ...agentProjectFiles(),
    'package.json':
      JSON.stringify(
        {
          name: id,
          private: true,
          type: 'module',
          scripts: { dev: 'vite' },
          devDependencies: {
            vite: '6.4.3',
            typescript: '5.9.3',
            postcss: '8.5.30',
            parse5: '8.0.1',
          },
        },
        null,
        2,
      ) + '\n',
    'tsconfig.json':
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2023',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            lib: ['ES2023', 'DOM'],
            strict: true,
            noEmit: true,
            types: ['vite/client'],
          },
          include: ['src'],
        },
        null,
        2,
      ) + '\n',
    'pnpm-workspace.yaml': 'allowBuilds:\n  esbuild: true\n',
    'devlab.preview.json':
      JSON.stringify(
        {
          schemaVersion: 1,
          adapter: 'vite',
          packageManager: 'pnpm',
          install: ['pnpm', 'install'],
          start: [
            'pnpm',
            'run',
            'dev',
            '--host',
            '127.0.0.1',
            '--port',
            '{port}',
            '--strictPort',
          ],
          port,
          autoStart: true,
          tokens: ['src/tokens.css'],
          inspection: 'bridge',
        },
        null,
        2,
      ) + '\n',
    'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${safe}</title></head><body data-devlab-id="app.body" data-devlab-source="index.html"><main id="app" data-devlab-id="app.root" data-devlab-source="index.html"><h1 data-devlab-id="app.title" data-devlab-source="index.html">${safe}</h1><p data-devlab-id="app.intro" data-devlab-source="index.html">Your project is ready to build.</p><button data-devlab-id="app.action" data-devlab-source="src/main.ts">Try the preview</button><output data-devlab-id="app.output" data-devlab-source="src/main.ts" aria-live="polite"></output></main><script type="module" src="/src/main.ts"></script><script src="/devlab-bridge.js"></script></body></html>\n`,
    'src/index.ts':
      'export const projectName = ' + JSON.stringify(label) + ';\n',
    'src/main.ts': `import './tokens.css';\nlet clicks=import.meta.hot?.data.clicks ?? 0;\nconst button=document.querySelector('button')!, output=document.querySelector('output')!;\nconst click=()=>{output.textContent='Preview works · '+ ++clicks;};button.addEventListener('click',click);\nif(import.meta.hot){\n const hot=import.meta.hot, update=()=>window.dispatchEvent(new Event('devlab:hmr'));\n const connected=()=>window.dispatchEvent(new CustomEvent('devlab:hmr-state',{detail:{connected:true}}));\n const disconnected=()=>window.dispatchEvent(new CustomEvent('devlab:hmr-state',{detail:{connected:false}}));\n import.meta.hot.accept();hot.on('vite:beforeUpdate',update);hot.on('vite:beforeFullReload',update);hot.on('vite:ws:connect',connected);hot.on('vite:ws:disconnect',disconnected);\n hot.dispose(data=>{data.clicks=clicks;button.removeEventListener('click',click);hot.off('vite:beforeUpdate',update);hot.off('vite:beforeFullReload',update);hot.off('vite:ws:connect',connected);hot.off('vite:ws:disconnect',disconnected);});\n}\n`,
    'src/tokens.css': `:root{--surface:#f4f2ea;--text:#163c38;--action:#11685e;--on-action:#fff;--space:1.25rem;--radius:1rem;--type:system-ui,sans-serif;--border:#c7d4cd;--focus:#c1681c;--motion:160ms;--type-heading:2.5rem;--leading-heading:1.1;--space-page:2.5rem;--content-width:40rem;--motion-lift:-2px;--focus-ring:3px solid var(--focus);--stroke:1px solid var(--border)}*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);font-family:var(--type);padding:var(--space-page)}main{max-width:var(--content-width);margin:auto}h1{font-size:var(--type-heading);line-height:var(--leading-heading)}button{font:inherit;padding:var(--space);background:var(--action);color:var(--on-action);border:var(--stroke);border-radius:var(--radius);cursor:pointer;transition:transform var(--motion)}button:hover{transform:translateY(var(--motion-lift))}button:focus-visible{outline:var(--focus-ring)}output{display:block;margin-top:var(--space)}\n`,
  };
}

/** Project-local context, shared by creation and explicit Open Folder admission. */
export function agentProjectFiles(): Record<string, string> {
  return {
    'AGENTS.md': '# Project agent entry\n\nRead .agents/DEVLAB.md before changes and after restoring context. It introduces the workspace and project bootstrap rules. Follow existing project-specific instructions too.\n',
    '.agents/DEVLAB.md': `# DevLab project bootstrap

This folder is an independent project opened in DevLab, a local workspace with a project catalog, source editor, canvas, terminals and previews. The DevLab application and this project's source have separate owners. Work in this project folder; do not edit the DevLab host or another project unless explicitly requested.

## Start here

Confirm the terminal working directory with pwd. A new terminal defaults to this project's root; an explicitly selected subfolder stays within this project. Read the root AGENTS.md, README.md, package.json (if present), other project rules and affected source. Determine the project's purpose and actual commands from these files; do not assume a language, framework or installed agent runtime.

## Rules

Before editing, state the requested outcome, exact write scope, drafts/processes to preserve and verification. Preserve unrelated work, terminal shells and preview owners. DevLab Servers manages configured development servers; inspect existing status before starting another server. Prefer existing public interfaces and keep browser code separate from filesystem and subprocess code.

Review scripts before running them. This file is an instruction handoff, not an executable shell hook or a tool permission. Historical plans and imported rules do not authorize execution. Do not initialize Git or deploy without an explicit request.

Run checks appropriate to the change and report actual results and limitations. Keep project-specific setup and decisions in this project's own documentation; never copy another project's context as fact.
`,
  };
}

/** Add missing context only; existing project rules and symlinks are never replaced. */
export async function ensureAgentProjectFiles(root: string): Promise<void> {
  if (await realpath(root) !== root) throw new Error('Project root must be canonical');
  const folder = join(root, '.agents');
  await mkdir(folder).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if (!(await lstat(folder)).isDirectory() || await realpath(folder) !== folder)
    throw new Error('Project agent context must be a real directory');
  // Bootstrap first so a newly created entry never points to a missing file.
  for (const path of ['.agents/DEVLAB.md', 'AGENTS.md']) {
    await writeFile(join(root, path), agentProjectFiles()[path]!, { flag: 'wx', mode: 0o600 })
      .catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
}
