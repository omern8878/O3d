/** Memory layout of a packed `vec3<f32>` attribute shared by Wasm and the GPU. */
export const FLOATS_PER_VEC3 = 3;
export const BYTES_PER_FLOAT = 4;
export const BYTES_PER_VEC3 = FLOATS_PER_VEC3 * BYTES_PER_FLOAT;
