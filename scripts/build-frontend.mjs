import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));

export function buildFrontend() {
  return build({
    absWorkingDir: root,
    entryPoints: ['frontend/App.jsx'],
    outfile: 'public/dist/app.js',
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
  });
}

if (import.meta.main) await buildFrontend();
