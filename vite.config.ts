import { defineConfig } from 'vite';

// Fuer GitHub Pages liegt die Seite unter https://<user>.github.io/Race-Manager/.
// Der Basispfad muss exakt der Repo-Schreibweise entsprechen.
// Lokal (dev/preview) wird der Basispfad auf '/' gesetzt.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Race-Manager/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
