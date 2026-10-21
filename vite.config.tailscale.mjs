import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Runtime config so the local elw-mailing-list client is reachable over
// Tailscale (MagicDNS *.ts.net). Mirrors repo defaults (port 5173,
// proxy /api -> localhost:3000) plus host binding. Not committed.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  root: 'client',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true, // bind all interfaces for Tailscale access
    allowedHosts: ['.ts.net'],
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});