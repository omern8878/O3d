import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { createMockGpuContext, type MockCanvasSize } from "../testing/mock-gpu-context.ts";

describe("BatchRenderer", () => {
  let BatchRenderer: typeof import("./batch-renderer.ts").BatchRenderer;
  let InstancedMesh: typeof import("../batch/instanced-mesh.ts").InstancedMesh;
  let LineBatch: typeof import("../batch/line-batch.ts").LineBatch;
  let GpuMesh: typeof import("../geometry/gpu-mesh.ts").GpuMesh;
  let CameraController: typeof import("../scene/camera-controller.ts").CameraController;

  let device: ReturnType<typeof createMockDevice>;
  let canvas: MockCanvasSize;
  let renderer: InstanceType<typeof BatchRenderer>;

  const lastPass = () => device.passes[device.passes.length - 1]!;
  const calls = (method: string) => lastPass().calls.filter((c) => c.method === method);

  before(async () => {
    installMockGpuGlobals();
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ BatchRenderer } = await import("./batch-renderer.ts"));
    ({ InstancedMesh } = await import("../batch/instanced-mesh.ts"));
    ({ LineBatch } = await import("../batch/line-batch.ts"));
    ({ GpuMesh } = await import("../geometry/gpu-mesh.ts"));
    ({ CameraController } = await import("../scene/camera-controller.ts"));
  });

  beforeEach(() => {
    device = createMockDevice();
    canvas = { width: 640, height: 480 };
    renderer = new BatchRenderer(createMockGpuContext(device, { r: 0, g: 0, b: 0, a: 1 }, canvas));
  });

  it("draws each mesh batch with one instanced, indexed call and each line batch with one draw", () => {
    const camera = new CameraController({ mode: "3d" });
    const sphere = GpuMesh.sphere(device);
    const nodes = new InstancedMesh(device, sphere, 1000);
    nodes.setCount(1000);
    const arrows = new InstancedMesh(device, GpuMesh.cone(device), 10);
    arrows.setCount(7);
    const edges = new LineBatch(device, 5000);
    edges.setCount(4321);

    const stats = renderer.render(camera, { meshes: [nodes, arrows], lines: [edges] });

    assert.deepEqual(stats, { drawCalls: 3, instances: 1007, segments: 4321 });
    assert.deepEqual(calls("draw").map((c) => c.args), [[4321 * 2]]);
    assert.deepEqual(
      calls("drawIndexed").map((c) => c.args),
      [[sphere.indexCount, 1000], [arrows.mesh.indexCount, 7]],
    );
    assert.deepEqual(calls("setIndexBuffer")[0]!.args, [sphere.indexBuffer, "uint32"]);
    const order = lastPass().calls.map((c) => c.method).filter((m) => m.startsWith("draw"));
    assert.deepEqual(order, ["draw", "drawIndexed", "drawIndexed"], "lines under the meshes");
  });

  it("builds depth-tested pipelines once per kind and shading", () => {
    const camera = new CameraController();
    const sphere = GpuMesh.sphere(device);
    const lit = new InstancedMesh(device, sphere, 2);
    const flat = new InstancedMesh(device, sphere, 2, { shading: "flat" });
    const lines = new LineBatch(device, 2);
    for (const batch of [lit, flat, lines]) batch.setCount(2);

    renderer.render(camera, { meshes: [lit, flat], lines: [lines] });
    renderer.render(camera, { meshes: [lit, flat], lines: [lines] });

    assert.equal(device.pipelines.length, 3);
    const labels = device.pipelines.map((p) => p.label).sort();
    assert.deepEqual(labels, [
      "instanced-mesh-flat-pipeline",
      "instanced-mesh-lit-pipeline",
      "line-batch-pipeline",
    ]);
    for (const pipeline of device.pipelines) {
      assert.equal(pipeline.depthStencil?.format, "depth24plus");
      assert.equal(pipeline.depthStencil?.depthWriteEnabled, true);
    }
    const flatPipeline = device.pipelines.find((p) => p.label === "instanced-mesh-flat-pipeline")!;
    assert.deepEqual(flatPipeline.fragment?.constants, { lighting: 0 });
    const linePipeline = device.pipelines.find((p) => p.label === "line-batch-pipeline")!;
    assert.equal(linePipeline.primitive?.topology, "line-list");
  });

  it("skips empty batches entirely", () => {
    const camera = new CameraController();
    const empty = new InstancedMesh(device, GpuMesh.sphere(device), 10);
    const noLines = new LineBatch(device, 10);

    const stats = renderer.render(camera, { meshes: [empty], lines: [noLines] });

    assert.equal(stats.drawCalls, 0);
    assert.equal(calls("draw").length + calls("drawIndexed").length, 0);
    assert.equal(device.pipelines.length, 0, "no pipeline built for nothing");
  });

  it("an unchanged frame uploads nothing, not even the camera", () => {
    const camera = new CameraController();
    const nodes = new InstancedMesh(device, GpuMesh.sphere(device), 10);
    nodes.setCount(10);
    renderer.render(camera, { meshes: [nodes] });
    device.writes.length = 0;

    renderer.render(camera, { meshes: [nodes] });
    assert.equal(device.writes.length, 0);

    camera.zoom(0.5);
    nodes.setPosition(4, 1, 1, 1);
    renderer.render(camera, { meshes: [nodes] });
    assert.deepEqual(device.writes.map((w) => w.data.byteLength), [64, 16]);
  });

  it("clears to a depth attachment matching the canvas, reallocated only on resize", () => {
    const camera = new CameraController();
    renderer.render(camera, {});
    renderer.render(camera, {});

    assert.equal(device.textures.length, 1);
    assert.deepEqual(device.textures[0]!.descriptor.size, { width: 640, height: 480 });
    const depth = lastPass().descriptor.depthStencilAttachment!;
    assert.equal(depth.depthLoadOp, "clear");
    assert.equal(depth.depthClearValue, 1);

    canvas.width = 1280;
    renderer.render(camera, {});
    assert.equal(device.textures.length, 2);
    assert.equal(device.textures[0]!.destroyed, true);
    assert.deepEqual(device.textures[1]!.descriptor.size, { width: 1280, height: 480 });
  });
});
