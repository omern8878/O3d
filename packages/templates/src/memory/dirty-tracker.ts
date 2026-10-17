export type ChannelType = "position" | "scale" | "color";

/** Inclusive interval of dirty dense indices, or `null` when nothing is dirty. */
export type DirtyRange = { min: number; max: number } | null;

const CHANNELS: readonly ChannelType[] = ["position", "scale", "color"];
const CLEAN_MIN = Infinity;
const CLEAN_MAX = -1;

/**
 * Tracks, per attribute channel, the smallest interval of dense entity indices
 * modified since the last `clear()`. Pure state: it knows nothing about Wasm or
 * the GPU.
 *
 * One interval per channel is deliberately coarse: it keeps uploads to a single
 * contiguous write per channel, at the cost of re-sending any clean entities
 * that sit between two dirty ones.
 */
export class DirtyTracker {
  private readonly min: Record<ChannelType, number> = {
    position: CLEAN_MIN,
    scale: CLEAN_MIN,
    color: CLEAN_MIN,
  };
  private readonly max: Record<ChannelType, number> = {
    position: CLEAN_MAX,
    scale: CLEAN_MAX,
    color: CLEAN_MAX,
  };

  /** Widens the channel's dirty interval to include `denseIdx`. */
  markDirty(channel: ChannelType, denseIdx: number): void {
    this.min[channel] = Math.min(this.min[channel], denseIdx);
    this.max[channel] = Math.max(this.max[channel], denseIdx);
  }

  /** Marks `denseIdx` dirty on every channel. */
  markAllChannelsDirty(denseIdx: number): void {
    for (const channel of CHANNELS) {
      this.markDirty(channel, denseIdx);
    }
  }

  /**
   * The channel's dirty interval, with `max` clamped to the last active index
   * (entities removed since being marked no longer need uploading).
   * Returns `null` if the channel is clean.
   */
  getRange(channel: ChannelType, activeCount: number): DirtyRange {
    const min = this.min[channel];
    const max = Math.min(this.max[channel], activeCount - 1);
    return min > max ? null : { min, max };
  }

  /** Marks every channel clean. Call after the GPU has been synchronized. */
  clear(): void {
    for (const channel of CHANNELS) {
      this.min[channel] = CLEAN_MIN;
      this.max[channel] = CLEAN_MAX;
    }
  }
}
