import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync, wasm_memory } from "@engine/core/pkg/engine.js";

describe("CameraController", () => {
  let CameraController: typeof import("./camera-controller.ts").CameraController;

  before(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ CameraController } = await import("./camera-controller.ts"));
  });

  const recorder = () => {
    const uploads: unknown[] = [];
    return { uploads, updateCamera: (camera: unknown) => void uploads.push(camera) };
  };

  /** World point -> normalized device coordinates, read from the Wasm matrix. */
  function toClip(controller: InstanceType<typeof CameraController>, [x, y, z]: number[]) {
    const camera = controller.getRawWasmCamera();
    const m = new Float32Array((wasm_memory() as WebAssembly.Memory).buffer, camera.view_proj_ptr(), 16);
    const w = m[3]! * x! + m[7]! * y! + m[11]! * z! + m[15]!;
    return [
      (m[0]! * x! + m[4]! * y! + m[8]! * z! + m[12]!) / w,
      (m[1]! * x! + m[5]! * y! + m[9]! * z! + m[13]!) / w,
    ] as [number, number];
  }
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-5;

  it("starts dirty, uploads once, then reports clean", () => {
    const controller = new CameraController();
    const renderer = recorder();

    assert.equal(controller.syncIfDirty(renderer), true);
    assert.equal(controller.syncIfDirty(renderer), false);
    assert.equal(controller.syncIfDirty(renderer), false);
    assert.equal(renderer.uploads.length, 1);
    assert.equal(renderer.uploads[0], controller.getRawWasmCamera());
  });

  const mutators: [string, (c: InstanceType<typeof CameraController>) => void][] = [
    ["setMode", (c) => c.setMode("3d")],
    ["resize", (c) => c.resize(800, 600)],
    ["panByPixels", (c) => c.panByPixels(5, 5, 600)],
    ["orbit", (c) => c.orbit(0.1, 0.1)],
    ["zoom", (c) => c.zoom(0.9)],
    ["setPosition", (c) => c.setPosition(1, 2, 3)],
    ["setTarget", (c) => c.setTarget(1, 2, 3)],
  ];
  for (const [name, mutate] of mutators) {
    it(`${name}() marks the camera dirty again`, () => {
      const controller = new CameraController();
      const renderer = recorder();
      controller.syncIfDirty(renderer);

      mutate(controller);

      assert.equal(controller.syncIfDirty(renderer), true);
      assert.equal(renderer.uploads.length, 2);
    });
  }

  it("applies the initial config", () => {
    const controller = new CameraController({
      aspect: 2,
      orthoHalfHeight: 50,
      position: { x: 5, y: 0, z: 10 },
      target: { x: 5, y: 0, z: 0 },
    });
    const camera = controller.getRawWasmCamera();

    assert.equal(camera.aspect(), 2);
    assert.equal(camera.ortho_half_height(), 50);
    const [cx, cy] = toClip(controller, [5, 0, 0]);
    assert.ok(close(cx, 0) && close(cy, 0));
  });

  it("resize() computes width / height and guards against a zero height", () => {
    const controller = new CameraController();

    controller.resize(800, 400);
    assert.equal(controller.getRawWasmCamera().aspect(), 2);

    controller.resize(300, 0);
    assert.equal(controller.getRawWasmCamera().aspect(), 300);
  });

  it("panByPixels converts pixels to world units using the ortho zoom", () => {
    // half height 100 over a 200px viewport -> 1 world unit per pixel.
    const controller = new CameraController({ aspect: 1 });

    controller.panByPixels(10, 0, 200);
    // The camera moved 10 units left, so the world origin appears 10 units right: 10 / 100 in NDC.
    const [x, y] = toClip(controller, [0, 0, 0]);
    assert.ok(close(x, 0.1), `x was ${x}`);
    assert.ok(close(y, 0));
  });

  it("panByPixels makes the world follow the cursor on both axes", () => {
    const controller = new CameraController({ aspect: 1 });

    controller.panByPixels(20, 10, 200); // drag right 20px, down 10px
    const [x, y] = toClip(controller, [0, 0, 0]);

    assert.ok(close(x, 0.2), `x was ${x}`); // moved right
    assert.ok(close(y, -0.1), `y was ${y}`); // moved down (screen y is flipped)
  });

  it("panByPixels scales with zoom level", () => {
    const controller = new CameraController({ aspect: 1, orthoHalfHeight: 50 });

    controller.panByPixels(10, 0, 200); // 0.5 world units per pixel -> 5 units
    const [x] = toClip(controller, [0, 0, 0]);

    assert.ok(close(x, 5 / 50), `x was ${x}`);
  });

  it("panByPixels tolerates a zero-height viewport", () => {
    const controller = new CameraController();

    controller.panByPixels(1, 1, 0);

    const [x, y] = toClip(controller, [0, 0, 0]);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  });

  it("zoom() zooms the 2D camera and orbit() keeps the 3D target centered", () => {
    const controller = new CameraController({ mode: "3d" });
    controller.orbit(0.8, 0.4);
    const [x, y] = toClip(controller, [0, 0, 0]);
    assert.ok(close(x, 0) && close(y, 0));

    const flat = new CameraController();
    flat.zoom(0.5);
    assert.equal(flat.getRawWasmCamera().ortho_half_height(), 50);
  });
});
