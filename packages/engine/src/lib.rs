//! Engine core entrypoint. Declares modules and re-exports the public Wasm
//! bindings; contains no logic of its own.

pub mod ecs;
pub mod init;
pub mod math;
pub mod memory;

pub use ecs::culling_buffer::{CullingBuffer, SceneVisibility};
pub use ecs::entity_buffer::EntityBuffer;
pub use ecs::picker::ScenePicker;
pub use init::init_engine;
pub use math::camera::{Camera, ProjectionMode};
pub use memory::wasm_memory;
