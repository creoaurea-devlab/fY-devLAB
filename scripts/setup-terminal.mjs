import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This terminal runtime currently supports Linux x64.');
const probePty = () => execFileSync(process.execPath, ['-e', "require('node-pty')"], { cwd: root, stdio: 'pipe', timeout: 10000 });
try { probePty(); }
catch {
  // npm ci --ignore-scripts deliberately leaves native lifecycle work undone.
  // Rebuild only the explicitly pinned/allowed PTY dependency, then actually load it.
  console.log('Building the pinned node-pty native dependency…');
  execFileSync('npm', ['rebuild', 'node-pty', '--ignore-scripts=false', '--foreground-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', timeout: 180000 });
  probePty();
}
const tools = join(root, '.tools/tmux');
const catalog = JSON.parse(await readFile(join(root, 'vendor/runtime/catalog.json'), 'utf8'));
await mkdir(tools, { recursive: true });
for (const entry of Object.values(catalog)) {
  const archive = join(root, 'vendor/runtime', entry.archive);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (digest !== entry.sha256) throw new Error('Terminal runtime archive drift: ' + entry.archive);
  const marker = join(tools, '.' + digest);
  if (!await stat(marker).catch(() => null)) {
    execFileSync('dpkg-deb', ['-x', archive, tools]);
    await writeFile(marker, entry.archive + '\n');
  }
}
const wrapper = join(tools, 'bin/tmux');
await mkdir(dirname(wrapper), { recursive: true });
await writeFile(wrapper, '#!/bin/sh\nbase=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport LD_LIBRARY_PATH="$base/usr/lib/x86_64-linux-gnu"\nexec "$base/usr/bin/tmux" "$@"\n');
await chmod(wrapper, 0o755);
const source = join(root, 'plugins/terminal-pty/native/ownership-sandbox.c');
const binary = join(root, 'plugins/terminal-pty/native/ownership-sandbox');
const fingerprint = createHash('sha256').update(await readFile(source)).digest('hex');
if ((await readFile(binary + '.sha256', 'utf8').catch(() => '')) !== fingerprint || !await stat(binary).catch(() => null)) {
  execFileSync('gcc', ['-O2', '-Wall', '-Wextra', '-Werror', source, '-o', binary]);
  await writeFile(binary + '.sha256', fingerprint);
}
console.log(execFileSync(wrapper, ['-V'], { encoding: 'utf8' }).trim());
console.log(execFileSync(binary, ['--check'], { encoding: 'utf8' }).trim());
