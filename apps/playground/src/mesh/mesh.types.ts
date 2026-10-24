/** A named run of triangles (an OBJ `o` / `g` / `usemtl` section). */
export type MeshGroup = {
  name: string
  /** First triangle (inclusive). */
  start: number
  /** One past the last triangle. */
  end: number
}

/** A triangulated mesh as parsed from a Wavefront OBJ file. */
export type ObjMesh = {
  /** `x, y, z` per vertex. */
  positions: Float32Array
  /** `r, g, b` per vertex when every `v` line carried a colour, else `null`. */
  vertexColors: Float32Array | null
  /** Three vertex indices per triangle, grouped so each group is contiguous. */
  triangles: Uint32Array
  /**
   * Nine floats (three `vn` normals) per triangle when every corner of every
   * face referenced a normal, else `null` (face normals are used instead).
   */
  cornerNormals: Float32Array | null
  groups: MeshGroup[]
  /** Lines that were malformed or referenced missing data, and were skipped. */
  skippedLines: number
}
