import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// The same Content-Security-Policy as deploy/nginx (connect-src 'self': the page cannot send data anywhere).
const csp = readFileSync(new URL('./deploy/csp.txt', import.meta.url), 'utf8').trim();

// Relative base so the build works on GitHub Pages (/<repo>/) and any other static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  preview: { headers: { 'Content-Security-Policy': csp } },
  build: {
    chunkSizeWarningLimit: 1500,
    // keep fonts and images as files, so the strict CSP (font-src 'self') applies to everything
    assetsInlineLimit: 0,
  },
});
