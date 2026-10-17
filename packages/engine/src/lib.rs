//! Engine core entrypoint. Declares modules and re-exports the public Wasm
//! bindings; contains no logic of its own.

pub mod ecs;
pub mod init;
pub mod memory;

pub use ecs::entity_buffer::EntityBuffer;
pub use init::init_engine;
pub use memory::wasm_memory;
