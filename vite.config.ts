import { defineConfig } from 'vite';

// Die Seite liegt auf GitHub Pages unter https://<user>.github.io/Race-Manager/.
// Der Basispfad muss exakt der Repo-Schreibweise entsprechen und gilt auch fuer
// `vite dev` und `vite preview`, damit lokal dieselben Pfade greifen wie live.
export default defineConfig({
  base: '/Race-Manager/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
