import { defineConfig } from 'vite';

// Fuer GitHub Pages liegt die Seite unter https://<user>.github.io/race-manager/.
// Lokal (dev/preview) wird der Basispfad auf '/' gesetzt.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/race-manager/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
