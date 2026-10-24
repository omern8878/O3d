import type { PointCloud } from './point-cloud.types.ts'

/** A new cloud with `extra`'s points (and layers) appended after `base`'s. */
export function appendCloud(base: PointCloud, extra: PointCloud): PointCloud {
  const count = base.count + extra.count
  const join = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(count * 3)
    out.set(a.subarray(0, base.count * 3))
    out.set(b.subarray(0, extra.count * 3), base.count * 3)
    return out
  }
  return {
    count,
    positions: join(base.positions, extra.positions),
    scales: join(base.scales, extra.scales),
    colors: join(base.colors, extra.colors),
    layers: [
      ...base.layers,
      ...extra.layers.map((layer) => ({ ...layer, start: layer.start + base.count, end: layer.end + base.count })),
    ],
  }
}
