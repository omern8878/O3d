import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { initSync } from "@engine/core/pkg/engine.js";
import { createHeadlessGpuContext } from "./headless-gpu-context.ts";

describe("createHeadlessGpuContext", () => {
  let SceneTemplate: typeof import("../templates/scene-template.ts").SceneTemplate;

  before(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("@engine/core/pkg/engine_bg.wasm"));
    initSync({ module: readFileSync(wasmPath) });
    ({ SceneTemplate } = await import("../templates/scene-template.ts"));
  });

  it("keeps the requested clear color", () => {
    const clearColor = { r: 0.1, g: 0.2, b: 0.3, a: 1 };
    assert.deepEqual(createHeadlessGpuContext(clearColor).clearColor, clearColor);
  });

  it("runs a full SceneTemplate pipeline without a GPU or browser globals", () => {
    const scene = new SceneTemplate(createHeadlessGpuContext(), { initialCapacity: 2 });
    const a = scene.addNode([0, 0, 0], [4, 4, 1], [1, 0, 0]);
    scene.addNode([10, 0, 0], [4, 4, 1], [0, 1, 0]);
    scene.addNode([5000, 0, 0], [4, 4, 1], [0, 0, 1]);

    assert.equal(scene.renderFrame(), 2);
    assert.equal(scene.getFrameStats().uploadedBytes, 2 * 3 * 12);
    assert.equal(scene.pickNodeByNdc(0, 0), a);

    scene.renderFrame();
    assert.equal(scene.getFrameStats().uploadedBytes, 0);
    scene.destroy();
  });
});
