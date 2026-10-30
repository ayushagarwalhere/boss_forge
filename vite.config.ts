import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  server: { host: '127.0.0.1' },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./web/index.html', import.meta.url)),
        play: fileURLToPath(new URL('./web/play/index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./web/overlay/index.html', import.meta.url)),
        forge: fileURLToPath(new URL('./web/forge/index.html', import.meta.url)),
      },
    },
  },
});
