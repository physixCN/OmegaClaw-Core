/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `vite build --mode demo`: a static build that always runs the in-browser simulator, with relative
// asset URLs so it can be served from any directory (or wrapped as a hosted page, scripts/artifact-page.mjs).
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'demo' ? './' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 400,
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    // the demo is served as plain files: no modulepreload polyfill fetches, no absolute URLs
    modulePreload: mode === 'demo' ? { polyfill: false } : undefined,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
