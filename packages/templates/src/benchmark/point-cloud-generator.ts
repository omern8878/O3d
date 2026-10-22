import type { Vec3Tuple } from "../types/entity.types.ts";
import { createSeededRandom } from "./seeded-random.ts";

/** Radius of the ball the benchmark points fill, in world units. */
export const POINT_CLOUD_RADIUS = 100;
const POINT_SCALE = 1.5;

/** One generated point: position, size and color. */
export type GeneratedPoint = {
  position: Vec3Tuple;
  scale: Vec3Tuple;
  color: Vec3Tuple;
};

/**
 * `count` points spread uniformly through a ball of radius
 * {@link POINT_CLOUD_RADIUS} around the origin, with random colors.
 * The same `seed` always yields the same points.
 */
export function generatePointCloud(count: number, seed: number): GeneratedPoint[] {
  const random = createSeededRandom(seed);
  const points: GeneratedPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      position: randomPointInBall(random),
      scale: [POINT_SCALE, POINT_SCALE, POINT_SCALE],
      color: [random(), random(), random()],
    });
  }
  return points;
}

/** Rejection-samples the unit cube until a point lands inside the ball. */
function randomPointInBall(random: () => number): Vec3Tuple {
  for (;;) {
    const x = random() * 2 - 1;
    const y = random() * 2 - 1;
    const z = random() * 2 - 1;
    if (x * x + y * y + z * z <= 1) {
      return [x * POINT_CLOUD_RADIUS, y * POINT_CLOUD_RADIUS, z * POINT_CLOUD_RADIUS];
    }
  }
}
