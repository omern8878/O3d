//! Engine bootstrap smoke test exposed to JS.

use wasm_bindgen::prelude::*;

/// Confirms from JS that the engine module loaded and is callable.
#[wasm_bindgen]
pub fn init_engine() -> String {
    "Engine Core Initialized!".to_string()
}
