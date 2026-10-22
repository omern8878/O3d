import { createSeededRandom } from '../../vector/seeded-random.ts'

/**
 * The set of live entity keys, with deterministic random removal. Every
 * engine owns one seeded with the dataset's churn seed, so all of them
 * despawn exactly the same keys in the same order and spawn the same new keys.
 */
export class LiveKeyPool {
  private readonly keys: number[]
  private readonly slotOf = new Map<number, number>()
  private readonly random: () => number
  private nextKey: number

  constructor(count: number, seed: number) {
    this.keys = Array.from({ length: count }, (_, key) => key)
    this.keys.forEach((key, slot) => this.slotOf.set(key, slot))
    this.random = createSeededRandom(seed)
    this.nextKey = count
  }

  get size(): number {
    return this.keys.length
  }

  /** Removes and returns a uniformly random live key. */
  takeRandom(): number {
    const slot = Math.floor(this.random() * this.keys.length)
    const key = this.keys[slot]!
    const last = this.keys.pop()!
    if (slot < this.keys.length) {
      this.keys[slot] = last
      this.slotOf.set(last, slot)
    }
    this.slotOf.delete(key)
    return key
  }

  /** Registers and returns a brand-new key for a spawned entity. */
  spawnKey(): number {
    const key = this.nextKey++
    this.slotOf.set(key, this.keys.length)
    this.keys.push(key)
    return key
  }
}
