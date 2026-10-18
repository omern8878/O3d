import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";
import type {
  ReadonlyFloat32Array,
  ReadonlyUint32Array,
} from "./readonly-buffer.types.ts";

describe("read-only buffer views", () => {
  let EntityManager: typeof import("../scene/entity-manager.ts").EntityManager;
  let CullingManager: typeof import("../scene/culling-manager.ts").CullingManager;
  let CameraController: typeof import("../scene/camera-controller.ts").CameraController;

  before(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ EntityManager } = await import("../scene/entity-manager.ts"));
    ({ CullingManager } = await import("../scene/culling-manager.ts"));
    ({ CameraController } = await import("../scene/camera-controller.ts"));
  });

  it("rejects element writes to getRawViews() at compile time", () => {
    const manager = new EntityManager(4);
    manager.createEntity({ position: { x: 7, y: 8, z: 9 } });
    const views = manager.getRawViews();

    const forbiddenWrites = () => {
      // @ts-expect-error positions are read-only
      views.positions[0] = 1;
      // @ts-expect-error colors are read-only
      views.colors[0] = 1;
      // @ts-expect-error the views object itself is read-only
      views.positions = views.scales;
    };

    assert.equal(typeof forbiddenWrites, "function");
    assert.deepEqual([...views.positions], [7, 8, 9]);
  });

  it("rejects every mutating typed-array method at compile time", () => {
    const manager = new EntityManager(4);
    manager.createEntity();
    const { positions } = manager.getRawViews();

    const forbiddenCalls = () => {
      // @ts-expect-error `set` is not available
      positions.set([1, 2, 3]);
      // @ts-expect-error `fill` is not available
      positions.fill(0);
      // @ts-expect-error `copyWithin` is not available
      positions.copyWithin(0, 1);
      // @ts-expect-error `reverse` is not available
      positions.reverse();
      // @ts-expect-error `sort` is not available
      positions.sort();
    };

    assert.equal(typeof forbiddenCalls, "function");
  });

  it("keeps sub-views read-only so a slice cannot regain write access", () => {
    const manager = new EntityManager(4);
    manager.createEntity({ position: { x: 1, y: 2, z: 3 } });
    const slice: ReadonlyFloat32Array = manager.getRawViews().positions.subarray(1, 3);

    const forbiddenWrite = () => {
      // @ts-expect-error subarray results are read-only too
      slice[0] = 0;
    };

    assert.equal(typeof forbiddenWrite, "function");
    assert.deepEqual([...slice], [2, 3]);
  });

  it("keeps reading, iterating and indexing fully usable", () => {
    const manager = new EntityManager(4);
    manager.createEntity({ position: { x: 1, y: 2, z: 3 } });
    const { positions } = manager.getRawViews();

    assert.equal(positions[1], 2);
    assert.equal(positions.length, 3);
    assert.deepEqual(Array.from(positions), [1, 2, 3]);
    assert.equal(positions.reduce((sum, v) => sum + v, 0), 6);
    assert.ok(positions.buffer.byteLength > 0);
  });

  it("is still a zero-copy view of Wasm memory that sees tracked updates", () => {
    const manager = new EntityManager(4);
    const id = manager.createEntity();
    const { positions } = manager.getRawViews();

    manager.updateEntity(id, { position: { x: 5 } });

    assert.equal(positions[0], 5);
    assert.deepEqual(manager.getDirtyTracker().getRange("position", 1), { min: 0, max: 0 });
  });

  it("makes visible culling views read-only at compile time", () => {
    const manager = new EntityManager(2);
    manager.createEntity({ position: { x: 0, y: 0, z: 0 } });
    const culling = new CullingManager(2);
    culling.cullEntities(manager, new CameraController({ aspect: 1 }));
    const views = culling.getVisibleViews();

    const forbiddenWrites = () => {
      // @ts-expect-error visible positions are read-only
      views.positions[0] = 1;
      // @ts-expect-error visibleCount is read-only
      views.visibleCount = 0;
      // @ts-expect-error `set` is not available
      views.scales.set([1]);
    };

    assert.equal(typeof forbiddenWrites, "function");
    assert.equal(views.visibleCount, 1);
  });

  it("defines a read-only Uint32 view with the same restrictions", () => {
    const ids: ReadonlyUint32Array = new Uint32Array([4, 5, 6]);

    const forbiddenWrites = () => {
      // @ts-expect-error ids are read-only
      ids[0] = 0;
      // @ts-expect-error `fill` is not available
      ids.fill(1);
    };

    assert.equal(typeof forbiddenWrites, "function");
    assert.equal(ids[1], 5);
  });
});
