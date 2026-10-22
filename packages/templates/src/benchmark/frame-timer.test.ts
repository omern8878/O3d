import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { measureMedianMs } from "./frame-timer.ts";

describe("measureMedianMs", () => {
  it("runs warm-up steps first, then the measured ones, with running indices", () => {
    const seen: number[] = [];
    measureMedianMs(3, 2, (i) => seen.push(i));
    assert.deepEqual(seen, [0, 1, 2, 3, 4]);
  });

  it("returns a non-negative finite median", () => {
    const ms = measureMedianMs(5, 0, () => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    });
    assert.ok(Number.isFinite(ms) && ms >= 0);
  });

  it("returns 0 when nothing is measured", () => {
    assert.equal(measureMedianMs(0, 0, () => undefined), 0);
  });
});
