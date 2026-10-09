import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// HTTPS opcional (Fase 2, item 3): fora de localhost, getUserMedia exige
// contexto seguro. Defina TLS_CERT/TLS_KEY para servir o dev server em HTTPS.
const tlsCert = process.env.TLS_CERT;
const tlsKey = process.env.TLS_KEY;
const https =
  tlsCert && tlsKey ? { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) } : undefined;

export default defineConfig({
  root: '.',
  // simple-peer vem do ecossistema Node (readable-stream) e precisa dos
  // shims de global/process/Buffer/stream para rodar no browser.
  plugins: [nodePolyfills()],
  server: {
    port: 5173,
    open: true,
    // `host: true` expõe na LAN (0.0.0.0) para testar fora de localhost.
    host: true,
    https,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Duas páginas: o jogo (index.html) e o editor de mapas (editor.html).
      input: {
        main: 'index.html',
        editor: 'editor.html',
      },
    },
  },
});
