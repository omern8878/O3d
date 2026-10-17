/**
 * Instanced unit-quad shader.
 *
 * Per-vertex input: the quad's local corner. Per-instance inputs: position,
 * scale and color, read from the SoA instance buffers. The world position is
 * transformed by the camera's column-major `view_proj` uniform (group 0,
 * binding 0).
 */
export const INSTANCED_QUAD_WGSL = /* wgsl */ `
struct CameraUniform {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) local_pos: vec2<f32>,
  @location(1) instance_pos: vec3<f32>,
  @location(2) instance_scale: vec3<f32>,
  @location(3) instance_color: vec3<f32>,
) -> VertexOutput {
  let world_pos = vec4<f32>((local_pos * instance_scale.xy) + instance_pos.xy, instance_pos.z, 1.0);

  var out: VertexOutput;
  out.clip_position = camera.view_proj * world_pos;
  out.color = instance_color;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;
