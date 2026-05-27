import { defineConfig } from 'vite'

export default defineConfig({
  base: '/os/',
  build: {
    outDir: '../../memory/web/public/os',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false
  }
})
