# O3d: Zero-Copy WebGPU Rendering in Rust + WebAssembly

> A 2D/3D instanced rendering engine for the browser. Entity data lives in Rust-owned WebAssembly memory, JavaScript reads it through aliased typed arrays, only the modified byte ranges reach the GPU, and everything visible is drawn in a single instanced draw call.

**[▶ Live playground](https://omern8878.github.io/O3d/)**: a 50,000-particle vector cat you can orbit, zoom, pick and benchmark (WebGPU, with a Canvas2D fallback).

<p align="center">
  <img src="docs/media/cat-showcase.gif" alt="The vector cat point cloud swaying in 3D, orbited, picked and zoomed" width="800">
</p>

| 2D orthographic: crisp vector edges | 3D perspective: volumetric relief |
|---|---|
| ![2D orthographic view of the cat, eyes picked and pulsing](docs/media/cat-2d-ortho.png) | ![3D orbit of the cat point cloud](docs/media/cat-3d-orbit.png) |
| **Zoomed in: live frustum culling** | **Built-in benchmark vs. a JS object graph** |
| ![Zoomed into the face; 26,209 of 50,000 drawn](docs/media/cat-zoomed-culling.png) | ![Benchmark comparison table](docs/media/benchmark-results.png) |

A screen recording of the showcase is also available as [WebM](docs/media/cat-showcase.webm).

In the 2D shot, the HUD lists exactly two GPU writes for that frame: the animated tail's position slice (43.7 KB) and the colour slice of the picked eyes (30.5 KB). The other ~44,000 particles upload **0 bytes**.

---

## Benchmark: O3d vs. a Traditional Object Graph

The baseline is how many scene graphs work: an array of JS objects `{ id, position: {x,y,z}, scale: {x,y,z}, color: {r,g,b} }`, repacked into a `Float32Array` and uploaded in full every frame, with no culling. Both sides hold the same seeded 100,000-point cloud and upload to the same WebGPU device.

| Workload (100,000 entities) | Metric | **O3d** | Baseline | O3d advantage |
|---|---|---:|---:|---:|
| **1. Static scene, orbiting camera** | CPU / frame | **0.50 ms** | 1.70 ms | 3.4× faster |
| | Instance bytes / frame | **0 B** | 3.43 MB | 100% less |
| **2. Localized animation** (1% contiguous slice moves) | CPU / frame | **0.60 ms** | 1.20 ms | 2.0× faster |
| | Instance bytes / frame | **11.7 KB** | 3.43 MB | 99.7% less |
| **3. Zoomed-in frustum culling** (4.5% visible) | CPU / frame (cull + compact + upload) | **0.40 ms** | 1.20 ms | 3.0× faster |
| | Instance bytes / frame | **158.3 KB** | 3.43 MB | 95.5% less |
| | Instances drawn | **4,502** | 100,000 | 95.5% fewer |
| **4. Raycast picking** (inverse view-projection) | Latency per pick | **0.20 ms** | 0.30 ms | 1.5× faster |

<sub>Median of 30 frames after 5 warm-up frames; Chrome 155 (headless, Metal WebGPU) on an Apple M5, macOS 26.6. Browsers round `performance.now()` to about 0.1 ms without cross-origin isolation, so treat sub-millisecond times as ±0.1 ms. In workload 4 both pickers returned the same entity for 25 of 25 pointer positions. Run it yourself with **Run 100k Benchmark** in the playground; the raw report is in [`docs/media/benchmark-results.json`](docs/media/benchmark-results.json).</sub>

What the numbers say:

- **Bandwidth is where O3d wins decisively.** An unchanged frame uploads nothing, a moving slice uploads only that slice, and a zoomed-in view uploads only what is on screen. The baseline pushes 3.43 MB every frame regardless, which costs bus bandwidth, battery and driver time beyond the CPU figures above.
- **CPU time is 2-3.4× lower** even though O3d does extra work each frame: a Wasm frustum test over all 100,000 entities whenever the camera moves.
- **Picking is only modestly faster**, because a brute-force ray test over packed arrays and one over JS objects are both cheap at this size. O3d's gain there is no GPU read-back and no picking pass.

---

## At a Glance

| Guarantee | What it means |
|-----------|---------------|
| Zero-copy | Typed arrays alias Wasm linear memory; entity data is never serialized or duplicated on the JS side. |
| O(1) ECS | Sparse-set indexing with Structure-of-Arrays storage: constant-time create, remove and lookup. |
| Idle = 0 bytes | Unchanged scenes upload nothing, whether fully visible or culled; edits upload only the touched slice. |
| One draw call | All visible entities render as instanced quads in a single `draw`. |
| Culled on the CPU | Gribb-Hartmann frustum culling with stream compaction sends only visible instances. |
| Camera-facing SDF shapes | Billboarded quads with analytically anti-aliased discs: smooth at any zoom, solid from any angle. |
| Pixel-accurate picking | Click or tap any point to get the entity under it, nearest-first, in 2D and 3D. |
| Measurable | `getFrameStats()` reports drawn instances and every byte uploaded, per frame. |
| Read-only by type | Consumers receive immutable views; the engine owns all writes. |
| Panic-free boundary | Invalid input from JavaScript cannot crash the Wasm module. |

## Quick Start

```bash
npm install
npm run build   # Rust → Wasm (wasm-pack), the library bundle and the playground
npm run dev     # playground on http://localhost:5173
npm test        # every TypeScript unit, integration, benchmark and end-to-end test
```

Building needs Rust with the `wasm32-unknown-unknown` target, [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) and Node.js 22+. Rendering needs a browser with WebGPU (recent Chrome, Edge or Safari) served over HTTPS or `localhost`; elsewhere the playground falls back to a Canvas2D preview of the same pipeline.

The library builds to a self-contained ES module: the JavaScript bundle, type declarations, and the Wasm binary next to them. It has no runtime dependencies and needs no bundler plugins.

---

## How It Works

```text
Rust ECS in Wasm memory ──zero-copy views──▶ dirty-range tracking ──sub-slice uploads──▶ GPU instance buffers ──▶ 1 draw call
          ▲                                                                                      ▲
 Camera + frustum culling + picking (Rust) ──────── 64-byte view-projection uniform, sent only when it changes
```

1. You create and update entities by stable ID; data is written straight into Wasm memory.
2. The engine records which index range of each channel (position, scale, colour) changed.
3. Optionally, it culls entities outside the camera's view and compacts the visible ones.
4. Only the changed (or newly visible) bytes are uploaded to the GPU.
5. Everything is drawn in one instanced draw call.

### O(1) Entity Component System
A **sparse set** maps stable entity IDs to dense indices, and components are stored as **Structure-of-Arrays** (positions, scales and colours, three `f32` each). The arrays are tightly packed, so the GPU consumes them directly as vertex buffers and the CPU iterates them cache-friendly.

- **Create:** reuses a freed ID or appends; capacity doubles when full, so cost is O(1) amortized.
- **Remove:** **swap-and-pop** moves the last entity into the vacated slot, keeping arrays gap-free in O(1). The overwritten slot is reported so exactly that slot is re-uploaded.
- **Lookup:** a direct array read; stale or invalid IDs resolve to "not found" instead of failing.

### Dirty Sub-Slice Uploads
Change tracking keeps one inclusive `[min, max]` interval of dense indices per channel. Each frame issues **at most one `writeBuffer` per dirty channel, covering only that interval**.

- **Nothing changed:** zero instance uploads, zero bytes. The camera uniform is skipped too unless the camera moved.
- **One entity edited:** a single 12-byte write on the channel that changed.
- **A contiguous group animated:** one write covering exactly that group, which is why the playground stores the cat's tail as one contiguous index range.
- **Deliberate trade-off:** one interval per channel means clean entities between two dirty ones are re-sent, in exchange for a single contiguous write.

### Gribb-Hartmann Frustum Culling with Stream Compaction
Six normalized frustum planes are extracted directly from the column-major view-projection matrix (Gribb-Hartmann), adapted to WebGPU's `[0, 1]` depth range (`near = row 2`, `far = row 3 − row 2`). Each entity is tested as a bounding sphere whose radius is half the diagonal of its scale. **Stream compaction** then copies only the visible entities into packed arrays, reusing allocated capacity every frame.

| Situation | Behaviour | Instance upload |
|-----------|-----------|-----------------|
| Everything visible | Dirty-tracked full path | Dirty sub-slices only (0 bytes if unchanged) |
| Partially visible, nothing changed | Previous visible set redrawn; no cull | None |
| Partially visible, camera or entities changed | Re-cull and compact | The visible set |
| Nothing visible | Clear the screen only | None; draw skipped |

When the view returns to "everything visible", all entities are marked dirty once so the GPU resynchronizes with the full arrays.

### Raycasting & Spatial Picking
A screen point is unprojected through the **inverse view-projection matrix** (adjugate/determinant inverse, rejected when singular) into a world-space ray from the near plane (`z = 0`) to the far plane (`z = 1`) of WebGPU's clip range. Wasm intersects the ray with each entity's bounding sphere (radius `0.5 × largest scale component`) and keeps the **nearest hit along the ray**, so overlapping entities resolve by depth in both orthographic and perspective views. Picking returns the stable `EntityId`, needs no GPU round-trip, and returns `null` for non-finite input, an empty scene or a non-invertible camera.

### Camera-Facing SDF Shapes
Every instance is a unit quad expanded in **view space**, so it always faces the camera. Rendering then agrees with the spheres used for culling and picking, and a 3D point cloud stays solid from every angle. For a rigid view and a standard projection, a view-space offset `(dx, dy, 0)` moves the clip position by `(|row₀(VP)|·dx, |row₁(VP)|·dy)` and leaves `w` unchanged, so the shader needs only the existing `view_proj` uniform. In a front-on 2D view the result is identical to world-aligned quads.

In **circle** mode the fragment shader computes the distance from the quad's centre, discards outside the unit circle, and derives edge coverage from its screen-space derivative (`1 − smoothstep(1 − fwidth, 1, dist)`). The output is premultiplied alpha, so overlapping discs blend correctly. **Quad** mode is crisp and opaque. The shape is a pipeline-overridable constant, so the unused branch costs nothing.

---

## Hard Invariants

| # | Invariant | Details |
|---|-----------|---------|
| 1 | **Matrix order** | Strict **column-major** `[f32; 16]` matching WGSL `mat4x4<f32>`: element `(row, col)` lives at `m[col * 4 + row]`, and matrices act on column vectors (`clip = projection * view * model * point`). Never transpose to "fix" a bug; fix the producer. |
| 2 | **Depth range** | WebGPU **zero-to-one, right-handed** clip depth (`orthographic_rh_zo`, `perspective_rh_zo`): near plane at `z = 0`, far plane at `z = 1`. The camera looks down its local `−Z`. |
| 3 | **Memory model** | **Zero-copy** `Float32Array` views alias Wasm linear memory. A view dies when the Rust arrays reallocate **or** when Wasm memory grows (`memory.grow` detaches the old `ArrayBuffer`). The engine re-syncs views automatically on both events (a capacity or `byteLength` check); never hold a raw view across a call that can allocate. |
| 4 | **Encapsulation** | Consumers only receive `ReadonlyFloat32Array`-based views. Every write goes through the public managers so change tracking stays correct. |

Corollaries:

- **One consumer clears dirty state.** Only the GPU upload step reads and resets change tracking.
- **IDs are stable, indices are not.** An `EntityId` is valid for the entity's whole life; its dense index changes when other entities are removed.
- **Culled frames break the dense mirror.** After drawing a compacted subset, the GPU no longer mirrors the full arrays, so the renderer re-marks everything dirty before returning to the full path.
- **The Wasm boundary is hostile input.** Every exported method tolerates `NaN`, infinities, zero, stale IDs and degenerate geometry without panicking.

## Memory Safety & Security

### Read-only encapsulation (compile time)
Zero-copy views expose live engine memory, so consumers get **compile-time immutable** types. `ReadonlyFloat32Array` and `ReadonlyUint32Array` remove `set`, `fill`, `copyWithin`, `reverse` and `sort`, make element access read-only, and keep `subarray` slices read-only too. Entity views, culling results and the camera matrix all use them.

```ts
const { positions } = scene.getNodeViews();

positions[0] = 1;          // TS error: index signature only permits reading
positions.set([1, 2, 3]);  // TS error: 'set' does not exist
```

The only place a view is cast back to a writable array is the final GPU `writeBuffer`, which only reads from it. Raw Wasm structs and `wasm_memory` are never exported from the package entry point.

> Immutability is enforced by the type system, not at runtime. Plain JavaScript can still write to the underlying memory, so treat the views as read-only.

### Wasm boundary input sanitization (runtime)
Everything crossing from JavaScript into Rust is validated, so no call sequence can trigger a Wasm `panic!`:

- **Capacities** are clamped to a safe range (minimum 1); growth arithmetic saturates instead of overflowing.
- **Entity IDs** that are out of range, stale or already removed are ignored.
- **Camera inputs** that are `NaN`, infinite or out of range are ignored and the previous state is kept (`is_finite()` checks and range bounds). Aspect ratios outside `[1e-4, 1e4]` are rejected, and zoom values are clamped.
- **Degenerate geometry** (eye on the target, or an up vector that is zero or parallel to the view direction) still yields a valid, finite, orthonormal view matrix.
- Each of these cases is covered by regression tests.

> Known limit: genuine Wasm memory exhaustion traps instead of raising a catchable error.

---

## API

### `SceneTemplate`: everything in one object

```ts
import { initEngine, SceneTemplate } from "@engine/templates";

await initEngine(); // load the Wasm module once

const canvas = document.querySelector<HTMLCanvasElement>("#render-canvas")!;
const scene = await SceneTemplate.create({
  canvas,
  cameraMode: "perspective3d", // or "ortho2d" (default)
  shapeMode: "circle",         // anti-aliased SDF discs (default); "quad" for crisp squares
  enableCulling: true,         // draw only what is on screen (default)
  initialCapacity: 100_000,
});

// Nodes are plain tuples: position, scale (size), colour (r, g, b in 0..1).
const a = scene.addNode([-20, 0, 0], [12, 12, 12], [0.2, 0.7, 1.0]);
const b = scene.addNode([20, 10, 0], [8, 8, 8], [1.0, 0.5, 0.2]);

scene.updateNodePosition(b, [25, 15, 0]);
scene.updateNodeColor(a, [1, 1, 1]);
scene.removeNode(b); // true if the node existed

canvas.addEventListener("pointerdown", (event) => {
  const hit = scene.pickNodeAtScreen(event.clientX, event.clientY, canvas.getBoundingClientRect());
  if (hit !== null) scene.updateNodeColor(hit, [1, 0, 0]);
});

scene.setShapeMode("quad");          // switch shapes at runtime
scene.setCameraMode("ortho2d");      // or projections
scene.getCameraController().resize(canvas.width, canvas.height);

function frame() {
  scene.renderFrame();
  const { drawnCount, totalCount, uploadedBytes, uploads } = scene.getFrameStats();
  // e.g. uploadedBytes === 0 for an unchanged frame
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`SceneTemplate` composes the managers below; reach for them directly when you need finer control.

### `EntityManager`: create and update entities

```ts
import { EntityManager } from "@engine/templates";

const entities = new EntityManager(1000); // initial capacity; grows automatically

const id = entities.createEntity({
  position: { x: 10, y: 20, z: 0 },
  scale: { x: 12, y: 12, z: 1 },
  color: "#ff8800", // or { r: 1, g: 0.5, b: 0 } with channels in 0..1
});

entities.updateEntity(id, { position: { x: 15 } }); // partial update, tracked as dirty
entities.removeEntity(id);                          // unknown IDs are ignored

const { positions } = entities.getRawViews();       // read-only zero-copy view
```

### `CameraController`: 2D and 3D views

```ts
import { CameraController } from "@engine/templates";

const camera = new CameraController({ mode: "2d", orthoHalfHeight: 100 });
camera.resize(canvas.width, canvas.height); // keeps the aspect ratio correct
camera.panByPixels(dx, dy, canvas.height);  // drag to pan
camera.zoom(0.9);                           // < 1 zooms in, > 1 zooms out
camera.setOrthoHalfHeight(120);             // absolute 2D extent

const orbit = new CameraController({
  mode: "3d",
  position: { x: 0, y: 5, z: 20 },
  target: { x: 0, y: 0, z: 0 },
});
orbit.orbit(0.02, -0.01);                   // azimuth, elevation (radians)
const viewProj = orbit.getViewProjection(); // read-only column-major 4×4
```

### `PickingController`: entity under the pointer

```ts
import { PickingController } from "@engine/templates";

const picking = new PickingController();

canvas.addEventListener("pointerdown", (event) => {
  const id = picking.pickAtScreenCoords(
    event.clientX, event.clientY, canvas.getBoundingClientRect(), entities, camera,
  );
  if (id !== null) entities.updateEntity(id, { color: "#ffffff" });
});

const hit = picking.pickByNdc(0, 0, entities, camera); // NDC x, y in [-1, 1], +Y up
```

### `InstancedRenderer` and `CullingManager`: the render loop by hand

```ts
import { CullingManager, GpuContext, InstancedRenderer } from "@engine/templates";

const gpu = await GpuContext.create({ canvas, clearColor: { r: 0.05, g: 0.05, b: 0.1, a: 1 } });
const renderer = new InstancedRenderer(gpu, 1000, "circle");
const culling = new CullingManager(1000);

function frame() {
  gpu.resizeToDisplaySize();
  camera.resize(canvas.width, canvas.height);
  renderer.renderCulled(entities, camera, culling); // or: camera.syncIfDirty(renderer); renderer.render(entities);
  requestAnimationFrame(frame);
}
```

### `BenchmarkSuite` and `createHeadlessGpuContext`

```ts
import { BenchmarkSuite, GpuContext, createHeadlessGpuContext } from "@engine/templates";

// With a real device the report includes driver upload costs…
const report = await new BenchmarkSuite(await GpuContext.create({ canvas })).run({ entityCount: 100_000 });
// …or run CPU-only anywhere (Node, CI) with uploads counted and discarded.
const cpuOnly = await new BenchmarkSuite().run({ entityCount: 20_000 });

// The same headless context runs a full SceneTemplate without a GPU.
const scene = new SceneTemplate(createHeadlessGpuContext());
```

---

## The Playground

The live playground opens straight into the vector cat showcase:

- **Vector → particles.** A layered SVG (body, chest, ears with pink insides, curled tail, emerald eyes with vertical pupils, nose, mouth, whiskers) is parsed and sampled into 20k / 50k / 100k particles. Dense contour samples give razor-sharp edges, low-discrepancy fill samples give solid interiors, and a stacked relief height field gives each layer depth. The result reads as flat vector art in 2D and as a hologram when orbited.
- **Dirty sub-slice proof.** Every named layer is one contiguous index range. The tail is animated with a travelling wave each frame, and the HUD lists the exact writes: the tail's position slice, and nothing for the static body.
- **Interact.** Drag to orbit (Shift or right-drag to pan), wheel or pinch to zoom into the face and watch *Visible drawn* fall below *Total entities*. Click or tap any part to raycast-pick it: the HUD shows its `EntityId` and body part, and the part pulses gold.
- **Controls.** Camera (3D perspective / 2D ortho), shape (SDF circle / quad), particle count, tail animate / freeze, **Upload Custom SVG** (paths, basic shapes, groups, transforms, inline styles, both fill rules), and **Run 100k Benchmark**.
- **Fallback.** Without a WebGPU adapter the same pipeline runs on a headless GPU context and a software rasterizer draws it. The HUD badges the active backend.

## Development

| Command | What it does |
|---------|--------------|
| `npm run build:wasm` | Compiles the Rust engine to WebAssembly with `wasm-pack`. |
| `npm run build` | Wasm, then the publishable library bundle and declarations, then the playground production build. |
| `npm test` | All TypeScript tests across the workspaces (Node's built-in runner; no GPU needed). |
| `npm run dev` | Playground dev server with hot reload. |
| `npm run capture:media` | Re-captures the screenshots, GIF, WebM and benchmark report above with headless Chrome (after `npm run build`). |
| `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` | Rust formatting, lints and unit tests (run in the engine crate). |

Continuous integration runs all of the above on every push and pull request. Every push to `main` also deploys the playground to GitHub Pages.

## License

MIT
