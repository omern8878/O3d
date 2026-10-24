import type { PointCloud, PointLayer } from '../cloud/point-cloud.types.ts'

/** Mean position of a layer's points. */
export function layerCentroid(cloud: PointCloud, layer: PointLayer): [number, number, number] {
  const sum = [0, 0, 0]
  for (let i = layer.start; i < layer.end; i++) {
    for (let axis = 0; axis < 3; axis++) sum[axis]! += cloud.positions[i * 3 + axis]!
  }
  const n = Math.max(layer.end - layer.start, 1)
  return [sum[0]! / n, sum[1]! / n, sum[2]! / n]
}
