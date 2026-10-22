// Resolves `@engine/templates` to the library source in Node tests, matching
// the Vite alias and the tsconfig `paths`, so tests and the dev server run
// the same code with a single shared Wasm instance.
import { registerHooks } from "node:module";

const LIBRARY_SOURCE = new URL("../../../packages/templates/src/index.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@engine/templates") return { url: LIBRARY_SOURCE, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
