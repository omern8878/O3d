//! Indexed triangle meshes in a GPU-ready layout.
//!
//! ```text
//! vertices  [px py pz nx ny nz | px py pz nx ny nz | ...]  f32, interleaved
//! indices   [a b c | a b c | ...]                          u32, CCW from outside
//! ```
//!
//! Built-in shapes are centered on the origin and fit the unit sphere, so an
//! instance's uniform scale is its size and `bounding_radius()` turns that
//! scale into a picking radius. The arrays never change after construction.

use std::f32::consts::{PI, TAU};

use wasm_bindgen::prelude::*;

use crate::math::vec3::{add, cross, dot, normalize, sub};

pub const FLOATS_PER_VERTEX: usize = 6;
const VERTICES_PER_TRIANGLE: usize = 3;

const MIN_SEGMENTS: u32 = 3;
const MIN_RINGS: u32 = 2;
/// Keeps one JS-supplied tessellation from requesting a huge mesh.
const MAX_SEGMENTS: u32 = 1024;

/// Normal given to vertices no non-degenerate triangle touches.
const FALLBACK_NORMAL: [f32; 3] = [0.0, 1.0, 0.0];

/// An immutable indexed triangle mesh with per-vertex normals.
#[wasm_bindgen]
pub struct MeshGeometry {
    vertices: Vec<f32>,
    indices: Vec<u32>,
    bounding_radius: f32,
}

#[wasm_bindgen]
impl MeshGeometry {
    /// A UV sphere of radius 1. `segments` (around `+Y`) is clamped to
    /// `[3, 1024]` and `rings` (pole to pole) to `[2, 1024]`.
    pub fn sphere(segments: u32, rings: u32) -> MeshGeometry {
        let segments = segments.clamp(MIN_SEGMENTS, MAX_SEGMENTS);
        let rings = rings.clamp(MIN_RINGS, MAX_SEGMENTS);
        let mut builder = Builder::default();

        let columns = segments + 1;
        for ring in 0..=rings {
            let elevation = PI / 2.0 - PI * ring as f32 / rings as f32;
            for segment in 0..=segments {
                let azimuth = TAU * segment as f32 / segments as f32;
                let point = [
                    elevation.cos() * azimuth.sin(),
                    elevation.sin(),
                    elevation.cos() * azimuth.cos(),
                ];
                builder.vertex(point, point);
            }
        }
        for ring in 0..rings {
            for segment in 0..segments {
                let top_left = ring * columns + segment;
                let bottom_left = top_left + columns;
                // The top and bottom rows each lose one triangle to the pole.
                if ring + 1 < rings {
                    builder.triangle(top_left, bottom_left, bottom_left + 1);
                }
                if ring > 0 {
                    builder.triangle(top_left, bottom_left + 1, top_left + 1);
                }
            }
        }
        builder.build()
    }

    /// A closed cone along `+Y`: apex at `(0, 0.5, 0)`, base of radius `0.5`
    /// at `y = -0.5`. `segments` is clamped to `[3, 1024]`.
    pub fn cone(segments: u32) -> MeshGeometry {
        const HALF: f32 = 0.5;
        let segments = segments.clamp(MIN_SEGMENTS, MAX_SEGMENTS);
        let mut builder = Builder::default();

        let rim = |azimuth: f32| [HALF * azimuth.sin(), -HALF, HALF * azimuth.cos()];
        // The side's slope: height 1 over radius 0.5.
        let side_normal = |azimuth: f32| normalize([azimuth.sin(), HALF, azimuth.cos()]);

        for segment in 0..segments {
            let start = TAU * segment as f32 / segments as f32;
            let end = TAU * (segment + 1) as f32 / segments as f32;
            let apex = builder.vertex([0.0, HALF, 0.0], side_normal(0.5 * (start + end)));
            let left = builder.vertex(rim(start), side_normal(start));
            let right = builder.vertex(rim(end), side_normal(end));
            builder.triangle(apex, left, right);
        }

        let down = [0.0, -1.0, 0.0];
        let center = builder.vertex([0.0, -HALF, 0.0], down);
        let first_rim = center + 1;
        for segment in 0..segments {
            builder.vertex(rim(TAU * segment as f32 / segments as f32), down);
        }
        for segment in 0..segments {
            let next = (segment + 1) % segments;
            builder.triangle(center, first_rim + next, first_rim + segment);
        }
        builder.build()
    }

    /// A flat disc of radius 1 in the XY plane, facing `+Z` (a camera looking
    /// down `-Z` sees its front). `segments` is clamped to `[3, 1024]`.
    pub fn disc(segments: u32) -> MeshGeometry {
        let segments = segments.clamp(MIN_SEGMENTS, MAX_SEGMENTS);
        let mut builder = Builder::default();
        let front = [0.0, 0.0, 1.0];

        let center = builder.vertex([0.0; 3], front);
        for segment in 0..segments {
            let angle = TAU * segment as f32 / segments as f32;
            builder.vertex([angle.cos(), angle.sin(), 0.0], front);
        }
        for segment in 0..segments {
            let next = (segment + 1) % segments;
            builder.triangle(center, center + 1 + segment, center + 1 + next);
        }
        builder.build()
    }

    /// A mesh from flat `[x, y, z, ...]` positions and CCW triangle indices,
    /// with smooth, area-weighted vertex normals. Empty `indices` reads the
    /// positions as a triangle soup. Triangles with an out-of-range index or a
    /// non-finite corner are dropped; trailing partial values are ignored.
    pub fn from_triangles(positions: &[f32], indices: &[u32]) -> MeshGeometry {
        let (points, _) = positions.as_chunks::<3>();
        let soup: Vec<u32>;
        let indices = if indices.is_empty() {
            soup = (0..points.len() as u32).collect();
            &soup
        } else {
            indices
        };

        let valid = |index: u32| {
            points
                .get(index as usize)
                .is_some_and(|point| point.iter().all(|c| c.is_finite()))
        };
        let (triangles, _) = indices.as_chunks::<VERTICES_PER_TRIANGLE>();
        let kept: Vec<[u32; 3]> = triangles
            .iter()
            .copied()
            .filter(|triangle| triangle.iter().all(|&index| valid(index)))
            .collect();

        let mut normals = vec![[0.0_f32; 3]; points.len()];
        for &[a, b, c] in &kept {
            let [pa, pb, pc] = [a, b, c].map(|index| points[index as usize]);
            // Unnormalized, so larger triangles weigh more.
            let face = cross(sub(pb, pa), sub(pc, pa));
            for index in [a, b, c] {
                normals[index as usize] = add(normals[index as usize], face);
            }
        }

        let mut builder = Builder::default();
        for (point, normal) in points.iter().zip(&normals) {
            let normal = normalize(*normal);
            let normal = if normal == [0.0; 3] {
                FALLBACK_NORMAL
            } else {
                normal
            };
            builder.vertex(*point, normal);
        }
        for [a, b, c] in kept {
            builder.triangle(a, b, c);
        }
        builder.build()
    }

    pub fn vertex_count(&self) -> usize {
        self.vertices.len() / FLOATS_PER_VERTEX
    }

    pub fn index_count(&self) -> usize {
        self.indices.len()
    }

    /// `vertex_count * 6` floats: position then normal per vertex.
    pub fn vertices_ptr(&self) -> *const f32 {
        self.vertices.as_ptr()
    }

    /// `index_count` `u32` indices, three per triangle.
    pub fn indices_ptr(&self) -> *const u32 {
        self.indices.as_ptr()
    }

    /// Largest distance from the origin to a vertex referenced by a triangle:
    /// the radius of a bounding sphere at an instance's position, per unit of
    /// its scale.
    pub fn bounding_radius(&self) -> f32 {
        self.bounding_radius
    }
}

impl MeshGeometry {
    pub fn vertices_slice(&self) -> &[f32] {
        &self.vertices
    }

    pub fn indices_slice(&self) -> &[u32] {
        &self.indices
    }
}

/// Accumulates vertices and triangles, then measures the bounding radius.
#[derive(Default)]
struct Builder {
    vertices: Vec<f32>,
    indices: Vec<u32>,
}

impl Builder {
    /// Appends a vertex and returns its index.
    fn vertex(&mut self, position: [f32; 3], normal: [f32; 3]) -> u32 {
        let index = (self.vertices.len() / FLOATS_PER_VERTEX) as u32;
        self.vertices.extend_from_slice(&position);
        self.vertices.extend_from_slice(&normal);
        index
    }

    fn triangle(&mut self, a: u32, b: u32, c: u32) {
        self.indices.extend_from_slice(&[a, b, c]);
    }

    fn build(self) -> MeshGeometry {
        let bounding_radius = self
            .indices
            .iter()
            .map(|&index| {
                let start = index as usize * FLOATS_PER_VERTEX;
                let point = [
                    self.vertices[start],
                    self.vertices[start + 1],
                    self.vertices[start + 2],
                ];
                dot(point, point).sqrt()
            })
            .fold(0.0_f32, f32::max);
        MeshGeometry {
            vertices: self.vertices,
            indices: self.indices,
            bounding_radius,
        }
    }
}

#[cfg(test)]
#[path = "mesh_geometry_tests.rs"]
mod tests;
