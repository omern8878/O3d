# Competitor benchmark results

_Real WebGPU device · 30 warm-up + 120 measured frames per workload (picking: 10 + 50 queries) · Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36_

### 10,000 entities

**1. Static scene, orbiting camera**: No entity changes; the camera orbits the whole scene every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.26 ms | 0.52 ms | 0.62 ms | 2.53 ms | 64 B | 10,000 | — |
| O3d, culling off | 0.06 ms | 0.10 ms | 0.12 ms | 2.56 ms | 64 B | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.49 ms | 0.69 ms | 0.77 ms | 3.27 ms | 64 B | 10,000 | 1.9× faster |
| Three.js InstancedMesh (needsUpdate) | 0.47 ms | 0.63 ms | 0.77 ms | 3.13 ms | 64 B | 10,000 | 1.8× faster |
| JS scene graph (AoS objects) | 0.57 ms | 0.80 ms | 1.14 ms | 3.13 ms | 351.6 KB | 10,000 | 2.2× faster |

**2. Localized animation (1% contiguous slice)**: 100 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.30 ms | 0.65 ms | 0.74 ms | 3.56 ms | 1.2 KB | 10,000 | — |
| O3d, culling off | 0.11 ms | 0.35 ms | 0.39 ms | 3.45 ms | 1.2 KB | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.51 ms | 0.89 ms | 0.98 ms | 3.61 ms | 6.3 KB | 10,000 | 1.7× faster |
| Three.js InstancedMesh (needsUpdate) | 0.89 ms | 1.16 ms | 1.24 ms | 2.68 ms | 625.0 KB | 10,000 | 3.0× faster |
| JS scene graph (AoS objects) | 0.59 ms | 0.93 ms | 0.99 ms | 3.50 ms | 351.6 KB | 10,000 | 2.0× faster |

**3. Entity churn (despawn + spawn)**: 200 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.89 ms | 1.10 ms | 1.63 ms | 3.08 ms | 349.7 KB | 10,000 | — |
| O3d, culling off | 0.63 ms | 0.83 ms | 1.25 ms | 3.16 ms | 349.7 KB | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 1.27 ms | 1.60 ms | 2.19 ms | 3.50 ms | 742.2 KB | 10,000 | 1.4× faster |
| Three.js InstancedMesh (needsUpdate) | 1.22 ms | 1.59 ms | 1.95 ms | 3.54 ms | 742.2 KB | 10,000 | 1.4× faster |
| JS scene graph (AoS objects) | 1.45 ms | 1.99 ms | 2.25 ms | 3.15 ms | 351.6 KB | 10,000 | 1.6× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.25 ms | 0.31 ms | 0.32 ms | 2.50 ms | 24.3 KB | 689 | — |
| O3d, culling off | 0.06 ms | 0.09 ms | 0.11 ms | 2.88 ms | 64 B | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.40 ms | 0.58 ms | 0.61 ms | 2.79 ms | 64 B | 10,000 | 1.6× faster |
| Three.js InstancedMesh (needsUpdate) | 0.42 ms | 0.64 ms | 0.87 ms | 2.78 ms | 64 B | 10,000 | 1.6× faster |
| JS scene graph (AoS objects) | 0.56 ms | 0.97 ms | 1.04 ms | 3.64 ms | 351.6 KB | 10,000 | 2.2× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.03 ms | 0.04 ms | 0.04 ms | — |
| O3d, culling off | 0.04 ms | 0.05 ms | 0.06 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.75 ms | 0.88 ms | 1.09 ms | 21.6× faster |
| Three.js InstancedMesh (needsUpdate) | 0.67 ms | 0.74 ms | 0.96 ms | 19.1× faster |
| JS scene graph (AoS objects) | 0.07 ms | 0.08 ms | 0.10 ms | 2.0× faster |

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
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.12 ms | 1.35 ms | 1.43 ms | 2.87 ms | 64 B | 50,000 | — |
| O3d, culling off | 0.08 ms | 0.13 ms | 0.28 ms | 3.67 ms | 64 B | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.44 ms | 0.66 ms | 0.70 ms | 2.80 ms | 64 B | 50,000 | 2.6× slower |
| Three.js InstancedMesh (needsUpdate) | 0.43 ms | 0.58 ms | 0.62 ms | 2.98 ms | 64 B | 50,000 | 2.6× slower |
| JS scene graph (AoS objects) | 1.88 ms | 2.42 ms | 2.61 ms | 4.23 ms | 1.72 MB | 50,000 | 1.7× faster |

**2. Localized animation (1% contiguous slice)**: 500 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.26 ms | 1.53 ms | 1.67 ms | 3.38 ms | 5.9 KB | 50,000 | — |
| O3d, culling off | 0.34 ms | 0.41 ms | 0.48 ms | 2.95 ms | 5.9 KB | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.80 ms | 0.99 ms | 1.03 ms | 3.59 ms | 31.3 KB | 50,000 | 1.6× slower |
| Three.js InstancedMesh (needsUpdate) | 1.97 ms | 2.17 ms | 2.30 ms | 4.32 ms | 3.05 MB | 50,000 | 1.6× faster |
| JS scene graph (AoS objects) | 1.67 ms | 2.49 ms | 2.60 ms | 4.06 ms | 1.72 MB | 50,000 | 1.3× faster |

**3. Entity churn (despawn + spawn)**: 1,000 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 2.53 ms | 3.00 ms | 3.10 ms | 4.54 ms | 1.71 MB | 50,000 | — |
| O3d, culling off | 2.25 ms | 2.51 ms | 2.76 ms | 4.69 ms | 1.71 MB | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 2.75 ms | 3.36 ms | 3.44 ms | 4.71 ms | 3.62 MB | 50,000 | 1.1× faster |
| Three.js InstancedMesh (needsUpdate) | 2.59 ms | 3.14 ms | 3.39 ms | 4.77 ms | 3.62 MB | 50,000 | 1.0× faster |
| JS scene graph (AoS objects) | 2.99 ms | 3.90 ms | 4.08 ms | 4.96 ms | 1.72 MB | 50,000 | 1.2× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.83 ms | 1.06 ms | 1.23 ms | 3.00 ms | 98.4 KB | 2,798 | — |
| O3d, culling off | 0.06 ms | 0.08 ms | 0.09 ms | 2.60 ms | 64 B | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.41 ms | 0.61 ms | 0.64 ms | 2.74 ms | 64 B | 50,000 | 2.0× slower |
| Three.js InstancedMesh (needsUpdate) | 0.38 ms | 0.49 ms | 0.63 ms | 2.96 ms | 64 B | 50,000 | 2.2× slower |
| JS scene graph (AoS objects) | 1.49 ms | 1.81 ms | 2.05 ms | 3.76 ms | 1.72 MB | 50,000 | 1.8× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.16 ms | 0.17 ms | 0.17 ms | — |
| O3d, culling off | 0.13 ms | 0.14 ms | 0.16 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 3.44 ms | 3.58 ms | 3.83 ms | 22.2× faster |
| Three.js InstancedMesh (needsUpdate) | 3.44 ms | 3.57 ms | 3.76 ms | 22.2× faster |
| JS scene graph (AoS objects) | 0.15 ms | 0.18 ms | 0.18 ms | 1.0× slower |

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
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.75 ms | 2.03 ms | 2.08 ms | 4.59 ms | 64 B | 100,000 | — |
| O3d, culling off | 0.07 ms | 0.15 ms | 0.28 ms | 3.44 ms | 64 B | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.53 ms | 0.78 ms | 0.87 ms | 3.58 ms | 64 B | 100,000 | 3.3× slower |
| Three.js InstancedMesh (needsUpdate) | 0.56 ms | 0.88 ms | 0.98 ms | 3.28 ms | 64 B | 100,000 | 3.1× slower |
| JS scene graph (AoS objects) | 2.50 ms | 2.97 ms | 3.09 ms | 4.87 ms | 3.43 MB | 100,000 | 1.4× faster |

**2. Localized animation (1% contiguous slice)**: 1,000 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 2.27 ms | 2.44 ms | 2.52 ms | 5.17 ms | 11.7 KB | 100,000 | — |
| O3d, culling off | 0.72 ms | 0.98 ms | 1.12 ms | 3.50 ms | 11.7 KB | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 1.21 ms | 1.48 ms | 1.56 ms | 3.51 ms | 62.5 KB | 100,000 | 1.9× slower |
| Three.js InstancedMesh (needsUpdate) | 1.00 ms | 1.77 ms | 2.01 ms | 4.63 ms | 6.10 MB | 100,000 | 2.3× slower |
| JS scene graph (AoS objects) | 2.62 ms | 2.96 ms | 3.13 ms | 5.39 ms | 3.43 MB | 100,000 | 1.2× faster |

**3. Entity churn (despawn + spawn)**: 2,000 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 3.97 ms | 4.25 ms | 4.60 ms | 7.11 ms | 3.43 MB | 100,000 | — |
| O3d, culling off | 3.57 ms | 4.41 ms | 4.71 ms | 6.64 ms | 3.43 MB | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 2.79 ms | 4.01 ms | 4.32 ms | 6.06 ms | 7.25 MB | 100,000 | 1.4× slower |
| Three.js InstancedMesh (needsUpdate) | 3.22 ms | 3.90 ms | 3.99 ms | 7.18 ms | 7.25 MB | 100,000 | 1.2× slower |
| JS scene graph (AoS objects) | 4.81 ms | 5.52 ms | 5.98 ms | 8.97 ms | 3.43 MB | 100,000 | 1.2× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.77 ms | 2.11 ms | 2.19 ms | 3.00 ms | 193.9 KB | 5,513 | — |
| O3d, culling off | 0.06 ms | 0.11 ms | 0.25 ms | 3.62 ms | 64 B | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.51 ms | 0.62 ms | 0.69 ms | 3.07 ms | 64 B | 100,000 | 3.5× slower |
| Three.js InstancedMesh (needsUpdate) | 0.49 ms | 0.65 ms | 0.69 ms | 3.06 ms | 64 B | 100,000 | 3.6× slower |
| JS scene graph (AoS objects) | 2.89 ms | 3.96 ms | 4.22 ms | 5.28 ms | 3.43 MB | 100,000 | 1.6× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.27 ms | 0.28 ms | 0.29 ms | — |
| O3d, culling off | 0.24 ms | 0.26 ms | 0.31 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 6.83 ms | 6.94 ms | 6.98 ms | 25.3× faster |
| Three.js InstancedMesh (needsUpdate) | 6.68 ms | 6.76 ms | 6.89 ms | 24.7× faster |
| JS scene graph (AoS objects) | 0.29 ms | 0.33 ms | 0.37 ms | 1.1× faster |

_O3d hit an entity on 36/50 queries. Same entity as O3d: Three.js InstancedMesh (+ addUpdateRange): 43/50; Three.js InstancedMesh (needsUpdate): 43/50; JS scene graph (AoS objects): 46/50._

**Memory per entity**

| Engine | Instance data | JS heap at setup |
|---|---:|---:|
| O3d (Rust/Wasm SoA + WebGPU) | 36 B | 9 B |
| O3d, culling off | 36 B | 45 B |
| Three.js InstancedMesh (+ addUpdateRange) | 76 B | 122 B |
| Three.js InstancedMesh (needsUpdate) | 76 B | 45 B |
| JS scene graph (AoS objects) | 36 B | 212 B |
