import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UploadMeter } from "./upload-meter.ts";

describe("UploadMeter", () => {
  it("starts empty", () => {
    const meter = new UploadMeter();
    assert.equal(meter.getBytes(), 0);
    assert.deepEqual(meter.getUploads(), []);
  });

  it("sums the bytes of every recorded write", () => {
    const meter = new UploadMeter();
    meter.record({ channel: "position", byteOffset: 0, byteLength: 24 });
    meter.record({ channel: "color", byteOffset: 120, byteLength: 12 });

    assert.equal(meter.getBytes(), 36);
    assert.equal(meter.getUploads().length, 2);
  });

  it("beginFrame forgets the previous frame without mutating its list", () => {
    const meter = new UploadMeter();
    meter.record({ channel: "scale", byteOffset: 0, byteLength: 12 });
    const previous = meter.getUploads();

    meter.beginFrame();

    assert.equal(meter.getBytes(), 0);
    assert.equal(previous.length, 1);
  });
});
