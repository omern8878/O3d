import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as api from "./index.ts";

describe("public API barrel", () => {
  it("exports exactly the intended runtime surface", () => {
    assert.deepEqual(Object.keys(api).sort(), [
      "BatchRenderer",
      "BenchmarkSuite",
      "CameraController",
      "CameraUniformBuffer",
      "CullingManager",
      "EntityManager",
      "GpuContext",
      "GpuInstanceBuffers",
      "GpuMesh",
      "INSTANCED_MESH_WGSL",
      "INSTANCED_QUAD_WGSL",
      "InstancedMesh",
      "InstancedRenderer",
      "LINE_BATCH_WGSL",
      "LineBatch",
      "PickingController",
      "QuadGeometry",
      "SceneTemplate",
      "createHeadlessGpuContext",
      "cullSpheres",
      "initEngine",
      "packColor",
      "packRgba",
      "raycastSpheresNdc",
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
      "InstanceBuffer",
      "LineBuffer",
      "MeshGeometry",
      "raycast_spheres_ndc",
      "cull_spheres",
    ]) {
      assert.equal(leaked in api, false, `${leaked} must not be exported`);
    }
  });
});
