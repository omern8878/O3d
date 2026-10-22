import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * `PLAYGROUND_BASE` sets the public path (e.g. `/O3d/` on GitHub Pages);
 * the relative default works from any sub-directory.
 */
export default defineConfig({
  base: process.env.PLAYGROUND_BASE ?? './',
  resolve: {
    // Develop against the library source; the published package ships `dist/`.
    alias: {
      '@engine/templates': fileURLToPath(new URL('../../packages/templates/src/index.ts', import.meta.url)),
    },
  },
  build: { target: 'es2022' },
})
