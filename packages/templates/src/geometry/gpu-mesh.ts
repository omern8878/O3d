import { MeshGeometry, wasm_memory } from "@engine/core/pkg/engine.js";
import { bufferUsage } from "../renderer/gpu-flags.ts";

/** Floats per vertex: position `x, y, z` then normal `x, y, z`. */
export const FLOATS_PER_MESH_VERTEX = 6;

const DEFAULT_SPHERE_SEGMENTS = 24;
const DEFAULT_SPHERE_RINGS = 16;
const DEFAULT_CONE_SEGMENTS = 16;
const DEFAULT_DISC_SEGMENTS = 32;

/**
 * An indexed triangle mesh in VRAM, used as the base shape of an
 * {@link InstancedMesh}: interleaved position + normal vertices and `uint32`
 * indices, uploaded once.
 *
 * Built-in shapes fit the unit sphere around the origin, so an instance's
 * scale is its size. {@link GpuMesh.boundingRadius} converts an instance's
 * scale into its picking radius for any mesh.
 */
export class GpuMesh {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly vertexCount: number;
  /** Bounding-sphere radius around the origin, per unit of instance scale. */
  readonly boundingRadius: number;

  private constructor(
    device: GPUDevice,
    geometry: MeshGeometry,
    label: string,
    wasmMemoryFn: () => WebAssembly.Memory,
  ) {
    this.vertexCount = geometry.vertex_count();
    this.indexCount = geometry.index_count();
    this.boundingRadius = geometry.bounding_radius();

    const memory = wasmMemoryFn().buffer;
    const vertices = new Float32Array(
      memory,
      geometry.vertices_ptr(),
      this.vertexCount * FLOATS_PER_MESH_VERTEX,
    );
    const indices = new Uint32Array(memory, geometry.indices_ptr(), this.indexCount);

    // WebGPU rejects zero-sized vertex / index bindings, so an empty mesh
    // still gets a 4-byte buffer (it is never drawn).
    this.vertexBuffer = device.createBuffer({
      label: `${label}-vertices`,
      size: Math.max(vertices.byteLength, 4),
      usage: bufferUsage().VERTEX | bufferUsage().COPY_DST,
    });
    this.indexBuffer = device.createBuffer({
      label: `${label}-indices`,
      size: Math.max(indices.byteLength, 4),
      usage: bufferUsage().INDEX | bufferUsage().COPY_DST,
    });
    if (this.indexCount > 0) {
      device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
      device.queue.writeBuffer(this.indexBuffer, 0, indices);
    }
  }

  /** A UV sphere of radius 1 (`segments` around, `rings` pole to pole). */
  static sphere(
    device: GPUDevice,
    segments: number = DEFAULT_SPHERE_SEGMENTS,
    rings: number = DEFAULT_SPHERE_RINGS,
  ): GpuMesh {
    return GpuMesh.upload(device, MeshGeometry.sphere(segments, rings), "sphere");
  }

  /**
   * A closed cone pointing along `+Y`: apex at `(0, 0.5, 0)`, base of radius
   * `0.5` at `y = -0.5`. Rotate instances to aim it.
   */
  static cone(device: GPUDevice, segments: number = DEFAULT_CONE_SEGMENTS): GpuMesh {
    return GpuMesh.upload(device, MeshGeometry.cone(segments), "cone");
  }

  /** A flat disc of radius 1 in the XY plane, facing `+Z`. */
  static disc(device: GPUDevice, segments: number = DEFAULT_DISC_SEGMENTS): GpuMesh {
    return GpuMesh.upload(device, MeshGeometry.disc(segments), "disc");
  }

  /**
   * Any triangle mesh, e.g. parsed OBJ data: flat `x, y, z` positions and CCW
   * triangle indices (empty for a triangle soup). Smooth normals are computed;
   * triangles with invalid indices or non-finite corners are dropped.
   */
  static fromTriangles(
    device: GPUDevice,
    positions: Float32Array,
    indices: Uint32Array = new Uint32Array(0),
  ): GpuMesh {
    return GpuMesh.upload(device, MeshGeometry.from_triangles(positions, indices), "mesh");
  }

  /** Frees both GPU buffers. The mesh must not be drawn afterwards. */
  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
  }

  /** Uploads the Wasm geometry, then frees it: only the GPU copy is kept. */
  private static upload(device: GPUDevice, geometry: MeshGeometry, label: string): GpuMesh {
    try {
      return new GpuMesh(device, geometry, label, () => wasm_memory() as WebAssembly.Memory);
    } finally {
      geometry.free();
    }
  }
}
