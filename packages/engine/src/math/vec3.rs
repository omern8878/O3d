//! Pure 3-component vector helpers on `[f32; 3]`.

/// Vectors shorter than this are treated as zero when normalizing.
const EPSILON: f32 = 1e-6;

pub fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub fn scale(v: [f32; 3], s: f32) -> [f32; 3] {
    [v[0] * s, v[1] * s, v[2] * s]
}

pub fn length(v: [f32; 3]) -> f32 {
    dot(v, v).sqrt()
}

/// Unit-length copy of `v`, or the zero vector if `v` is (nearly) zero.
pub fn normalize(v: [f32; 3]) -> [f32; 3] {
    let len = length(v);
    if len < EPSILON {
        return [0.0; 3];
    }
    [v[0] / len, v[1] / len, v[2] / len]
}

#[cfg(test)]
#[path = "vec3_tests.rs"]
mod tests;
