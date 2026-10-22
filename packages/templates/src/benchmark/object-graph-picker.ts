import type { ReadonlyFloat32Array } from "../types/readonly-buffer.types.ts";
import type { ObjectGraphNode } from "./object-graph-scene.ts";

type Vec3 = [number, number, number];

/** Same pick sphere as the engine: half the largest scale component. */
const PICK_RADIUS_PER_SCALE = 0.5;

/**
 * The baseline's picker: unprojects the pointer through a JS-inverted
 * view-projection matrix and ray-tests every node object, nearest hit wins.
 * It mirrors the engine's rules (WebGPU `[0, 1]` depth, sphere radius) so the
 * two can be checked against each other.
 */
export function pickObjectGraph(
  nodes: readonly ObjectGraphNode[],
  viewProj: ReadonlyFloat32Array,
  ndcX: number,
  ndcY: number,
): number | null {
  const inverse = invertColumnMajor(viewProj);
  if (!inverse) {
    return null;
  }
  const near = unproject(inverse, ndcX, ndcY, 0);
  const far = unproject(inverse, ndcX, ndcY, 1);
  const direction = normalize([far[0] - near[0], far[1] - near[1], far[2] - near[2]]);

  let bestId: number | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const radius =
      PICK_RADIUS_PER_SCALE *
      Math.max(Math.abs(node.scale.x), Math.abs(node.scale.y), Math.abs(node.scale.z));
    const distance = intersectSphere(near, direction, node.position, radius);
    if (distance !== null && distance < bestDistance) {
      bestDistance = distance;
      bestId = node.id;
    }
  }
  return bestId;
}

function intersectSphere(
  origin: Vec3,
  direction: Vec3,
  center: { x: number; y: number; z: number },
  radius: number,
): number | null {
  const ox = origin[0] - center.x;
  const oy = origin[1] - center.y;
  const oz = origin[2] - center.z;
  const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) {
    return null;
  }
  const root = Math.sqrt(discriminant);
  if (-b - root >= 0) return -b - root;
  if (-b + root >= 0) return -b + root;
  return null;
}

function unproject(m: Float64Array, x: number, y: number, z: number): Vec3 {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ];
}

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/** Cofactor inverse of a column-major 4x4 matrix, or `null` if singular. */
function invertColumnMajor(src: ReadonlyFloat32Array): Float64Array | null {
  const a = Array.from(src);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] =
    a as [number, number, number, number, number, number, number, number,
      number, number, number, number, number, number, number, number];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(det) || det === 0) {
    return null;
  }
  const inv = 1 / det;
  return Float64Array.of(
    (a11 * b11 - a12 * b10 + a13 * b09) * inv,
    (a02 * b10 - a01 * b11 - a03 * b09) * inv,
    (a31 * b05 - a32 * b04 + a33 * b03) * inv,
    (a22 * b04 - a21 * b05 - a23 * b03) * inv,
    (a12 * b08 - a10 * b11 - a13 * b07) * inv,
    (a00 * b11 - a02 * b08 + a03 * b07) * inv,
    (a32 * b02 - a30 * b05 - a33 * b01) * inv,
    (a20 * b05 - a22 * b02 + a23 * b01) * inv,
    (a10 * b10 - a11 * b08 + a13 * b06) * inv,
    (a01 * b08 - a00 * b10 - a03 * b06) * inv,
    (a30 * b04 - a31 * b02 + a33 * b00) * inv,
    (a21 * b02 - a20 * b04 - a23 * b00) * inv,
    (a11 * b07 - a10 * b09 - a12 * b06) * inv,
    (a00 * b09 - a01 * b07 + a02 * b06) * inv,
    (a31 * b01 - a30 * b03 - a32 * b00) * inv,
    (a20 * b03 - a21 * b01 + a22 * b00) * inv,
  );
}
