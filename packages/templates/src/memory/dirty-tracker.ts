export type ChannelType = "position" | "scale" | "color";

/** Inclusive interval of dirty dense indices, or `null` when nothing is dirty. */
export type DirtyRange = { min: number; max: number } | null;

const ENTITY_CHANNELS: readonly ChannelType[] = ["position", "scale", "color"];
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
 *
 * The channels default to the entity channels; batches pass their own names.
 */
export class DirtyTracker<C extends string = ChannelType> {
  private readonly channels: readonly C[];
  private readonly min = {} as Record<C, number>;
  private readonly max = {} as Record<C, number>;

  constructor(channels: readonly C[] = ENTITY_CHANNELS as readonly string[] as readonly C[]) {
    this.channels = channels;
    this.clear();
  }

  /** Widens the channel's dirty interval to include `denseIdx`. */
  markDirty(channel: C, denseIdx: number): void {
    this.min[channel] = Math.min(this.min[channel], denseIdx);
    this.max[channel] = Math.max(this.max[channel], denseIdx);
  }

  /** Widens the channel's dirty interval to include `first ..= last`. */
  markRangeDirty(channel: C, first: number, last: number): void {
    this.markDirty(channel, first);
    this.markDirty(channel, last);
  }

  /** Marks `denseIdx` dirty on every channel. */
  markAllChannelsDirty(denseIdx: number): void {
    for (const channel of this.channels) {
      this.markDirty(channel, denseIdx);
    }
  }

  /** Marks entities `0 .. activeCount - 1` dirty on every channel. */
  markAllDirty(activeCount: number): void {
    if (activeCount <= 0) {
      return;
    }
    this.markAllChannelsDirty(0);
    this.markAllChannelsDirty(activeCount - 1);
  }

  /**
   * The channel's dirty interval, with `max` clamped to the last active index
   * (entities removed since being marked no longer need uploading).
   * Returns `null` if the channel is clean.
   */
  getRange(channel: C, activeCount: number): DirtyRange {
    const min = this.min[channel];
    const max = Math.min(this.max[channel], activeCount - 1);
    return min > max ? null : { min, max };
  }

  /** Whether no channel has a dirty index below `activeCount`. */
  isClean(activeCount: number): boolean {
    return this.channels.every((channel) => this.getRange(channel, activeCount) === null);
  }

  /** Marks every channel clean. Call after the GPU has been synchronized. */
  clear(): void {
    for (const channel of this.channels) {
      this.min[channel] = CLEAN_MIN;
      this.max[channel] = CLEAN_MAX;
    }
  }
}
