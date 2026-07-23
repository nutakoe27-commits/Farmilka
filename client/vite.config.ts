import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // relative asset paths so the built client works both at our domain root and
  // inside the Yandex Games archive (served under a path prefix)
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(root, '../shared/src'),
    },
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/admin': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
