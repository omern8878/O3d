/**
 * Instanced unit-quad shader with procedural shapes.
 *
 * Per-vertex input: the quad's local corner. Per-instance inputs: position,
 * scale and color, read from the SoA instance buffers. The instance center is
 * transformed by the camera's column-major `view_proj` uniform (group 0,
 * binding 0).
 *
 * Quads are billboards: the corner offset is applied in view space, so every
 * instance faces the camera however it orbits (matching the sphere bounds
 * used by culling and picking). For a rigid view and a standard projection,
 * a view-space offset `(dx, dy, 0)` moves clip space by
 * `(|row0(view_proj)| * dx, |row1(view_proj)| * dy)` and leaves `w` alone, so
 * the offset is added straight to the clip position. A front-on 2D view
 * produces exactly the same quads as world-aligned ones.
 *
 * The fragment stage draws one of two shapes, chosen by the pipeline-overridable
 * constant `shape_mode` (resolved when the pipeline is created, so there is no
 * per-fragment cost for the unused branch):
 *
 * - `0u`: a crisp quad, filling the whole instance.
 * - `1u`: an SDF disc inscribed in the quad. Coverage is anti-aliased
 *   analytically from the screen-space derivative of the distance field, so
 *   edges stay smooth at any zoom with no extra geometry. The output is
 *   premultiplied, so the pipeline must blend with `one / one-minus-src-alpha`.
 */
export const INSTANCED_QUAD_WGSL = /* wgsl */ `
struct CameraUniform {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

override shape_mode: u32 = 0u;

const SHAPE_CIRCLE: u32 = 1u;
const MIN_EDGE_WIDTH: f32 = 0.0001;

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) local_uv: vec2<f32>,
};

@vertex
fn vs_main(
  @location(0) local_pos: vec2<f32>,
  @location(1) instance_pos: vec3<f32>,
  @location(2) instance_scale: vec3<f32>,
  @location(3) instance_color: vec3<f32>,
) -> VertexOutput {
  let m = camera.view_proj;
  // Clip-space units per view-space unit along the screen's x and y axes.
  let axis_scale = vec2<f32>(
    length(vec3<f32>(m[0].x, m[1].x, m[2].x)),
    length(vec3<f32>(m[0].y, m[1].y, m[2].y)),
  );
  let center = m * vec4<f32>(instance_pos, 1.0);

  var out: VertexOutput;
  out.clip_position = vec4<f32>(
    center.xy + local_pos * instance_scale.xy * axis_scale,
    center.zw,
  );
  out.color = instance_color;
  // The quad spans [-0.5, 0.5]; doubling gives [-1, 1] across each instance.
  out.local_uv = local_pos * 2.0;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  if (shape_mode == SHAPE_CIRCLE) {
    let dist = length(in.local_uv);
    // Derivatives must be taken before any discard (uniform control flow).
    let edge = max(fwidth(dist), MIN_EDGE_WIDTH);
    if (dist > 1.0) {
      discard;
    }
    let alpha = 1.0 - smoothstep(1.0 - edge, 1.0, dist);
    return vec4<f32>(in.color * alpha, alpha);
  }

  return vec4<f32>(in.color, 1.0);
}
`;
