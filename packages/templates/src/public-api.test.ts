import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as api from "./index.ts";

describe("public API barrel", () => {
  it("exports exactly the intended runtime surface", () => {
    assert.deepEqual(Object.keys(api).sort(), [
      "BenchmarkSuite",
      "CameraController",
      "CameraUniformBuffer",
      "CullingManager",
      "EntityManager",
      "GpuContext",
      "GpuInstanceBuffers",
      "INSTANCED_QUAD_WGSL",
      "InstancedRenderer",
      "PickingController",
      "QuadGeometry",
      "SceneTemplate",
      "createHeadlessGpuContext",
      "initEngine",
    ]);
  });

  it("does not leak raw Wasm memory or low-level Wasm structs", () => {
    for (const leaked of [
      "wasm_memory",
      "init_engine",
      "initSync",
      "EntityBuffer",
      "CullingBuffer",
      "Camera",
      "ProjectionMode",
      "DirtyTracker",
      "WasmBufferView",
    ]) {
      assert.equal(leaked in api, false, `${leaked} must not be exported`);
    }
  });
});
