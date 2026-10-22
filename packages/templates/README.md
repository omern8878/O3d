# @engine/templates

Zero-copy Rust/WebAssembly + WebGPU instanced renderer for the browser.

```ts
import { initEngine, SceneTemplate } from "@engine/templates";

await initEngine();
const scene = await SceneTemplate.create({ canvas, cameraMode: "perspective3d" });
const id = scene.addNode([0, 0, 0], [4, 4, 4], [0.2, 0.9, 0.6]);

function frame() {
  scene.renderFrame();                    // draws only what is visible
  scene.getFrameStats().uploadedBytes;    // 0 for an unchanged frame
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

The package is a self-contained ES module: `index.js`, type declarations and
the `engine_bg.wasm` binary it loads from next to itself. No bundler plugins
are needed.

Documentation, benchmarks and a live playground:
https://github.com/omern8878/O3d

MIT licensed.
