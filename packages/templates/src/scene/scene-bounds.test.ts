import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCENE_BOUNDS_FLOATS, SceneBounds } from "./scene-bounds.ts";

/** Deterministic pseudo-random sequence for the fuzz test. */
function* lcg(seed: number): Generator<number> {
  for (;;) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    yield seed / 2 ** 32;
  }
}

describe("SceneBounds", () => {
  it("starts unusable and becomes a single entity's sphere and box", () => {
    const bounds = new SceneBounds();
    assert.equal(bounds.usable, false);

    bounds.include(1, 2, 3, 0.5);

    assert.equal(bounds.usable, true);
    assert.deepEqual([...bounds.toArray()], [1, 2, 3, 0.5, 0.5, 1.5, 2.5, 1.5, 2.5, 3.5]);
  });

  it("always contains every included sphere in both its box and its sphere", () => {
    const random = lcg(7);
    const next = () => random.next().value as number;
    const bounds = new SceneBounds();
    const spheres: number[][] = [];
    for (let i = 0; i < 500; i++) {
      const sphere = [next() * 400 - 200, next() * 400 - 200, next() * 60, next() * 3];
      spheres.push(sphere);
      bounds.include(sphere[0]!, sphere[1]!, sphere[2]!, sphere[3]!);
    }

    const [cx, cy, cz, r, ...box] = bounds.toArray();
    for (const [x, y, z, radius] of spheres) {
      assert.ok(Math.hypot(x! - cx!, y! - cy!, z! - cz!) + radius! <= r! + 1e-3);
      [x, y, z].forEach((v, axis) => {
        assert.ok(v! - radius! >= box[axis]! - 1e-3 && v! + radius! <= box[3 + axis]! + 1e-3);
      });
    }
  });

  it("reports growth until an exact recompute replaces it", () => {
    const bounds = new SceneBounds();
    bounds.include(0, 0, 0, 1);
    assert.equal(bounds.grown, true);

    bounds.replace([0, 0, 0, 1, -1, -1, -1, 1, 1, 1]);
    assert.equal(bounds.grown, false);
    bounds.include(0.2, 0, 0, 0.5); // inside the sphere: no growth
    assert.equal(bounds.grown, false);
    bounds.include(5, 0, 0, 0.5);
    assert.equal(bounds.grown, true);
    assert.equal(bounds.toArray()[7], 5.5, "the box grows exactly");
  });

  it("is unusable after non-finite data until a successful recompute", () => {
    const bounds = new SceneBounds();
    bounds.include(0, 0, 0, 1);
    bounds.include(Number.NaN, 0, 0, 1);
    assert.equal(bounds.usable, false);

    bounds.replace([]); // the recompute also found nothing boundable
    assert.equal(bounds.usable, false);
    bounds.replace(new Array(SCENE_BOUNDS_FLOATS).fill(0));
    assert.equal(bounds.usable, true);
  });
});
