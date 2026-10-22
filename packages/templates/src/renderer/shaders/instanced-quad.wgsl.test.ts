import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSTANCED_QUAD_WGSL } from "./instanced-quad.wgsl.ts";

/** Source-level checks: there is no GPU to compile the shader in Node. */
describe("instanced shape shader", () => {
  it("passes quad-local UVs spanning [-1, 1] from the vertex to the fragment stage", () => {
    assert.match(INSTANCED_QUAD_WGSL, /@location\(1\) local_uv: vec2<f32>/);
    assert.match(INSTANCED_QUAD_WGSL, /out\.local_uv = local_pos \* 2\.0;/);
  });

  it("selects the shape with an overridable constant defaulting to the quad", () => {
    assert.match(INSTANCED_QUAD_WGSL, /override shape_mode: u32 = 0u;/);
    assert.match(INSTANCED_QUAD_WGSL, /const SHAPE_CIRCLE: u32 = 1u;/);
  });

  it("anti-aliases the circle edge analytically and discards outside the unit circle", () => {
    assert.match(INSTANCED_QUAD_WGSL, /let dist = length\(in\.local_uv\);/);
    assert.match(INSTANCED_QUAD_WGSL, /if \(dist > 1\.0\) \{\s*discard;/);
    assert.match(
      INSTANCED_QUAD_WGSL,
      /let alpha = 1\.0 - smoothstep\(1\.0 - edge, 1\.0, dist\);/,
    );
    assert.match(INSTANCED_QUAD_WGSL, /vec4<f32>\(in\.color \* alpha, alpha\)/);
  });

  it("takes the derivative before the discard so it runs in uniform control flow", () => {
    const derivative = INSTANCED_QUAD_WGSL.indexOf("fwidth(dist)");
    const discard = INSTANCED_QUAD_WGSL.indexOf("discard;");

    assert.ok(derivative > 0 && derivative < discard);
  });

  it("keeps the opaque quad output as the fallback", () => {
    assert.match(INSTANCED_QUAD_WGSL, /return vec4<f32>\(in\.color, 1\.0\);/);
  });

  it("billboards each quad: the corner offset is added in clip space, scaled per screen axis", () => {
    assert.match(INSTANCED_QUAD_WGSL, /let center = m \* vec4<f32>\(instance_pos, 1\.0\);/);
    assert.match(INSTANCED_QUAD_WGSL, /length\(vec3<f32>\(m\[0\]\.x, m\[1\]\.x, m\[2\]\.x\)\)/);
    assert.match(INSTANCED_QUAD_WGSL, /length\(vec3<f32>\(m\[0\]\.y, m\[1\]\.y, m\[2\]\.y\)\)/);
    assert.match(
      INSTANCED_QUAD_WGSL,
      /center\.xy \+ local_pos \* instance_scale\.xy \* axis_scale,\s*center\.zw,/,
    );
  });
});
