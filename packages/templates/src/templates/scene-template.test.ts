import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { createMockGpuContext } from "../testing/mock-gpu-context.ts";
import type { SceneTemplateConfig } from "../types/scene-template.types.ts";

const CLEAR_COLOR = { r: 0, g: 0, b: 0, a: 1 };

describe("SceneTemplate", () => {
  let SceneTemplate: typeof import("./scene-template.ts").SceneTemplate;

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ SceneTemplate } = await import("./scene-template.ts"));
  });

  function createScene(config: SceneTemplateConfig = {}) {
    const device = createMockDevice();
    const scene = new SceneTemplate(createMockGpuContext(device, CLEAR_COLOR), config);
    return { scene, device };
  }

  const draws = (device: ReturnType<typeof createMockDevice>) =>
    device.passes.flatMap((pass) => pass.calls.filter((c) => c.method === "draw"));
  const lastPass = (device: ReturnType<typeof createMockDevice>) =>
    device.passes[device.passes.length - 1]!;
  const pipelineConstants = (device: ReturnType<typeof createMockDevice>) =>
    device.pipelines[0]!.fragment!.constants;

  describe("configuration", () => {
    it("defaults to circle shapes, an orthographic camera and culling", () => {
      const { scene, device } = createScene();

      assert.deepEqual(pipelineConstants(device), { shape_mode: 1 });
      assert.equal(scene.getCameraController().getRawWasmCamera().ortho_half_height(), 100);

      // Culling on: a far-away node is not drawn.
      scene.addNode([0, 0, 0], [10, 10, 1], [1, 0, 0]);
      scene.addNode([5000, 0, 0], [10, 10, 1], [1, 0, 0]);
      assert.equal(scene.renderFrame(), 1);
    });

    it("shapeMode 'quad' selects the crisp quad pipeline", () => {
      const { device } = createScene({ shapeMode: "quad" });

      assert.deepEqual(pipelineConstants(device), { shape_mode: 0 });
    });

    it("initialCapacity sizes the GPU instance buffers", () => {
      const { device } = createScene({ initialCapacity: 7 });

      const instanceBuffers = device.buffers.filter((b) => b.size === 7 * 12);
      assert.equal(instanceBuffers.length, 3);
    });

    it("cameraMode selects the camera projection", () => {
      const clipW = (config: SceneTemplateConfig) => {
        const camera = createScene(config).scene.getCameraController().getRawWasmCamera();
        const matrix = new Float32Array(
          (wasm_memory() as WebAssembly.Memory).buffer,
          camera.view_proj_ptr(),
          16,
        );
        return matrix[11];
      };

      // Perspective projections write -z into w (m[11] = -1); orthographic ones do not.
      assert.equal(clipW({ cameraMode: "perspective3d" }), -1);
      assert.equal(clipW({ cameraMode: "ortho2d" }), 0);
      assert.equal(clipW({}), 0);
    });
  });

  describe("nodes", () => {
    it("adds nodes with stable ids and reports the active count", () => {
      const { scene } = createScene();

      const a = scene.addNode([0, 0, 0], [1, 1, 1], [1, 0, 0]);
      const b = scene.addNode([1, 2, 3], [4, 5, 6], [0, 1, 0]);

      assert.notEqual(a, b);
      assert.equal(scene.getActiveCount(), 2);
    });

    it("updates position, scale and color, uploading only the changed channel", () => {
      const { scene, device } = createScene({ enableCulling: false });
      const id = scene.addNode([0, 0, 0], [1, 1, 1], [1, 0, 0]);
      scene.renderFrame();
      const writesBefore = device.writes.length;

      scene.updateNodePosition(id, [3, 4, 5]);
      scene.renderFrame();
      assert.equal(device.writes.length - writesBefore, 1);
      assert.deepEqual([...device.writes.at(-1)!.data], [3, 4, 5]);

      scene.updateNodeScale(id, [7, 8, 9]);
      scene.renderFrame();
      assert.deepEqual([...device.writes.at(-1)!.data], [7, 8, 9]);

      scene.updateNodeColor(id, [0.25, 0.5, 0.75]);
      scene.renderFrame();
      assert.deepEqual([...device.writes.at(-1)!.data], [0.25, 0.5, 0.75]);
      assert.equal(device.writes.length - writesBefore, 3);
    });

    it("ignores updates to unknown ids", () => {
      const { scene, device } = createScene({ enableCulling: false });
      scene.addNode([0, 0, 0], [1, 1, 1], [1, 0, 0]);
      scene.renderFrame();
      const writes = device.writes.length;

      scene.updateNodePosition(999, [1, 1, 1]);
      scene.updateNodeScale(999, [1, 1, 1]);
      scene.updateNodeColor(999, [1, 1, 1]);
      scene.renderFrame();

      assert.equal(device.writes.length, writes);
    });

    it("removeNode reports whether the node existed", () => {
      const { scene } = createScene();
      const id = scene.addNode([0, 0, 0], [1, 1, 1], [1, 0, 0]);

      assert.equal(scene.removeNode(id), true);
      assert.equal(scene.removeNode(id), false);
      assert.equal(scene.removeNode(12345), false);
      assert.equal(scene.getActiveCount(), 0);
    });
  });

  describe("renderFrame", () => {
    it("draws every node in one call when culling is disabled", () => {
      const { scene, device } = createScene({ enableCulling: false });
      scene.addNode([0, 0, 0], [10, 10, 1], [1, 0, 0]);
      scene.addNode([5000, 0, 0], [10, 10, 1], [1, 0, 0]);

      assert.equal(scene.renderFrame(), 2);
      assert.deepEqual(draws(device), [{ method: "draw", args: [6, 2, 0, 0] }]);
    });

    it("draws only nodes inside the frustum when culling is enabled", () => {
      const { scene, device } = createScene({ enableCulling: true });
      for (let i = 0; i < 10; i++) {
        scene.addNode([i < 4 ? i * 10 : 5000 + i, 0, 0], [10, 10, 1], [1, 1, 1]);
      }

      assert.equal(scene.renderFrame(), 4);
      assert.deepEqual(draws(device), [{ method: "draw", args: [6, 4, 0, 0] }]);
    });

    it("uploads the camera on the first frame only, then stays idle", () => {
      const { scene, device } = createScene({ enableCulling: false });
      scene.addNode([0, 0, 0], [10, 10, 1], [1, 0, 0]);
      scene.renderFrame();
      const writes = device.writes.length;

      scene.renderFrame();

      assert.equal(device.writes.length, writes, "an unchanged scene uploads 0 bytes");
      assert.equal(draws(device).length, 2);
    });

    it("uploads the camera again after the camera moves", () => {
      for (const enableCulling of [false, true]) {
        const { scene, device } = createScene({ enableCulling });
        scene.addNode([0, 0, 0], [10, 10, 1], [1, 0, 0]);
        scene.renderFrame();
        const writes = device.writes.length;

        scene.getCameraController().zoom(0.5);
        scene.renderFrame();

        assert.equal(device.writes.length - writes, 1, `enableCulling=${enableCulling}`);
        assert.equal(device.writes.at(-1)!.data.length, 16);
      }
    });

    it("draws nothing for an empty scene", () => {
      const { scene, device } = createScene();

      assert.equal(scene.renderFrame(), 0);
      assert.deepEqual(draws(device), []);
      assert.deepEqual(lastPass(device).calls.map((c) => c.method), ["end"]);
    });

    it("keeps working after nodes are removed", () => {
      const { scene } = createScene({ enableCulling: false });
      const ids = [0, 1, 2].map((i) => scene.addNode([i, 0, 0], [1, 1, 1], [1, 0, 0]));
      scene.renderFrame();

      scene.removeNode(ids[0]!);

      assert.equal(scene.renderFrame(), 2);
    });
  });

  describe("picking", () => {
    function createPickScene() {
      const { scene } = createScene();
      const left = scene.addNode([-50, 0, 0], [10, 10, 1], [1, 0, 0]);
      const right = scene.addNode([50, 50, 0], [10, 10, 1], [0, 1, 0]);
      return { scene, left, right };
    }

    it("pickNodeByNdc finds the node under the point", () => {
      const { scene, left, right } = createPickScene();

      assert.equal(scene.pickNodeByNdc(-0.5, 0), left);
      assert.equal(scene.pickNodeByNdc(0.5, 0.5), right);
      assert.equal(scene.pickNodeByNdc(0, 0), null);
    });

    it("pickNodeAtScreen converts pixels to NDC with the Y axis flipped", () => {
      const { scene, right } = createPickScene();
      const rect = { left: 10, top: 10, width: 200, height: 200 };

      // (0.5, 0.5) in NDC is right of center and above it on screen.
      assert.equal(scene.pickNodeAtScreen(10 + 150, 10 + 50, rect), right);
      assert.equal(scene.pickNodeAtScreen(10 + 150, 10 + 150, rect), null);
    });

    it("picks by stable id after a removal reorders storage", () => {
      const { scene, left, right } = createPickScene();

      assert.equal(scene.removeNode(left), true);

      assert.equal(scene.pickNodeByNdc(0.5, 0.5), right);
      assert.equal(scene.pickNodeByNdc(-0.5, 0), null);
    });
  });

  it("destroy() frees the GPU buffers", () => {
    const { scene, device } = createScene();

    scene.destroy();

    assert.ok(device.buffers.every((buffer) => buffer.destroyed));
  });
});
