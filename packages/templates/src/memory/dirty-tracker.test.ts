import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DirtyTracker } from "./dirty-tracker.ts";

describe("DirtyTracker", () => {
  it("starts clean on every channel", () => {
    const tracker = new DirtyTracker();

    for (const channel of ["position", "scale", "color"] as const) {
      assert.equal(tracker.getRange(channel, 10), null);
    }
  });

  it("expands the interval to cover every marked index", () => {
    const tracker = new DirtyTracker();
    tracker.markDirty("position", 4);
    tracker.markDirty("position", 2);
    tracker.markDirty("position", 7);

    assert.deepEqual(tracker.getRange("position", 10), { min: 2, max: 7 });
  });

  it("tracks channels independently", () => {
    const tracker = new DirtyTracker();
    tracker.markDirty("color", 1);

    assert.deepEqual(tracker.getRange("color", 3), { min: 1, max: 1 });
    assert.equal(tracker.getRange("position", 3), null);
    assert.equal(tracker.getRange("scale", 3), null);
  });

  it("markAllChannelsDirty marks the index on all channels", () => {
    const tracker = new DirtyTracker();
    tracker.markAllChannelsDirty(3);

    for (const channel of ["position", "scale", "color"] as const) {
      assert.deepEqual(tracker.getRange(channel, 5), { min: 3, max: 3 });
    }
  });

  it("clamps max to the last active index", () => {
    const tracker = new DirtyTracker();
    tracker.markDirty("scale", 2);
    tracker.markDirty("scale", 9);

    assert.deepEqual(tracker.getRange("scale", 5), { min: 2, max: 4 });
  });

  it("returns null when every dirty index is past the active range", () => {
    const tracker = new DirtyTracker();
    tracker.markDirty("scale", 5);

    assert.equal(tracker.getRange("scale", 3), null);
    assert.equal(tracker.getRange("scale", 0), null);
  });

  it("clear() resets all channels", () => {
    const tracker = new DirtyTracker();
    tracker.markAllChannelsDirty(1);
    tracker.clear();

    for (const channel of ["position", "scale", "color"] as const) {
      assert.equal(tracker.getRange(channel, 5), null);
    }
  });

  it("markAllDirty covers entities 0 .. activeCount - 1 on every channel", () => {
    const tracker = new DirtyTracker();
    tracker.markAllDirty(5);

    for (const channel of ["position", "scale", "color"] as const) {
      assert.deepEqual(tracker.getRange(channel, 5), { min: 0, max: 4 });
    }
  });

  it("markAllDirty does nothing when there are no entities", () => {
    const tracker = new DirtyTracker();
    tracker.markAllDirty(0);

    assert.equal(tracker.getRange("position", 10), null);
  });

  it("isClean is true only while no channel has an active dirty index", () => {
    const tracker = new DirtyTracker();
    assert.equal(tracker.isClean(10), true);

    tracker.markDirty("color", 4);
    assert.equal(tracker.isClean(10), false);
    // Index 4 no longer exists once only 3 entities remain.
    assert.equal(tracker.isClean(3), true);

    tracker.clear();
    assert.equal(tracker.isClean(10), true);
  });
});
