import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const privateDirectories = ['_LAB', '_preimp', '.git', '.data', '.agents', '.wisdohm', '.context', '.recovery', '_BACKUP', 'secrets'];
const privateSegment = (segment: string) => privateDirectories.some(folder => folder.toLowerCase() === segment.toLowerCase()) ||
  /^\.env(?:\.|$)/i.test(segment) || /\.(?:crt|pem)$/i.test(segment);

// The bridge reports observed framework events; it never edits project source.
const refreshObservation = `
if (import.meta.hot) {
  const notify = connected => window.dispatchEvent(new CustomEvent('devlab:hmr-state', {detail:{connected}}));
  import.meta.hot.on('vite:beforeUpdate', () => { notify(true); window.dispatchEvent(new Event('devlab:hmr')); });
  import.meta.hot.on('vite:ws:connect', () => notify(true));
  import.meta.hot.on('vite:ws:disconnect', () => notify(false));
}
`;
export default defineConfig({
  plugins: [react(), {
    name: 'devlab-private-paths',
    config(config) {
      // Vite matches deny globs against absolute paths; a fork can itself live under .data/projects.
      const root = normalizePath(resolve(config.root ?? process.cwd())).replace(/[\\{}()[\]*?!]/g, '\\$&');
      return { server: { fs: { deny: privateDirectories.map(folder => `${root}/**/${folder}/**`) } } };
    },
    async configureServer(server) {
      const roots = [server.config.root, await realpath(server.config.root)];
      const privatePath = (path: string) => {
        const withinRoot = roots.map(root => relative(root, path))
          .find(path => !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
        return (withinRoot ?? path).split(sep).some(privateSegment);
      };
      server.middlewares.use(async (request, response, next) => {
        let pathname: string;
        try { pathname = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'); }
        catch { response.statusCode = 400; response.end('Invalid URL'); return; }
        const candidates = pathname.startsWith('/@fs/')
          ? [pathname.slice('/@fs/'.length)]
          : [resolve(server.config.root, `.${pathname}`),
            ...(server.config.publicDir ? [resolve(server.config.publicDir, `.${pathname}`)] : [])];
        const alias = server.config.resolve.alias.find(({ find }) => typeof find === 'string' ? pathname.startsWith(find) : find.test(pathname));
        if (alias) {
          const redirected = pathname.replace(alias.find, alias.replacement);
          // Vite's own client aliases use URL /@fs/ prefixes, not filesystem directories.
          const aliasPath = redirected.startsWith('/@fs/') ? redirected.slice('/@fs/'.length) : redirected;
          if (isAbsolute(aliasPath)) candidates.push(resolve(aliasPath));
        }
        try {
          for (const candidate of candidates) {
            if (privatePath(candidate)) {
              response.statusCode = 403; response.end('Forbidden'); return;
            }
            let resolved: string;
            try { resolved = await realpath(candidate); }
            catch (error) {
              if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
              throw error;
            }
            if (privatePath(resolved)) {
              response.statusCode = 403; response.end('Forbidden'); return;
            }
          }
          next();
        } catch (error) { next(error); }
      });
    },
  }, {
    name: 'devlab-preview-observation', apply: 'serve',
    transformIndexHtml: () => [
      { tag: 'script', attrs: { src: '/api/preview/bridge.js' }, injectTo: 'head' },
      { tag: 'script', attrs: { type: 'module' }, children: refreshObservation, injectTo: 'head' },
    ],
  }],
  define: { 'import.meta.env.DEVLAB_BACKEND_ORIGIN': JSON.stringify('') },
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}'] }, watch: { ignored: ['**/_LAB/**', '**/_preimp/**'] } },
  // Open workspaces can still request lazy chunks from the previous build.
  build: { target: 'es2023', emptyOutDir: false, ...(process.env.DEVLAB_BUILD_DIR ? { outDir: process.env.DEVLAB_BUILD_DIR } : {}) },
});
