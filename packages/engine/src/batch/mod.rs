//! Generic, GPU-ready batches stored in fixed-capacity Wasm arrays that JS
//! writes in place: per-instance data for hardware instancing, line segments,
//! and ray / frustum queries over flat arrays of bounding spheres.

pub mod instance_buffer;
pub mod line_buffer;
pub mod sphere_query;
