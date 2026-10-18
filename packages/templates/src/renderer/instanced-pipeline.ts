import { BYTES_PER_FLOAT, BYTES_PER_VEC3 } from "../memory/vec3-layout.ts";
import type { ShapeMode } from "../types/renderer.types.ts";

const VEC2_STRIDE = 2 * BYTES_PER_FLOAT;
const VEC3_STRIDE = BYTES_PER_VEC3;

/** Values of the shader's `shape_mode` override constant. */
const SHAPE_MODE_CONSTANTS: Record<ShapeMode, number> = {
  quad: 0,
  circle: 1,
};

/**
 * Premultiplied-alpha "over" blending, matching the circle shader's output so
 * anti-aliased edges composite correctly over what is already drawn.
 */
const PREMULTIPLIED_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** One tightly packed vertex buffer holding a single attribute. */
function attributeLayout(
  shaderLocation: number,
  format: GPUVertexFormat,
  arrayStride: number,
  stepMode: GPUVertexStepMode,
): GPUVertexBufferLayout {
  return {
    arrayStride,
    stepMode,
    attributes: [{ shaderLocation, offset: 0, format }],
  };
}

export type InstancedPipelineOptions = {
  device: GPUDevice;
  shaderModule: GPUShaderModule;
  pipelineLayout: GPUPipelineLayout;
  colorFormat: GPUTextureFormat;
  shapeMode: ShapeMode;
};

/**
 * Builds the instanced render pipeline for a shape mode. Vertex buffer slots:
 * 0 = quad corners (per vertex), 1 = positions, 2 = scales, 3 = colors (per
 * instance). Only the circle mode enables blending.
 */
export function createInstancedPipeline(
  options: InstancedPipelineOptions,
): GPURenderPipeline {
  const { device, shaderModule, pipelineLayout, colorFormat, shapeMode } = options;

  return device.createRenderPipeline({
    label: `instanced-${shapeMode}-pipeline`,
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        attributeLayout(0, "float32x2", VEC2_STRIDE, "vertex"),
        attributeLayout(1, "float32x3", VEC3_STRIDE, "instance"),
        attributeLayout(2, "float32x3", VEC3_STRIDE, "instance"),
        attributeLayout(3, "float32x3", VEC3_STRIDE, "instance"),
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      constants: { shape_mode: SHAPE_MODE_CONSTANTS[shapeMode] },
      targets: [
        shapeMode === "circle"
          ? { format: colorFormat, blend: PREMULTIPLIED_BLEND }
          : { format: colorFormat },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });
}
