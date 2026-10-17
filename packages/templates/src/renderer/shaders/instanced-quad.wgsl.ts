/**
 * Instanced unit-quad shader.
 *
 * Per-vertex input: the quad's local corner. Per-instance inputs: position,
 * scale and color, read from the SoA instance buffers. Positions are used as
 * clip-space coordinates directly (no camera yet); `z` is the depth.
 */
export const INSTANCED_QUAD_WGSL = /* wgsl */ `
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
  let world_xy = (local_pos * instance_scale.xy) + instance_pos.xy;

  var out: VertexOutput;
  out.clip_position = vec4<f32>(world_xy, instance_pos.z, 1.0);
  out.color = instance_color;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;
