import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the server runs on :8787; the web app talks to it through Vite's proxy, so the app always
// uses relative URLs (/api, /session) and works the same when the server serves the built app in production.
const server = process.env.VOCCO_SERVER || 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/health': server,
      '/session': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
