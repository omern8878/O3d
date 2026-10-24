import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { packColor, packRgba } from "./color.utils.ts";

describe("packRgba", () => {
  it("puts red in the lowest byte, as unorm8x4 reads it", () => {
    assert.equal(packRgba(1, 0, 0, 0), 0x000000ff);
    assert.equal(packRgba(0, 1, 0, 0), 0x0000ff00);
    assert.equal(packRgba(0, 0, 1, 0), 0x00ff0000);
    assert.equal(packRgba(0, 0, 0, 1), 0xff000000);
  });

  it("matches the byte order of a little-endian Uint32Array", () => {
    const bytes = new Uint8Array(new Uint32Array([packRgba(1, 0.5, 0.25, 0.75)]).buffer);
    assert.deepEqual([...bytes], [255, 128, 64, 191]);
  });

  it("is unsigned, defaults alpha to 1 and clamps channels", () => {
    assert.equal(packRgba(1, 1, 1), 0xffffffff);
    assert.equal(packRgba(2, -1, 0.5, 9), packRgba(1, 0, 0.5, 1));
  });

  it("packColor accepts hex strings and RGB objects", () => {
    assert.equal(packColor("#ff8000"), 0xff0080ff);
    assert.equal(packColor({ r: 0, g: 0, b: 1 }, 0), 0x00ff0000);
  });
});
