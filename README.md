# High-Performance Browser Rendering Engine (Rust, Wasm, WebGPU)

> A zero-copy, high-throughput 2D/3D instanced rendering engine: entity data lives in Rust-owned Wasm linear memory, JavaScript aliases it with typed-array views, only modified byte ranges reach the GPU, and everything visible is drawn in a single instanced draw call.

```text
Rust ECS (Wasm memory) ──zero-copy views──▶ DirtyTracker ──sub-slice writeBuffer──▶ GPU instance buffers ──▶ 1 draw call
        ▲                                                                                  ▲
 Camera + Frustum culling (Rust)  ────────── 64-byte view_proj uniform, only when it changes
```

---

## 🧠 AI & Architecture Blueprint (LLM-Optimized Context)

Read this section before editing anything. It is the contract of the codebase.

### Hard Invariants (Never violate these)

| # | Invariant | Details |
|---|-----------|---------|
| 1 | **Matrix Order** | Strict **column-major** `[f32; 16]`: element `(row, col)` is at `m[col * 4 + row]`; translation lives at indices `12..15`. Matrices act on column vectors: `clip = projection * view * model * point`. Never transpose "to fix" a bug; fix the producer. |
| 2 | **Depth Range** | WebGPU **zero-to-one, right-handed** clip depth `[0.0, 1.0]` (`*_rh_zo`), never OpenGL's `[-1, 1]`. The camera looks down its local `-Z`. Frustum planes follow it: Near = `row2`, Far = `row3 - row2`. |
| 3 | **Memory Model** | **Zero-copy** `Float32Array` views alias Wasm linear memory (`new Float32Array(wasm_memory().buffer, ptr, len)`). A view is invalidated when the Rust `Vec` reallocates (capacity change) **or** Wasm memory grows (`memory.grow` detaches the old `ArrayBuffer`). `WasmBufferView` re-syncs automatically on both; never cache a raw view across calls that can allocate. |
| 4 | **Encapsulation** | External consumers only receive `ReadonlyFloat32Array` / `ReadonlyRawEntityViews` / `VisibleViews`. All writes go through `EntityManager` so `DirtyTracker` stays correct. Raw Wasm handles are `@internal` and are not exported from the barrel. |

Additional rules that follow from the above:

- **Dirty tracking is single-consumer.** `GpuInstanceBuffers` is the only code that reads and clears the `DirtyTracker`.
- **Entity identity:** `EntityId` is stable for the life of an entity; the *dense index* changes on swap-and-pop removal. Never store dense indices across frames.
- **Culled frames break the dense mirror.** After `syncFromVisibleViews` the GPU buffers hold a compacted subset, so `InstancedRenderer` calls `markAllDirty` before returning to the dense path.
- **Wasm boundary is hostile input.** Every `#[wasm_bindgen]` method must tolerate `NaN`, infinities, zero, out-of-range IDs and degenerate geometry without panicking.

### Project Rules (`.cursorrules`, strictly enforced)

- **SRP:** one primary struct/class per file; every module has one reason to change.
- **Barrels only:** `lib.rs`, `mod.rs` and `index.ts` contain only `mod` / `pub use` / `export ... from`. No logic, data, or FFI bodies. `main.ts` only wires modules.
- **Rust tests live in sibling files:** `<module>_tests.rs`, linked at the bottom of the implementation file with exactly `#[cfg(test)] #[path = "<module>_tests.rs"] mod tests;`. No inline test bodies.
- **TypeScript tests** sit next to the code as `<name>.test.ts`; shared doubles go in `testing/` and are never exported from `index.ts`.
- **Separate data, math and bindings:** keep domain logic pure (no `#[wasm_bindgen]`) and wrap it in a thin binding layer. No magic numbers; document every public item.
- **Extend, don't grow:** add new types/modules rather than flags and special cases (Open/Closed).

### Module Map & SRP Breakdown

```text
packages/
├── engine/                        Rust crate -> Wasm (wasm-pack --target web)
│   └── src/
│       ├── lib.rs                 barrel only
│       ├── init.rs                init_engine() entrypoint
│       ├── memory.rs              wasm_memory() accessor
│       ├── ecs/
│       │   ├── sparse_set.rs      id <-> dense-index bookkeeping (pure, no Wasm types)
│       │   ├── entity_buffer.rs   SoA positions / scales / colors, Wasm-facing
│       │   └── culling_buffer.rs  stream-compacted visible entities, Wasm-facing
│       └── math/
│           ├── vec3.rs            add / sub / dot / cross / normalize
│           ├── mat4.rs            column-major Mat4, ortho / perspective / look_at (_rh_zo)
│           ├── spherical.rs       orbit-camera spherical coordinates
│           ├── camera.rs          Camera: owns view_proj, Ortho2D / Perspective3D
│           ├── frustum.rs         Gribb-Hartmann planes + sphere tests
│           └── input_guard.rs     finite / range validation of untrusted f32s
└── templates/  (@engine/templates)  TypeScript facade
    └── src/
        ├── index.ts               public barrel
        ├── scene/                 EntityManager, CameraController, CullingManager
        ├── memory/                dirty-tracker.ts, wasm-buffer-view.ts, vec3-layout.ts
        ├── renderer/              GpuContext, InstancedRenderer, GpuInstanceBuffers,
        │                          CameraUniformBuffer, shaders/ (WGSL)
        ├── geometry/              QuadGeometry (static unit quad)
        ├── types/                 public types incl. readonly-buffer.types.ts
        ├── utils/                 color parsing
        ├── testing/               mock WebGPU device (never exported)
        └── e2e/                   full-stack tests on real Wasm + mock GPU
apps/playground/                   Vite demo + memory diagnostics
```

| Path | Responsibility (single reason to change) |
|------|------------------------------------------|
| `packages/engine/src/ecs/` | **Sparse Set** (`sparse_set.rs`) and **SoA entity buffers** (`entity_buffer.rs`) giving O(1) allocate / remove / lookup; plus the culling output buffer (`culling_buffer.rs`). |
| `packages/engine/src/math/` | **Pure Rust linear algebra** (`mat4.rs`, `vec3.rs`, `camera.rs`, `frustum.rs`) with no JS types. Only `camera.rs` carries a thin Wasm binding. |
| `packages/templates/src/memory/` | **Dirty range tracking** (`dirty-tracker.ts`) and **zero-copy buffer views** (`wasm-buffer-view.ts`). Pure state and view lifecycle; knows nothing about the GPU. |
| `packages/templates/src/renderer/` | **WebGPU pipeline**, camera **uniform buffer**, GPU instance buffers and **instanced rendering**. The only layer that touches `GPUDevice`. |
| `packages/templates/src/scene/` | Ergonomic facades over Wasm: `EntityManager` (stable IDs + dirty marking), `CameraController` (dirty flag), `CullingManager` (frustum culling + visible views). |

### Data Flow per Frame

1. Mutations: `EntityManager.updateEntity` writes through the zero-copy view and marks a dense-index range dirty per channel.
2. `CameraController.syncIfDirty` uploads the 64-byte `view_proj` uniform only if the camera changed.
3. (Optional) `CullingManager.cullEntities` runs Gribb-Hartmann culling in Wasm and compacts the visible set.
4. `GpuInstanceBuffers` uploads only dirty sub-slices (or the compacted subset), then clears the tracker.
5. `InstancedRenderer` records one render pass with `pass.draw(6, instanceCount, 0, 0)`.

### Where to Make Common Changes

| Task | Edit | Do not |
|------|------|--------|
| New per-entity attribute | `entity_buffer.rs` (+ `_tests.rs`), `wasm-buffer-view.ts`, `dirty-tracker.ts` channel, `gpu-buffer-sync.ts`, shader | Add it to `lib.rs` or `index.ts` bodies |
| New math routine | New file in `math/` + sibling `_tests.rs` + `mod.rs` line | Put `#[wasm_bindgen]` in pure math files |
| New public Wasm method | Validate inputs (see `input_guard.rs`) and add degenerate-input tests | Allow `panic!`, `unwrap` or unchecked indexing on JS input |
| Expose new data to consumers | Return a `Readonly*` type | Return a mutable `Float32Array` |

---

## Core Architectural Strengths

### O(1) Entity Component System
A **sparse set** maps stable entity IDs to dense indices. Components are stored as **Structure-of-Arrays** (`positions`, `scales`, `colors`, 3 `f32` per entity) so the GPU reads them as tightly packed vertex buffers.

- `allocate_entity`: pops a recycled ID or appends; O(1) amortized (capacity doubles).
- `remove_entity`: **swap-and-pop** moves the last entity into the hole, keeping arrays gap-free; O(1). It returns the overwritten dense index (or `-1`) so the caller marks exactly that slot dirty.
- `get_dense_index`: O(1) array lookup; invalid or stale IDs return `undefined`/`None`.

### Zero-Copy Interop
JavaScript never copies entity data. `WasmBufferView` builds `Float32Array` views directly over Wasm memory at the `*_ptr()` offsets and rebuilds them whenever the Rust arrays reallocate or `memory.grow` detaches the underlying `ArrayBuffer`. `CullingManager.getVisibleViews()` rebuilds its views on every call for the same reason.

### Dirty Sub-Slice Uploads (0 bytes on idle)
`DirtyTracker` keeps one inclusive `[min, max]` dense-index interval per channel (`position`, `scale`, `color`). `GpuInstanceBuffers.syncFromEntities` issues **one `queue.writeBuffer` per dirty channel, covering only that interval**.

- Nothing changed: **0 `writeBuffer` calls, 0 bytes** for instance data, and the camera uniform is skipped too unless the camera moved.
- One entity edited: a single 12-byte write on the changed channel.
- Trade-off (by design): one interval per channel means clean entities between two dirty ones are re-sent, in exchange for a single contiguous write.

### Gribb-Hartmann Frustum Culling with CPU-Side Stream Compaction
`Frustum::from_view_proj` extracts six normalized planes directly from the column-major `view_proj` rows, adapted to the `[0, 1]` depth range (Near = `r2`, Far = `r3 - r2`). Each entity is tested as a bounding sphere (radius = half the diagonal of its scale vector).

`CullingBuffer::cull` then **stream-compacts**: visible entities are copied into packed `visible_positions` / `visible_scales` / `visible_colors` (plus `visible_ids`), reusing allocated capacity every frame. The GPU receives only the visible instances and the draw call is `pass.draw(6, visibleCount, 0, 0)` (skipped when 0).

`InstancedRenderer.renderCulled` picks the cheapest path:

| Situation | Path | Instance upload |
|-----------|------|-----------------|
| All entities visible | dirty-tracked `syncFromEntities` | dirty sub-slices only (0 bytes if unchanged) |
| Some visible | `syncFromVisibleViews` | the compacted visible set each frame (camera uniform still skipped if unchanged) |
| None visible | clear only | none, draw skipped |

When the view returns to "all visible" the renderer marks everything dirty once to resynchronize the GPU with the dense arrays.

---

## Memory Safety & Security

### Immutability Enforcement (TypeScript)
`packages/templates/src/types/readonly-buffer.types.ts` defines compile-time immutable views:

- `ReadonlyFloat32Array` / `ReadonlyUint32Array`: remove `set`, `fill`, `copyWithin`, `reverse`, `sort`, make the numeric index signature `readonly`, and narrow `subarray()` so slices stay read-only.
- `ReadonlyRawEntityViews`: `{ positions, scales, colors }`, returned by `EntityManager.getRawViews()`.
- `VisibleViews` (from `CullingManager.getVisibleViews()`) uses the same read-only types.

```ts
const { positions } = entities.getRawViews();
positions[0] = 1;          // TS error: index signature only permits reading
positions.set([1, 2, 3]);  // TS error: 'set' does not exist
```

The read-only cast back to `Float32Array` happens in exactly one place, a private helper that wraps `device.queue.writeBuffer` (WebGPU only reads the source). Raw accessors (`getRawWasmBuffer`, `getDirtyTracker`, `getRawWasmCamera`) are marked `@internal`, and a barrel test asserts that `wasm_memory`, `EntityBuffer`, `Camera`, `CullingBuffer` and similar low-level items are not exported.

> Immutability is enforced by the type system, not at runtime. Plain JavaScript can still write to the underlying memory.

### Wasm Boundary Input Sanitization (Rust)
Every exported method is written so no JS call sequence can hit a `panic!`:

- **Capacity:** `EntityBuffer::new` and `CullingBuffer::new` clamp to `[1, 4_194_304]`; growth math saturates.
- **Entity IDs:** out-of-range, stale and double-removed IDs are ignored (`remove_entity` returns `-1`, `get_dense_index` returns `None`).
- **Camera:** non-finite or out-of-range positions, targets, pans, orbit deltas and zoom factors are ignored (state is kept). Aspect ratios outside `[1e-4, 1e4]` are ignored (constructor falls back to `1.0`). Ortho zoom is clamped. `math/input_guard.rs` holds the checks.
- **Degenerate geometry:** `look_at_rh` returns a valid orthonormal basis for `eye == target` or an `up` that is zero or parallel to the view direction; `orbit_3d` and perspective zoom no-op when the eye coincides with the target.
- Every case above has a regression test in the sibling `*_tests.rs` files.

> Known limit: genuine Wasm memory exhaustion traps rather than throwing a catchable error.

---

## Code Snippets & Usage Guide

### Prerequisites

```bash
npm install
npm run build:wasm                    # wasm-pack build --target web  (needs wasm-pack)
npm run dev -w playground             # Vite demo (WebGPU-capable browser required)
```

### Initialize and create entities (`EntityManager`)

```ts
import init from "@engine/core/pkg/engine.js";
import { EntityManager } from "@engine/templates";

await init(); // load Wasm once, before constructing any manager

const entities = new EntityManager(1000); // initial capacity; grows automatically

const id = entities.createEntity({
  position: { x: 10, y: 20, z: 0 },
  scale: { x: 12, y: 12, z: 1 },
  color: "#ff8800",                   // or { r: 1, g: 0.5, b: 0 } (0..1)
});

entities.updateEntity(id, { position: { x: 15 } }); // partial update, tracked as dirty
entities.removeEntity(id);                          // unknown IDs are ignored

console.log(entities.getActiveCount());
const { positions } = entities.getRawViews();       // ReadonlyFloat32Array (read-only)
```

### Control the camera (`CameraController`)

```ts
import { CameraController } from "@engine/templates";

const camera = new CameraController({ mode: "2d", orthoHalfHeight: 100 });
camera.resize(canvas.width, canvas.height);   // updates the aspect ratio
camera.panByPixels(dx, dy, canvas.height);    // 2D drag
camera.zoom(0.9);                             // < 1 zooms in, > 1 zooms out

const orbit = new CameraController({
  mode: "3d",
  position: { x: 0, y: 5, z: 20 },
  target: { x: 0, y: 0, z: 0 },
});
orbit.orbit(0.02, -0.01);                     // azimuth, elevation (radians)
```

### Render (`InstancedRenderer`)

```ts
import {
  CameraController, CullingManager, EntityManager, GpuContext, InstancedRenderer,
} from "@engine/templates";

const canvas = document.querySelector<HTMLCanvasElement>("#render-canvas")!;
const gpu = await GpuContext.create({ canvas, clearColor: { r: 0.05, g: 0.05, b: 0.1, a: 1 } });
const renderer = new InstancedRenderer(gpu, 1000);
const culling = new CullingManager(1000);

function frame() {
  gpu.resizeToDisplaySize();
  camera.resize(canvas.width, canvas.height);

  // Option A: draw everything (dirty-tracked uploads, 0 bytes when idle)
  camera.syncIfDirty(renderer);                       // 64-byte uniform only if changed
  renderer.render(entities);

  // Option B: draw only what is inside the frustum (syncs the camera itself)
  // const drawn = renderer.renderCulled(entities, camera, culling);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Use either `render` or `renderCulled` per frame, not both.

### Testing

```bash
cd packages/engine && cargo fmt --check && cargo test && cargo clippy --all-targets -- -D warnings
npm run build:wasm
npx tsc --noEmit -p packages/templates
npm test -w @engine/templates         # unit + e2e (real Wasm, mock WebGPU device)
```

---

## Roadmap

- [x] **Stage 1 to 4:** Wasm ECS, zero-copy TypeScript layer, WebGPU instanced renderer, dirty range tracking, 2D/3D camera, Gribb-Hartmann frustum culling with stream compaction, memory-safety hardening.
- [ ] **Stage 5: Raycasting & Spatial Picking:** screen-to-world rays from the inverse `view_proj`, ray-vs-entity tests in Wasm, spatial acceleration structure, and an `EntityManager`-level picking API that returns stable `EntityId`s.
- [ ] **Stage 6: SDF Shaders & Benchmarks:** signed-distance-field shapes and text/outline rendering in WGSL, plus a reproducible benchmark suite (entity count, upload bytes per frame, culling cost, frame time).

---

## License

See [LICENSE](./LICENSE).
