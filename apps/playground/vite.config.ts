import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const CROSS_ORIGIN_ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

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
  build: {
    target: 'es2022',
    // Three.js's WebGPU build (~1.08 MB) is a lazy chunk loaded only when the
    // competitor benchmark runs; the showcase bundle itself is ~75 kB.
    chunkSizeWarningLimit: 1100,
  },
  // Cross-origin isolation raises performance.now() resolution from ~100 µs
  // to ~5 µs, which the benchmark's sub-millisecond timings need. (GitHub
  // Pages cannot send these headers, so the hosted demo stays at ~100 µs.)
  server: { headers: CROSS_ORIGIN_ISOLATION },
  preview: { headers: CROSS_ORIGIN_ISOLATION },
})
