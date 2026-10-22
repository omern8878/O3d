import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePointCloud, POINT_CLOUD_RADIUS } from "./point-cloud-generator.ts";
import { createSeededRandom } from "./seeded-random.ts";

describe("generatePointCloud", () => {
  it("is reproducible for a seed and differs across seeds", () => {
    assert.deepEqual(generatePointCloud(50, 7), generatePointCloud(50, 7));
    assert.notDeepEqual(generatePointCloud(50, 7), generatePointCloud(50, 8));
  });

  it("places every point inside the ball with colors in 0..1", () => {
    for (const { position, color } of generatePointCloud(500, 3)) {
      assert.ok(Math.hypot(...position) <= POINT_CLOUD_RADIUS + 1e-9);
      assert.ok(color.every((c) => c >= 0 && c < 1));
    }
  });
});

describe("createSeededRandom", () => {
  it("returns values in [0, 1)", () => {
    const random = createSeededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      assert.ok(value >= 0 && value < 1);
    }
  });
});
