/**
 * Shaders of the {@link BatchRenderer}. Both read the camera's column-major
 * `view_proj` uniform (group 0, binding 0) and output premultiplied alpha.
 *
 * Instanced mesh: per-vertex position and normal; per-instance transform
 * `[x, y, z, uniform_scale]`, unit-quaternion rotation and `unorm8x4` color.
 * A vertex is scaled, rotated, then translated. The pipeline-overridable
 * constant `lighting` picks the shading when the pipeline is created:
 *
 * - `1u`: a fixed world-space directional light plus ambient. Faces seen from
 *   behind use the flipped normal, so open or inconsistently wound meshes
 *   still shade sensibly.
 * - `0u`: the instance color, unshaded.
 *
 * Line batch: per-vertex position and `unorm8x4` color, drawn as a line list.
 */
export const INSTANCED_MESH_WGSL = /* wgsl */ `
struct CameraUniform {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

override lighting: u32 = 1u;

// normalize(vec3(2, 4, 3)): from the upper right, in front of the XY plane.
const LIGHT_DIRECTION = vec3<f32>(0.37139068, 0.74278135, 0.55708601);
const AMBIENT: f32 = 0.35;

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) normal: vec3<f32>,
};

/** Rotates v by the unit quaternion q. */
fn rotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

@vertex
fn vs_main(
  @location(0) local_position: vec3<f32>,
  @location(1) local_normal: vec3<f32>,
  @location(2) transform: vec4<f32>,
  @location(3) rotation: vec4<f32>,
  @location(4) color: vec4<f32>,
) -> VertexOutput {
  let world = rotate(rotation, local_position * transform.w) + transform.xyz;

  var out: VertexOutput;
  out.clip_position = camera.view_proj * vec4<f32>(world, 1.0);
  out.color = color;
  out.normal = rotate(rotation, local_normal);
  return out;
}

@fragment
fn fs_main(in: VertexOutput, @builtin(front_facing) front_facing: bool) -> @location(0) vec4<f32> {
  var shade = 1.0;
  if (lighting == 1u) {
    var normal = normalize(in.normal);
    if (!front_facing) {
      normal = -normal;
    }
    shade = AMBIENT + (1.0 - AMBIENT) * max(dot(normal, LIGHT_DIRECTION), 0.0);
  }
  return vec4<f32>(in.color.rgb * shade * in.color.a, in.color.a);
}
`;

export const LINE_BATCH_WGSL = /* wgsl */ `
struct CameraUniform {
  view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(@location(0) position: vec3<f32>, @location(1) color: vec4<f32>) -> VertexOutput {
  var out: VertexOutput;
  out.clip_position = camera.view_proj * vec4<f32>(position, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color.rgb * in.color.a, in.color.a);
}
`;
