import { FLOATS_PER_MESH_VERTEX } from "../geometry/gpu-mesh.ts";
import { BYTES_PER_FLOAT, BYTES_PER_VEC3 } from "../memory/vec3-layout.ts";
import type { MeshShading } from "../types/batch.types.ts";

/** Depth format of the batch renderer's depth attachment. */
export const BATCH_DEPTH_FORMAT: GPUTextureFormat = "depth24plus";

const VEC4_STRIDE = 4 * BYTES_PER_FLOAT;
const PACKED_COLOR_STRIDE = 4;
const MESH_VERTEX_STRIDE = FLOATS_PER_MESH_VERTEX * BYTES_PER_FLOAT;

/** Values of the mesh shader's `lighting` override constant. */
const LIGHTING_CONSTANTS: Record<MeshShading, number> = {
  flat: 0,
  lit: 1,
};

/** Premultiplied-alpha "over" blending, matching both shaders' output. */
const PREMULTIPLIED_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

const DEPTH_TESTED: GPUDepthStencilState = {
  format: BATCH_DEPTH_FORMAT,
  depthWriteEnabled: true,
  depthCompare: "less-equal",
};

export type BatchPipelineOptions = {
  device: GPUDevice;
  shaderModule: GPUShaderModule;
  pipelineLayout: GPUPipelineLayout;
  colorFormat: GPUTextureFormat;
};

/**
 * The instanced-mesh pipeline for a shading mode. Vertex buffer slots:
 * 0 = interleaved position + normal (per vertex), 1 = transforms,
 * 2 = rotations, 3 = colors (per instance). Both faces are drawn, so flat
 * shapes stay visible from behind.
 */
export function createInstancedMeshPipeline(
  options: BatchPipelineOptions & { shading: MeshShading },
): GPURenderPipeline {
  const { device, shaderModule, pipelineLayout, colorFormat, shading } = options;
  return device.createRenderPipeline({
    label: `instanced-mesh-${shading}-pipeline`,
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: MESH_VERTEX_STRIDE,
          stepMode: "vertex",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: BYTES_PER_VEC3, format: "float32x3" },
          ],
        },
        singleAttribute(2, "float32x4", VEC4_STRIDE, "instance"),
        singleAttribute(3, "float32x4", VEC4_STRIDE, "instance"),
        singleAttribute(4, "unorm8x4", PACKED_COLOR_STRIDE, "instance"),
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      constants: { lighting: LIGHTING_CONSTANTS[shading] },
      targets: [{ format: colorFormat, blend: PREMULTIPLIED_BLEND }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: DEPTH_TESTED,
  });
}

/**
 * The line-list pipeline. Vertex buffer slots: 0 = positions, 1 = colors
 * (both per vertex, two vertices per segment).
 */
export function createLineBatchPipeline(options: BatchPipelineOptions): GPURenderPipeline {
  const { device, shaderModule, pipelineLayout, colorFormat } = options;
  return device.createRenderPipeline({
    label: "line-batch-pipeline",
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        singleAttribute(0, "float32x3", BYTES_PER_VEC3, "vertex"),
        singleAttribute(1, "unorm8x4", PACKED_COLOR_STRIDE, "vertex"),
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: colorFormat, blend: PREMULTIPLIED_BLEND }],
    },
    primitive: { topology: "line-list" },
    depthStencil: DEPTH_TESTED,
  });
}

/** One tightly packed vertex buffer holding a single attribute. */
function singleAttribute(
  shaderLocation: number,
  format: GPUVertexFormat,
  arrayStride: number,
  stepMode: GPUVertexStepMode,
): GPUVertexBufferLayout {
  return { arrayStride, stepMode, attributes: [{ shaderLocation, offset: 0, format }] };
}
