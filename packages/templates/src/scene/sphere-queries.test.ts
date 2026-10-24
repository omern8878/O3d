import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";

describe("sphere queries", () => {
  let queries: typeof import("./sphere-queries.ts");
  let CameraController: typeof import("./camera-controller.ts").CameraController;

  before(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    queries = await import("./sphere-queries.ts");
    ({ CameraController } = await import("./camera-controller.ts"));
  });

  const spheres = new Float32Array([-50, 0, 0, 5, 50, 0, 0, 5, 900, 0, 0, 5]);

  it("raycasts a flat [x, y, z, r] array", () => {
    const camera = new CameraController(); // 2D, NDC 0.5 is world x = 50
    assert.equal(queries.raycastSpheresNdc(camera, 0.5, 0, spheres), 1);
    assert.equal(queries.raycastSpheresNdc(camera, -0.5, 0, spheres), 0);
    assert.equal(queries.raycastSpheresNdc(camera, 0, 0.5, spheres), -1);
  });

  it("culls a flat [x, y, z, r] array against the frustum", () => {
    const camera = new CameraController();
    assert.deepEqual([...queries.cullSpheres(camera, spheres)], [0, 1]);
  });
});
