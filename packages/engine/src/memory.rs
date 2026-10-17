//! Wasm linear-memory access for JS interop.

use wasm_bindgen::prelude::*;

/// Returns the Wasm linear memory so JS can create typed-array views over it.
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
