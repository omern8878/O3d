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

  it("survives NaN, Infinity and zero inputs from JS with a finite matrix", () => {
    const controller = new CameraController({ aspect: Number.NaN, mode: "3d" });
    controller.zoom(Number.NaN);
    controller.zoom(0);
    controller.orbit(Number.POSITIVE_INFINITY, Number.NaN);
    controller.setPosition(Number.NaN, 0, 0);
    controller.setTarget(0, Number.POSITIVE_INFINITY, 0);
    controller.resize(0, 0);
    controller.setPosition(1, 1, 1);
    controller.setTarget(1, 1, 1);

    const camera = controller.getRawWasmCamera();
    const m = new Float32Array((wasm_memory() as WebAssembly.Memory).buffer, camera.view_proj_ptr(), 16);
    assert.ok(m.every(Number.isFinite));
    assert.equal(camera.aspect(), 1);
  });

  it("getMode reflects the configured and switched projection", () => {
    const controller = new CameraController({ mode: "3d" });
    assert.equal(controller.getMode(), "3d");
    controller.setMode("2d");
    assert.equal(controller.getMode(), "2d");
    assert.equal(new CameraController().getMode(), "2d");
  });

  it("getViewProjection is a live, read-only view of the Wasm matrix", () => {
    const controller = new CameraController({ aspect: 1 });
    const matrix = controller.getViewProjection();
    const raw = new Float32Array(
      (wasm_memory() as WebAssembly.Memory).buffer,
      controller.getRawWasmCamera().view_proj_ptr(),
      16,
    );

    assert.equal(matrix.length, 16);
    assert.deepEqual([...matrix], [...raw]);

    controller.zoom(2);
    assert.deepEqual([...controller.getViewProjection()], [...raw]);
    const forbiddenWrite = () => {
      // @ts-expect-error the matrix is read-only
      matrix[0] = 1;
    };
    assert.equal(typeof forbiddenWrite, "function");
  });

  it("setOrthoHalfHeight sets the 2D extent absolutely and marks the camera dirty", () => {
    const controller = new CameraController({ orthoHalfHeight: 100 });
    controller.syncIfDirty(recorder());
    controller.zoom(0.5);
    const uploads = recorder();

    controller.setOrthoHalfHeight(40);

    assert.equal(controller.getRawWasmCamera().ortho_half_height(), 40);
    assert.equal(controller.syncIfDirty(uploads), true);
    controller.setOrthoHalfHeight(Number.NaN);
    assert.equal(controller.getRawWasmCamera().ortho_half_height(), 40);
  });

  const near = (a: readonly number[], b: readonly number[]) =>
    a.every((value, i) => Math.abs(value - b[i]!) < 1e-4);

  it("reports the forward vector and unprojects NDC points to rays", () => {
    const controller = new CameraController({ mode: "3d", position: { x: 0, y: 0, z: 10 } });

    assert.ok(near(controller.getForward(), [0, 0, -1]));
    const ray = controller.unprojectNdc(0, 0)!;
    assert.ok(near(ray.origin, [0, 0, 9.9]));
    assert.ok(near(ray.direction, [0, 0, -1]));
    assert.equal(controller.unprojectNdc(Number.NaN, 0), null);
  });

  it("disabling orbit freezes the view until it is re-enabled", () => {
    const controller = new CameraController({ mode: "3d" });
    controller.setOrbitEnabled(false);
    controller.orbit(1, 0.5);

    assert.equal(controller.isOrbitEnabled(), false);
    assert.ok(near(controller.getForward(), [0, 0, -1]));

    controller.setOrbitEnabled(true);
    controller.orbit(1, 0);
    assert.ok(Math.abs(controller.getForward()[0] + Math.sin(1)) < 1e-4);
  });

  it("orbit locks freeze one angle at a time", () => {
    const controller = new CameraController({ mode: "3d" });
    controller.setOrbitLocks(true, false);
    controller.orbit(1, 0.4);

    const [x, y] = controller.getForward();
    assert.ok(Math.abs(x) < 1e-5, "azimuth locked");
    assert.ok(Math.abs(y + Math.sin(0.4)) < 1e-4, "elevation free");
  });

  it("lockToXYPlane faces the plane, locks orbit, keeps zoom, and marks the camera dirty", () => {
    const controller = new CameraController({ mode: "3d", position: { x: 6, y: 8, z: 0 } });
    const renderer = recorder();
    controller.syncIfDirty(renderer);

    controller.lockToXYPlane(true);
    assert.equal(controller.syncIfDirty(renderer), true);
    assert.ok(near(controller.getForward(), [0, 0, -1]));
    assert.ok(near(controller.unprojectNdc(0, 0)!.origin, [0, 0, 9.9]), "distance 10 kept");

    controller.orbit(1, 1);
    assert.ok(near(controller.getForward(), [0, 0, -1]));
    controller.zoom(0.5);
    assert.ok(near(controller.unprojectNdc(0, 0)!.origin, [0, 0, 4.9]));

    controller.lockToXYPlane(false);
    controller.orbit(0.5, 0);
    assert.ok(Math.abs(controller.getForward()[0]) > 0.1);
  });
});
