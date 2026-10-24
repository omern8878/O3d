//! Engine core entrypoint. Declares modules and re-exports the public Wasm
//! bindings; contains no logic of its own.

pub mod batch;
pub mod ecs;
pub mod geometry;
pub mod init;
pub mod math;
pub mod memory;

pub use batch::instance_buffer::InstanceBuffer;
pub use batch::line_buffer::LineBuffer;
pub use batch::sphere_query::{cull_spheres, raycast_spheres_ndc};
pub use ecs::culling_buffer::{CullingBuffer, SceneVisibility};
pub use ecs::entity_buffer::EntityBuffer;
pub use ecs::picker::ScenePicker;
pub use geometry::mesh_geometry::MeshGeometry;
pub use init::init_engine;
pub use math::camera::{Camera, ProjectionMode};
pub use memory::wasm_memory;
