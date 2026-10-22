# Competitor benchmark results

_Real WebGPU device · 30 warm-up + 120 measured frames per workload (picking: 10 + 50 queries) · Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36_

### 10,000 entities

**1. Static scene, orbiting camera**: No entity changes; the camera orbits the whole scene every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.07 ms | 0.13 ms | 0.24 ms | 3.06 ms | 64 B | 10,000 | — |
| O3d, culling off | 0.06 ms | 0.09 ms | 0.14 ms | 2.95 ms | 64 B | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.56 ms | 0.80 ms | 0.96 ms | 3.16 ms | 64 B | 10,000 | 7.9× faster |
| Three.js InstancedMesh (needsUpdate) | 0.44 ms | 0.65 ms | 0.80 ms | 2.89 ms | 64 B | 10,000 | 6.2× faster |
| JS scene graph (AoS objects) | 0.62 ms | 1.01 ms | 1.11 ms | 3.05 ms | 351.6 KB | 10,000 | 8.9× faster |

**2. Localized animation (1% contiguous slice)**: 100 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.14 ms | 0.21 ms | 0.38 ms | 3.27 ms | 1.2 KB | 10,000 | — |
| O3d, culling off | 0.13 ms | 0.19 ms | 0.34 ms | 2.89 ms | 1.2 KB | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.56 ms | 0.76 ms | 0.89 ms | 3.31 ms | 6.3 KB | 10,000 | 4.0× faster |
| Three.js InstancedMesh (needsUpdate) | 0.99 ms | 1.18 ms | 1.29 ms | 3.25 ms | 625.0 KB | 10,000 | 7.0× faster |
| JS scene graph (AoS objects) | 0.75 ms | 0.99 ms | 1.20 ms | 3.28 ms | 351.6 KB | 10,000 | 5.3× faster |

**3. Entity churn (despawn + spawn)**: 200 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.81 ms | 1.05 ms | 1.25 ms | 3.17 ms | 349.7 KB | 10,000 | — |
| O3d, culling off | 0.78 ms | 1.00 ms | 1.30 ms | 3.22 ms | 349.7 KB | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 1.32 ms | 1.55 ms | 1.83 ms | 3.61 ms | 742.2 KB | 10,000 | 1.6× faster |
| Three.js InstancedMesh (needsUpdate) | 1.27 ms | 1.56 ms | 1.74 ms | 3.22 ms | 742.2 KB | 10,000 | 1.6× faster |
| JS scene graph (AoS objects) | 1.88 ms | 2.39 ms | 2.56 ms | 3.46 ms | 351.6 KB | 10,000 | 2.3× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.28 ms | 0.41 ms | 0.48 ms | 3.20 ms | 24.3 KB | 689 | — |
| O3d, culling off | 0.07 ms | 0.21 ms | 0.28 ms | 3.44 ms | 64 B | 10,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.54 ms | 0.84 ms | 0.88 ms | 3.50 ms | 64 B | 10,000 | 1.9× faster |
| Three.js InstancedMesh (needsUpdate) | 0.51 ms | 0.65 ms | 0.81 ms | 3.26 ms | 64 B | 10,000 | 1.8× faster |
| JS scene graph (AoS objects) | 0.80 ms | 0.92 ms | 0.99 ms | 3.39 ms | 351.6 KB | 10,000 | 2.8× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.03 ms | 0.04 ms | 0.04 ms | — |
| O3d, culling off | 0.04 ms | 0.04 ms | 0.06 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.75 ms | 0.93 ms | 1.09 ms | 25.2× faster |
| Three.js InstancedMesh (needsUpdate) | 0.68 ms | 0.72 ms | 1.08 ms | 22.5× faster |
| JS scene graph (AoS objects) | 0.06 ms | 0.07 ms | 0.18 ms | 2.2× faster |

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
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.07 ms | 0.11 ms | 0.27 ms | 3.07 ms | 64 B | 50,000 | — |
| O3d, culling off | 0.06 ms | 0.09 ms | 0.21 ms | 3.45 ms | 64 B | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.49 ms | 0.67 ms | 0.79 ms | 3.02 ms | 64 B | 50,000 | 7.0× faster |
| Three.js InstancedMesh (needsUpdate) | 0.49 ms | 0.74 ms | 0.82 ms | 3.40 ms | 64 B | 50,000 | 6.9× faster |
| JS scene graph (AoS objects) | 2.00 ms | 2.56 ms | 2.69 ms | 4.36 ms | 1.72 MB | 50,000 | 28.6× faster |

**2. Localized animation (1% contiguous slice)**: 500 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.46 ms | 0.70 ms | 0.74 ms | 3.55 ms | 5.9 KB | 50,000 | — |
| O3d, culling off | 0.54 ms | 0.75 ms | 0.86 ms | 4.11 ms | 5.9 KB | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.70 ms | 1.00 ms | 1.24 ms | 3.24 ms | 31.3 KB | 50,000 | 1.5× faster |
| Three.js InstancedMesh (needsUpdate) | 2.01 ms | 2.56 ms | 2.66 ms | 4.68 ms | 3.05 MB | 50,000 | 4.3× faster |
| JS scene graph (AoS objects) | 2.25 ms | 2.81 ms | 3.04 ms | 4.55 ms | 1.72 MB | 50,000 | 4.8× faster |

**3. Entity churn (despawn + spawn)**: 1,000 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 2.51 ms | 2.97 ms | 3.22 ms | 4.57 ms | 1.71 MB | 50,000 | — |
| O3d, culling off | 2.62 ms | 3.53 ms | 4.18 ms | 4.57 ms | 1.71 MB | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 2.92 ms | 3.29 ms | 3.43 ms | 5.17 ms | 3.62 MB | 50,000 | 1.2× faster |
| Three.js InstancedMesh (needsUpdate) | 2.72 ms | 2.93 ms | 3.00 ms | 5.02 ms | 3.62 MB | 50,000 | 1.1× faster |
| JS scene graph (AoS objects) | 3.37 ms | 6.39 ms | 8.64 ms | 5.25 ms | 1.72 MB | 50,000 | 1.3× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.94 ms | 1.26 ms | 1.46 ms | 2.70 ms | 98.4 KB | 2,798 | — |
| O3d, culling off | 0.06 ms | 0.12 ms | 0.14 ms | 2.14 ms | 64 B | 50,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.41 ms | 0.69 ms | 0.89 ms | 3.43 ms | 64 B | 50,000 | 2.3× slower |
| Three.js InstancedMesh (needsUpdate) | 0.50 ms | 0.74 ms | 0.86 ms | 3.74 ms | 64 B | 50,000 | 1.9× slower |
| JS scene graph (AoS objects) | 1.27 ms | 2.18 ms | 2.32 ms | 3.56 ms | 1.72 MB | 50,000 | 1.4× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.15 ms | 0.16 ms | 0.16 ms | — |
| O3d, culling off | 0.13 ms | 0.14 ms | 0.15 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 3.38 ms | 3.59 ms | 4.24 ms | 22.5× faster |
| Three.js InstancedMesh (needsUpdate) | 3.34 ms | 3.45 ms | 3.63 ms | 22.3× faster |
| JS scene graph (AoS objects) | 0.14 ms | 0.17 ms | 0.19 ms | 1.1× slower |

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
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.07 ms | 0.13 ms | 0.22 ms | 4.08 ms | 64 B | 100,000 | — |
| O3d, culling off | 0.07 ms | 0.12 ms | 0.13 ms | 3.26 ms | 64 B | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.44 ms | 0.79 ms | 0.82 ms | 3.59 ms | 64 B | 100,000 | 6.4× faster |
| Three.js InstancedMesh (needsUpdate) | 0.42 ms | 0.63 ms | 0.76 ms | 2.46 ms | 64 B | 100,000 | 6.0× faster |
| JS scene graph (AoS objects) | 2.80 ms | 3.42 ms | 3.63 ms | 5.34 ms | 3.43 MB | 100,000 | 39.9× faster |

**2. Localized animation (1% contiguous slice)**: 1,000 contiguous tail entities move every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.56 ms | 1.09 ms | 1.14 ms | 3.39 ms | 11.7 KB | 100,000 | — |
| O3d, culling off | 0.92 ms | 1.13 ms | 1.17 ms | 3.55 ms | 11.7 KB | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.73 ms | 0.99 ms | 1.38 ms | 3.88 ms | 62.5 KB | 100,000 | 1.3× faster |
| Three.js InstancedMesh (needsUpdate) | 1.00 ms | 1.94 ms | 2.00 ms | 4.61 ms | 6.10 MB | 100,000 | 1.8× faster |
| JS scene graph (AoS objects) | 2.69 ms | 2.98 ms | 3.09 ms | 5.78 ms | 3.43 MB | 100,000 | 4.8× faster |

**3. Entity churn (despawn + spawn)**: 2,000 random entities despawned and as many spawned every frame.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 3.63 ms | 4.32 ms | 4.55 ms | 6.61 ms | 3.43 MB | 100,000 | — |
| O3d, culling off | 3.87 ms | 4.93 ms | 5.13 ms | 7.13 ms | 3.43 MB | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 3.21 ms | 4.38 ms | 4.87 ms | 6.81 ms | 7.25 MB | 100,000 | 1.1× slower |
| Three.js InstancedMesh (needsUpdate) | 3.05 ms | 3.89 ms | 4.21 ms | 6.54 ms | 7.25 MB | 100,000 | 1.2× slower |
| JS scene graph (AoS objects) | 5.14 ms | 5.80 ms | 6.65 ms | 8.54 ms | 3.43 MB | 100,000 | 1.4× faster |

**4. Deep zoom into the eye (frustum culling)**: Camera tight on the cat's eye, jittered by 0.002 units each frame so culling reruns.

| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |
|---|---:|---:|---:|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 1.75 ms | 2.07 ms | 2.25 ms | 3.14 ms | 193.9 KB | 5,513 | — |
| O3d, culling off | 0.06 ms | 0.13 ms | 0.21 ms | 3.83 ms | 64 B | 100,000 | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 0.44 ms | 0.80 ms | 0.86 ms | 3.15 ms | 64 B | 100,000 | 4.0× slower |
| Three.js InstancedMesh (needsUpdate) | 0.44 ms | 0.61 ms | 0.64 ms | 2.96 ms | 64 B | 100,000 | 4.0× slower |
| JS scene graph (AoS objects) | 2.94 ms | 3.53 ms | 3.73 ms | 5.34 ms | 3.43 MB | 100,000 | 1.7× faster |

**5. Raycast picking**: 50 pointer queries against every entity (overview camera).

| Engine | Latency P50 | P95 | P99 | O3d vs. engine |
|---|---:|---:|---:|---:|
| **O3d (Rust/Wasm SoA + WebGPU)** | 0.25 ms | 0.27 ms | 0.27 ms | — |
| O3d, culling off | 0.25 ms | 0.25 ms | 0.26 ms | same engine |
| Three.js InstancedMesh (+ addUpdateRange) | 6.69 ms | 6.87 ms | 6.88 ms | 26.7× faster |
| Three.js InstancedMesh (needsUpdate) | 6.66 ms | 6.84 ms | 7.01 ms | 26.6× faster |
| JS scene graph (AoS objects) | 0.31 ms | 0.37 ms | 0.42 ms | 1.2× faster |

_O3d hit an entity on 36/50 queries. Same entity as O3d: Three.js InstancedMesh (+ addUpdateRange): 43/50; Three.js InstancedMesh (needsUpdate): 43/50; JS scene graph (AoS objects): 46/50._

**Memory per entity**

| Engine | Instance data | JS heap at setup |
|---|---:|---:|
| O3d (Rust/Wasm SoA + WebGPU) | 36 B | 9 B |
| O3d, culling off | 36 B | 45 B |
| Three.js InstancedMesh (+ addUpdateRange) | 76 B | 122 B |
| Three.js InstancedMesh (needsUpdate) | 76 B | 45 B |
| JS scene graph (AoS objects) | 36 B | 212 B |
