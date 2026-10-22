import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";
import { pickObjectGraph } from "./object-graph-picker.ts";
import { ObjectGraphScene } from "./object-graph-scene.ts";
import type { GeneratedPoint } from "./point-cloud-generator.ts";

const POINTS: GeneratedPoint[] = [
  { position: [0, 0, 0], scale: [2, 2, 2], color: [1, 0, 0] },
  { position: [0, 0, 5], scale: [2, 2, 2], color: [0, 1, 0] },
  { position: [30, 0, 0], scale: [2, 2, 2], color: [0, 0, 1] },
];

/** Orthographic view of x, y in [-50, 50] looking down -Z (WebGPU depth 0..1). */
const ORTHO_VIEW_PROJ = new Float32Array([
  1 / 50, 0, 0, 0,
  0, 1 / 50, 0, 0,
  0, 0, -1 / 100, 0,
  0, 0, 0.5, 1,
]);

describe("ObjectGraphScene", () => {
  before(installMockGpuGlobals);

  it("repacks every node interleaved and uploads the whole buffer each call", () => {
    const device = createMockDevice();
    const scene = new ObjectGraphScene(device, POINTS);

    assert.equal(scene.packAndUpload(), 3 * 9 * 4);
    assert.equal(scene.packAndUpload(), 3 * 9 * 4);
    assert.equal(device.writes.length, 2);
    assert.deepEqual([...device.writes[0]!.data.subarray(9, 18)], [0, 0, 5, 2, 2, 2, 0, 1, 0]);
  });

  it("uploads object mutations on the next pack", () => {
    const device = createMockDevice();
    const scene = new ObjectGraphScene(device, POINTS);
    scene.nodes[2]!.position.y = 7;

    scene.packAndUpload();

    assert.equal(device.writes[0]!.data[19], 7);
  });
});

describe("pickObjectGraph", () => {
  const nodes = new ObjectGraphScene(createMockDevice(), POINTS).nodes;

  it("returns the node nearest to the camera along the ray", () => {
    // Nodes 0 and 1 overlap on screen; node 1 (z = 5) is closer to the eye.
    assert.equal(pickObjectGraph(nodes, ORTHO_VIEW_PROJ, 0, 0), 1);
    assert.equal(pickObjectGraph(nodes, ORTHO_VIEW_PROJ, 30 / 50, 0), 2);
  });

  it("returns null for empty space or a singular matrix", () => {
    assert.equal(pickObjectGraph(nodes, ORTHO_VIEW_PROJ, -0.9, 0.9), null);
    assert.equal(pickObjectGraph(nodes, new Float32Array(16), 0, 0), null);
  });
});
