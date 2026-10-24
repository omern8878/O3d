# Competitor benchmark results

_Real WebGPU device · 30 warm-up + 120 measured frames per workload (picking: 10 + 50 queries) · Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36_

### 10,000 entities

**1. Static scene, orbiting camera**: No entity changes; the camera orbits the whole scene every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.07 ms | 0.13 ms | 0.15 ms | 3.23 ms | 64 B | 10,000 | — |
| O3d, culling off | 0.06 ms | 0.21 ms | 0.36 ms | 3.75 ms | 64 B | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.56 ms | 0.98 ms | 1.05 ms | 6.12 ms | 64 B | 10,000 | 8.1× faster |
| Three.js InstancedMesh (needsUpdate) | 0.49 ms | 0.88 ms | 1.09 ms | 4.49 ms | 64 B | 10,000 | 7.1× faster |
| JS scene graph (AoS objects) | 0.82 ms | 1.28 ms | 1.49 ms | 4.30 ms | 351.6 KB | 10,000 | 11.7× faster |

**2. Localized animation (1% contiguous slice)**: 100 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.21 ms | 0.46 ms | 0.56 ms | 3.42 ms | 1.2 KB | 10,000 | — |
| O3d, culling off | 0.15 ms | 0.24 ms | 0.30 ms | 3.49 ms | 1.2 KB | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.53 ms | 0.81 ms | 0.90 ms | 3.41 ms | 6.3 KB | 10,000 | 2.5× faster |
| Three.js InstancedMesh (needsUpdate) | 1.30 ms | 1.68 ms | 1.87 ms | 4.47 ms | 625.0 KB | 10,000 | 6.2× faster |
| JS scene graph (AoS objects) | 0.93 ms | 1.27 ms | 1.35 ms | 3.51 ms | 351.6 KB | 10,000 | 4.4× faster |

**3. Entity churn (despawn + spawn)**: 200 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.20 ms | 1.57 ms | 1.92 ms | 4.06 ms | 349.7 KB | 10,000 | — |
| O3d, culling off | 0.92 ms | 1.24 ms | 1.60 ms | 3.80 ms | 349.7 KB | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 1.57 ms | 2.08 ms | 2.30 ms | 3.56 ms | 742.2 KB | 10,000 | 1.3× faster |
| Three.js InstancedMesh (needsUpdate) | 1.78 ms | 2.32 ms | 2.65 ms | 5.00 ms | 742.2 KB | 10,000 | 1.5× faster |
| JS scene graph (AoS objects) | 2.31 ms | 3.20 ms | 3.38 ms | 3.73 ms | 351.6 KB | 10,000 | 1.9× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.37 ms | 0.62 ms | 0.67 ms | 4.19 ms | 24.3 KB | 689 | — |
| O3d, culling off | 0.09 ms | 0.21 ms | 0.32 ms | 3.89 ms | 64 B | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.63 ms | 0.88 ms | 0.93 ms | 3.69 ms | 64 B | 10,000 | 1.7× faster |
| Three.js InstancedMesh (needsUpdate) | 0.63 ms | 0.91 ms | 1.02 ms | 3.87 ms | 64 B | 10,000 | 1.7× faster |
| JS scene graph (AoS objects) | 0.84 ms | 1.29 ms | 1.41 ms | 3.47 ms | 351.6 KB | 10,000 | 2.3× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.04 ms | 0.05 ms | 0.05 ms | — |
| O3d, culling off | 0.05 ms | 0.06 ms | 0.06 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.78 ms | 0.99 ms | 1.14 ms | 19.4× faster |
| Three.js InstancedMesh (needsUpdate) | 0.68 ms | 0.73 ms | 0.90 ms | 17.0× faster |
| JS scene graph (AoS objects) | 0.06 ms | 0.07 ms | 0.09 ms | 1.6× faster |

_O3d hit an entity on 34/50 queries. Same entity as O3d: Three.js InstancedMesh (+ addUpdateRange): 40/50; Three.js InstancedMesh (needsUpdate): 40/50; JS scene graph (AoS objects): 47/50._

**Memory per entity**

| Engine | Instance data | JS heap at setup |
|---|---:|---:|
| O3d (Rust/Wasm SoA + WebGPU) | 36 B | 17 B |
| O3d, culling off | 36 B | 54 B |
| Three.js InstancedMesh (+ addUpdateRange) | 76 B | 133 B |
| Three.js InstancedMesh (needsUpdate) | 76 B | 50 B |
| JS scene graph (AoS objects) | 36 B | 212 B |

### 50,000 entities

**1. Static scene, orbiting camera**: No entity changes; the camera orbits the whole scene every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.09 ms | 0.18 ms | 0.28 ms | 4.30 ms | 64 B | 50,000 | — |
| O3d, culling off | 0.08 ms | 0.17 ms | 0.22 ms | 4.05 ms | 64 B | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.68 ms | 0.97 ms | 1.06 ms | 4.72 ms | 64 B | 50,000 | 8.0× faster |
| Three.js InstancedMesh (needsUpdate) | 0.79 ms | 1.00 ms | 1.09 ms | 4.76 ms | 64 B | 50,000 | 9.4× faster |
| JS scene graph (AoS objects) | 2.69 ms | 3.24 ms | 3.54 ms | 4.68 ms | 1.72 MB | 50,000 | 31.6× faster |

**2. Localized animation (1% contiguous slice)**: 500 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.67 ms | 0.94 ms | 1.03 ms | 4.63 ms | 5.9 KB | 50,000 | — |
| O3d, culling off | 0.62 ms | 0.82 ms | 0.89 ms | 4.06 ms | 5.9 KB | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 1.03 ms | 1.25 ms | 1.45 ms | 4.46 ms | 31.3 KB | 50,000 | 1.5× faster |
| Three.js InstancedMesh (needsUpdate) | 2.65 ms | 3.79 ms | 4.03 ms | 5.30 ms | 3.05 MB | 50,000 | 4.0× faster |
| JS scene graph (AoS objects) | 3.14 ms | 3.76 ms | 3.96 ms | 5.31 ms | 1.72 MB | 50,000 | 4.7× faster |

**3. Entity churn (despawn + spawn)**: 1,000 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 3.44 ms | 4.13 ms | 4.42 ms | 5.41 ms | 1.71 MB | 50,000 | — |
| O3d, culling off | 3.46 ms | 4.24 ms | 4.42 ms | 5.69 ms | 1.71 MB | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 3.24 ms | 3.70 ms | 3.77 ms | 5.33 ms | 3.62 MB | 50,000 | 1.1× slower |
| Three.js InstancedMesh (needsUpdate) | 3.02 ms | 3.36 ms | 3.61 ms | 5.24 ms | 3.62 MB | 50,000 | 1.1× slower |
| JS scene graph (AoS objects) | 3.45 ms | 3.94 ms | 4.27 ms | 5.49 ms | 1.72 MB | 50,000 | 1.0× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.24 ms | 1.65 ms | 1.81 ms | 4.00 ms | 98.4 KB | 2,798 | — |
| O3d, culling off | 0.08 ms | 0.17 ms | 0.25 ms | 4.06 ms | 64 B | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.66 ms | 0.88 ms | 1.01 ms | 4.11 ms | 64 B | 50,000 | 1.9× slower |
| Three.js InstancedMesh (needsUpdate) | 0.62 ms | 0.93 ms | 0.96 ms | 3.94 ms | 64 B | 50,000 | 2.0× slower |
| JS scene graph (AoS objects) | 2.85 ms | 3.44 ms | 3.71 ms | 5.11 ms | 1.72 MB | 50,000 | 2.3× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.17 ms | 0.19 ms | 0.19 ms | — |
| O3d, culling off | 0.13 ms | 0.15 ms | 0.15 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 3.44 ms | 3.78 ms | 4.06 ms | 20.2× faster |
| Three.js InstancedMesh (needsUpdate) | 3.38 ms | 3.47 ms | 3.58 ms | 19.9× faster |
| JS scene graph (AoS objects) | 0.14 ms | 0.19 ms | 0.19 ms | 1.2× slower |

_O3d hit an entity on 37/50 queries. Same entity as O3d: Three.js InstancedMesh (+ addUpdateRange): 34/50; Three.js InstancedMesh (needsUpdate): 34/50; JS scene graph (AoS objects): 47/50._

**Memory per entity**

| Engine | Instance data | JS heap at setup |
|---|---:|---:|
| O3d (Rust/Wasm SoA + WebGPU) | 36 B | 9 B |
| O3d, culling off | 36 B | 45 B |
| Three.js InstancedMesh (+ addUpdateRange) | 76 B | 121 B |
| Three.js InstancedMesh (needsUpdate) | 76 B | 44 B |
| JS scene graph (AoS objects) | 36 B | 211 B |

### 100,000 entities

**1. Static scene, orbiting camera**: No entity changes; the camera orbits the whole scene every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.09 ms | 0.16 ms | 0.27 ms | 4.58 ms | 64 B | 100,000 | — |
| O3d, culling off | 0.07 ms | 0.15 ms | 0.22 ms | 4.88 ms | 64 B | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.66 ms | 0.92 ms | 0.98 ms | 4.61 ms | 64 B | 100,000 | 7.0× faster |
| Three.js InstancedMesh (needsUpdate) | 0.66 ms | 0.92 ms | 1.04 ms | 4.44 ms | 64 B | 100,000 | 6.9× faster |
| JS scene graph (AoS objects) | 3.09 ms | 3.28 ms | 3.40 ms | 5.90 ms | 3.43 MB | 100,000 | 32.5× faster |

**2. Localized animation (1% contiguous slice)**: 1,000 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.98 ms | 1.26 ms | 1.32 ms | 4.41 ms | 11.7 KB | 100,000 | — |
| O3d, culling off | 0.97 ms | 1.38 ms | 1.47 ms | 4.39 ms | 11.7 KB | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 1.37 ms | 1.57 ms | 1.66 ms | 4.12 ms | 62.5 KB | 100,000 | 1.4× faster |
| Three.js InstancedMesh (needsUpdate) | 1.87 ms | 2.13 ms | 2.19 ms | 5.87 ms | 6.10 MB | 100,000 | 1.9× faster |
| JS scene graph (AoS objects) | 2.99 ms | 3.19 ms | 3.22 ms | 6.07 ms | 3.43 MB | 100,000 | 3.0× faster |

**3. Entity churn (despawn + spawn)**: 2,000 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 4.00 ms | 4.38 ms | 4.48 ms | 7.34 ms | 3.43 MB | 100,000 | — |
| O3d, culling off | 3.59 ms | 3.93 ms | 4.31 ms | 6.94 ms | 3.43 MB | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 3.33 ms | 4.29 ms | 4.62 ms | 7.39 ms | 7.25 MB | 100,000 | 1.2× slower |
| Three.js InstancedMesh (needsUpdate) | 3.70 ms | 4.08 ms | 4.21 ms | 7.95 ms | 7.25 MB | 100,000 | 1.1× slower |
| JS scene graph (AoS objects) | 5.13 ms | 5.36 ms | 5.90 ms | 8.50 ms | 3.43 MB | 100,000 | 1.3× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.96 ms | 2.62 ms | 2.80 ms | 4.06 ms | 193.9 KB | 5,513 | — |
| O3d, culling off | 0.08 ms | 0.17 ms | 0.22 ms | 4.31 ms | 64 B | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.47 ms | 0.81 ms | 0.93 ms | 4.22 ms | 64 B | 100,000 | 4.2× slower |
| Three.js InstancedMesh (needsUpdate) | 0.51 ms | 0.77 ms | 0.88 ms | 4.31 ms | 64 B | 100,000 | 3.8× slower |
| JS scene graph (AoS objects) | 3.09 ms | 3.20 ms | 3.25 ms | 5.79 ms | 3.43 MB | 100,000 | 1.6× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.26 ms | 0.27 ms | 0.28 ms | — |
| O3d, culling off | 0.25 ms | 0.26 ms | 0.27 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 6.81 ms | 6.90 ms | 6.93 ms | 25.7× faster |
| Three.js InstancedMesh (needsUpdate) | 6.71 ms | 6.79 ms | 6.88 ms | 25.3× faster |
| JS scene graph (AoS objects) | 0.30 ms | 0.36 ms | 0.39 ms | 1.1× faster |

_O3d hit an entity on 36/50 queries. Same entity as O3d: Three.js InstancedMesh (+ addUpdateRange): 43/50; Three.js InstancedMesh (needsUpdate): 43/50; JS scene graph (AoS objects): 46/50._

**Memory per entity**

| Engine | Instance data | JS heap at setup |
|---|---:|---:|
| O3d (Rust/Wasm SoA + WebGPU) | 36 B | 9 B |
| O3d, culling off | 36 B | 45 B |
| Three.js InstancedMesh (+ addUpdateRange) | 76 B | 122 B |
| Three.js InstancedMesh (needsUpdate) | 76 B | 45 B |
| JS scene graph (AoS objects) | 36 B | 212 B |
