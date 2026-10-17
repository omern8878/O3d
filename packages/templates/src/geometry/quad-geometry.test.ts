import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createMockDevice, installMockGpuGlobals } from "../testing/mock-gpu.ts";

describe("QuadGeometry", () => {
  let QuadGeometry: typeof import("./quad-geometry.ts").QuadGeometry;

  before(async () => {
    installMockGpuGlobals();
    ({ QuadGeometry } = await import("./quad-geometry.ts"));
  });

  it("uploads 6 unit-quad vertices once as a VERTEX | COPY_DST buffer", () => {
    const device = createMockDevice();
    const quad = new QuadGeometry(device);

    assert.equal(quad.vertexCount, 6);
    assert.equal(device.buffers.length, 1);
    assert.equal(device.buffers[0]!.size, 12 * 4);
    assert.equal(device.buffers[0]!.usage, 0x20 | 0x08);

    assert.equal(device.writes.length, 1);
    const { data, offset } = device.writes[0]!;
    assert.equal(offset, 0);
    assert.equal(data.length, 12);
    assert.ok(data.every((value) => Math.abs(value) === 0.5));
    // Two triangles must cover all four corners.
    const corners = new Set<string>();
    for (let i = 0; i < 12; i += 2) corners.add(`${data[i]},${data[i + 1]}`);
    assert.equal(corners.size, 4);
  });

  it("destroy() frees the vertex buffer", () => {
    const device = createMockDevice();
    new QuadGeometry(device).destroy();

    assert.equal(device.buffers[0]!.destroyed, true);
  });
});
