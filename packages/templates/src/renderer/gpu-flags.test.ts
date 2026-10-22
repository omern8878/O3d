import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bufferUsage, shaderStage } from "./gpu-flags.ts";

describe("gpu flags", () => {
  const globals = globalThis as Record<string, unknown>;
  const saved = { usage: globals.GPUBufferUsage, stage: globals.GPUShaderStage };

  afterEach(() => {
    globals.GPUBufferUsage = saved.usage;
    globals.GPUShaderStage = saved.stage;
  });

  it("falls back to the WebGPU spec values when the globals are missing", () => {
    delete globals.GPUBufferUsage;
    delete globals.GPUShaderStage;

    assert.deepEqual(
      { ...bufferUsage() },
      { COPY_DST: 0x08, VERTEX: 0x20, UNIFORM: 0x40 },
    );
    assert.deepEqual({ ...shaderStage() }, { VERTEX: 0x1, FRAGMENT: 0x2 });
  });

  it("prefers the browser's globals when they exist", () => {
    const browserUsage = { COPY_DST: 8, VERTEX: 32, UNIFORM: 64, MAP_READ: 1 };
    globals.GPUBufferUsage = browserUsage;

    assert.equal(bufferUsage(), browserUsage);
  });
});
