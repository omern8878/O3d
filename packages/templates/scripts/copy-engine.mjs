// Copies the wasm-pack output into dist/ and points the emitted type
// declarations at it, so the published package has no workspace dependency.
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const engineEntry = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine.js"));
const enginePkg = dirname(engineEntry);

for (const file of ["engine.js", "engine.d.ts", "engine_bg.wasm", "engine_bg.wasm.d.ts"]) {
  copyFileSync(join(enginePkg, file), join(dist, file));
}

const ENGINE_SPECIFIER = /(["'])@engine\/core\/pkg\/engine\.js\1/g;
// tsc keeps source `.ts` specifiers in declarations; consumers resolve `.js`.
const RELATIVE_TS_SPECIFIER = /(["'])(\.{1,2}\/[^"']+)\.ts\1/g;
for (const file of walk(dist).filter((path) => path.endsWith(".d.ts") && !path.includes("engine"))) {
  const depth = file.slice(dist.length + 1).split("/").length - 1;
  const engine = depth === 0 ? "./engine.js" : `${"../".repeat(depth)}engine.js`;
  const source = readFileSync(file, "utf8")
    .replace(ENGINE_SPECIFIER, `"${engine}"`)
    .replace(RELATIVE_TS_SPECIFIER, `"$2.js"`);
  writeFileSync(file, source);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
