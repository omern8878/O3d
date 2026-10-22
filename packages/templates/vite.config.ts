import { defineConfig } from "vite";

/**
 * Library build: one ESM bundle of the TypeScript sources. The Wasm engine's
 * glue stays a separate module next to it (`dist/engine.js` +
 * `engine_bg.wasm`, copied by `scripts/copy-engine.mjs`) so its
 * `new URL("engine_bg.wasm", import.meta.url)` resolves without a bundler.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["@engine/core/pkg/engine.js"],
      output: { paths: { "@engine/core/pkg/engine.js": "./engine.js" } },
    },
  },
});
