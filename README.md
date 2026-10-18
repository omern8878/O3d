# High-Performance Browser Rendering Engine (Rust, Wasm, WebGPU)

> A zero-copy, high-throughput 2D/3D instanced rendering engine. Entity data lives in Rust-owned WebAssembly memory, JavaScript reads it through aliased typed arrays, only modified byte ranges reach the GPU, and everything visible is drawn in a single instanced draw call.

```text
Rust ECS in Wasm memory ──zero-copy views──▶ dirty-range tracking ──sub-slice uploads──▶ GPU instance buffers ──▶ 1 draw call
          ▲                                                                                      ▲
 Camera + frustum culling (Rust) ───────────── 64-byte view-projection uniform, sent only when it changes
```

**At a glance**

| Guarantee | What it means |
|-----------|---------------|
| Zero-copy | Typed arrays alias Wasm linear memory; entity data is never serialized or duplicated on the JS side. |
| O(1) ECS | Sparse-set indexing with Structure-of-Arrays storage: constant-time create, remove and lookup. |
| Idle = 0 bytes | Unchanged scenes upload nothing; edits upload only the touched slice. |
| One draw call | All entities render as instanced quads in a single `draw`. |
| Culled on the CPU | Gribb-Hartmann frustum culling with stream compaction sends only visible instances. |
| Read-only by type | Consumers receive immutable views; the engine owns all writes. |
| Panic-free boundary | Invalid input from JavaScript cannot crash the Wasm module. |

---

## Why Use It

- **Draw large numbers of objects without a CPU bottleneck.** Entity data stays in Wasm memory and reaches the GPU as packed buffers, with no per-object JavaScript work in the render loop.
- **Pay only for what changes.** A static scene costs almost nothing per frame; moving one object uploads a few bytes.
- **Stay smooth on mobile.** Fewer uploads, one draw call and culling of off-screen objects save bandwidth, fill-rate and battery.
- **Simple, safe API.** You work with stable entity IDs, plain objects and read-only views. Bad input is ignored instead of crashing the engine.
- **2D and 3D from one renderer.** Orthographic and perspective cameras, pan, zoom and orbit controls are built in.

## How It Works

1. You create and update entities through `EntityManager`; data is written directly into Wasm memory.
2. The engine records which ranges changed.
3. Optionally, it culls entities outside the camera's view.
4. Only the changed (or visible) data is uploaded to the GPU.
5. `InstancedRenderer` draws everything in one instanced draw call.

---

## 🧠 AI & Architecture Blueprint (LLM-Optimized Context)

Read this before changing or extending the engine. These are the contracts the design depends on.

### Hard Invariants (Never violate these)

| # | Invariant | Details |
|---|-----------|---------|
| 1 | **Matrix order** | Strict **column-major** `[f32; 16]`: element `(row, col)` lives at `m[col * 4 + row]` and translation occupies the last column. Matrices act on column vectors: `clip = projection * view * model * point`. Never transpose to "fix" a bug; fix the producer. |
| 2 | **Depth range** | WebGPU **zero-to-one, right-handed** clip depth `[0.0, 1.0]`, never OpenGL's `[-1, 1]`. The camera looks down its local `-Z`, and frustum extraction uses the matching near/far plane formulas. |
| 3 | **Memory model** | **Zero-copy** `Float32Array` views alias Wasm linear memory. A view dies when the Rust arrays reallocate **or** when Wasm memory grows (`memory.grow` detaches the old `ArrayBuffer`). The engine re-syncs views automatically on both events; never hold a raw view across a call that can allocate. |
| 4 | **Encapsulation** | Consumers only receive `ReadonlyFloat32Array`-based views. Every write goes through the public managers so change tracking stays correct. Raw Wasm handles are marked `@internal` and are not part of the public surface. |

Corollaries:

- **One consumer clears dirty state.** Only the GPU upload step reads and resets change tracking.
- **IDs are stable, indices are not.** An `EntityId` is valid for the entity's whole life; its dense storage index changes when other entities are removed. Never keep dense indices across frames.
- **Culled frames break the dense mirror.** After drawing a compacted subset, the GPU no longer mirrors the full entity arrays, so the renderer re-marks everything dirty before returning to the full path.
- **The Wasm boundary is hostile input.** Every exported method must tolerate `NaN`, infinities, zero, stale IDs and degenerate geometry without panicking.

---

## Core Architectural Strengths

### O(1) Entity Component System
A **sparse set** maps stable entity IDs to dense indices, and components are stored as **Structure-of-Arrays** (positions, scales and colors, three `f32` each). The arrays are tightly packed, so the GPU consumes them directly as vertex buffers and the CPU iterates them cache-friendly.

- **Create:** reuses a freed ID or appends; capacity doubles when full, so cost is O(1) amortized.
- **Remove:** **swap-and-pop** moves the last entity into the vacated slot, keeping arrays gap-free in O(1). The overwritten slot is reported so exactly that slot is re-uploaded.
- **Lookup:** a direct array read; stale or invalid IDs resolve to "not found" instead of failing.

### Zero-Copy Interop
JavaScript never copies entity data. Typed-array views are built directly over Wasm memory and rebuilt automatically whenever the underlying arrays move (buffer growth) or are detached (`memory.grow`). Culling results are exposed the same way, with views rebuilt on every access.

### Dirty Sub-Slice Uploads (0 bytes on idle)
Change tracking keeps one inclusive `[min, max]` interval of dense indices per channel (position, scale, color). Each frame issues **at most one `writeBuffer` per dirty channel, covering only that interval**.

- **Nothing changed:** zero instance uploads, zero bytes. The camera uniform is skipped too unless the camera moved.
- **One entity edited:** a single 12-byte write on the channel that changed.
- **Deliberate trade-off:** one interval per channel means clean entities between two dirty ones are re-sent, in exchange for a single contiguous write.

### Gribb-Hartmann Frustum Culling with CPU-Side Stream Compaction
Six normalized frustum planes are extracted directly from the column-major view-projection matrix (Gribb-Hartmann), adapted to WebGPU's `[0, 1]` depth range. Each entity is tested as a bounding sphere whose radius is half the diagonal of its scale.

**Stream compaction** then copies only the visible entities into packed arrays, reusing allocated capacity every frame. The GPU receives just those instances and the draw call carries the visible count (the draw is skipped when nothing is visible).

| Situation | Behavior | Instance upload |
|-----------|----------|-----------------|
| Everything visible | Dirty-tracked full path | Dirty sub-slices only (0 bytes if unchanged) |
| Partially visible | Compacted visible set | The visible set each frame (camera uniform still skipped if unchanged) |
| Nothing visible | Clear the screen only | None; draw skipped |

When the view returns to "everything visible", all entities are marked dirty once so the GPU resynchronizes with the full arrays.

---

## Memory Safety & Security

### Readonly Encapsulation (compile time)
Zero-copy views expose live engine memory, so consumers get **compile-time immutable** types:

- `ReadonlyFloat32Array` and `ReadonlyUint32Array` remove `set`, `fill`, `copyWithin`, `reverse` and `sort`, make element access read-only, and keep sub-views (`subarray`) read-only too.
- `ReadonlyRawEntityViews` groups the position, scale and color views returned by the entity manager.
- Culling results are exposed through the same read-only types.

```ts
const { positions } = entities.getRawViews();

positions[0] = 1;          // TS error: index signature only permits reading
positions.set([1, 2, 3]);  // TS error: 'set' does not exist
```

The only place a view is cast back to a writable array is the final GPU `writeBuffer` call, which only reads from it. Low-level Wasm handles are never exported from the package entry point.

> Immutability is enforced by the type system, not at runtime. Plain JavaScript can still write to the underlying memory, so treat the views as read-only.

### Wasm Boundary Input Sanitization (runtime)
Everything crossing from JavaScript into Rust is validated so no call sequence can trigger a Wasm `panic!`:

- **Capacities** are clamped to a safe range (minimum 1); growth arithmetic saturates instead of overflowing.
- **Entity IDs** that are out of range, stale or already removed are ignored.
- **Camera inputs** that are `NaN`, infinite or out of range are ignored and the previous state is kept. Aspect ratios outside `[1e-4, 1e4]` are rejected (the constructor falls back to `1.0`), and zoom values are clamped.
- **Degenerate geometry** (eye on the target, or an up vector that is zero or parallel to the view direction) still yields a valid, finite, orthonormal view matrix. Orbit and perspective zoom do nothing when the eye coincides with the target.
- Each of these cases is covered by regression tests.

> Known limit: genuine Wasm memory exhaustion traps instead of raising a catchable error.

---

## Code Snippets & Usage Guide

### Setup

```bash
npm install
npm run build:wasm      # compiles the Rust engine to WebAssembly (requires wasm-pack)
```

Rendering requires a browser with WebGPU (recent Chrome, Edge or Safari) served over HTTPS or `localhost`.

### Create and update entities with `EntityManager`

```ts
import init from "@engine/core/pkg/engine.js";
import { EntityManager } from "@engine/templates";

await init(); // load the Wasm module once, before creating any manager

const entities = new EntityManager(1000); // initial capacity; grows automatically

const id = entities.createEntity({
  position: { x: 10, y: 20, z: 0 },
  scale: { x: 12, y: 12, z: 1 },
  color: "#ff8800", // or { r: 1, g: 0.5, b: 0 } with channels in 0..1
});

entities.updateEntity(id, { position: { x: 15 } }); // partial update, tracked as dirty
entities.removeEntity(id);                          // unknown IDs are ignored

console.log(entities.getActiveCount());
const { positions } = entities.getRawViews(); // read-only zero-copy view
```

### Control the view with `CameraController`

```ts
import { CameraController } from "@engine/templates";

// 2D orthographic camera
const camera = new CameraController({ mode: "2d", orthoHalfHeight: 100 });
camera.resize(canvas.width, canvas.height);  // keeps the aspect ratio correct
camera.panByPixels(dx, dy, canvas.height);   // drag to pan
camera.zoom(0.9);                            // < 1 zooms in, > 1 zooms out

// 3D perspective camera with orbit controls
const orbit = new CameraController({
  mode: "3d",
  position: { x: 0, y: 5, z: 20 },
  target: { x: 0, y: 0, z: 0 },
});
orbit.orbit(0.02, -0.01); // azimuth, elevation (radians)
```

### Render with `InstancedRenderer`

```ts
import {
  CameraController,
  CullingManager,
  EntityManager,
  GpuContext,
  InstancedRenderer,
} from "@engine/templates";

const canvas = document.querySelector<HTMLCanvasElement>("#render-canvas")!;
const gpu = await GpuContext.create({
  canvas,
  clearColor: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
});

const renderer = new InstancedRenderer(gpu, 1000);
const culling = new CullingManager(1000);

function frame() {
  gpu.resizeToDisplaySize();
  camera.resize(canvas.width, canvas.height);

  // Option A: draw everything (dirty-tracked uploads, 0 bytes when idle)
  camera.syncIfDirty(renderer); // 64-byte uniform, only if the camera changed
  renderer.render(entities);

  // Option B: draw only what is inside the frustum (also syncs the camera)
  // const drawn = renderer.renderCulled(entities, camera, culling);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Use either `render` or `renderCulled` in a frame, not both. Both return the number of instances drawn.

---

## License

MIT
