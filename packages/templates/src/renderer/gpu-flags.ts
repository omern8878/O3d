/**
 * WebGPU usage / visibility flags with their spec-defined values as a fallback.
 *
 * The `GPUBufferUsage` and `GPUShaderStage` globals only exist in browsers
 * with WebGPU. Reading them through these accessors lets the CPU-side pipeline
 * (and the headless context) run anywhere; the values are fixed by the spec,
 * so the fallback is exact.
 */

const SPEC_BUFFER_USAGE = { COPY_DST: 0x08, INDEX: 0x10, VERTEX: 0x20, UNIFORM: 0x40 } as const;
const SPEC_SHADER_STAGE = { VERTEX: 0x1, FRAGMENT: 0x2 } as const;
const SPEC_TEXTURE_USAGE = { RENDER_ATTACHMENT: 0x10 } as const;

type BufferUsageFlags = Pick<GPUBufferUsage, keyof typeof SPEC_BUFFER_USAGE>;
type ShaderStageFlags = Pick<GPUShaderStage, keyof typeof SPEC_SHADER_STAGE>;
type TextureUsageFlags = Pick<GPUTextureUsage, keyof typeof SPEC_TEXTURE_USAGE>;

/** `GPUBufferUsage`, or its spec values where WebGPU is unavailable. */
export function bufferUsage(): BufferUsageFlags {
  return (globalThis as { GPUBufferUsage?: BufferUsageFlags }).GPUBufferUsage ??
    SPEC_BUFFER_USAGE;
}

/** `GPUShaderStage`, or its spec values where WebGPU is unavailable. */
export function shaderStage(): ShaderStageFlags {
  return (globalThis as { GPUShaderStage?: ShaderStageFlags }).GPUShaderStage ??
    SPEC_SHADER_STAGE;
}

/** `GPUTextureUsage`, or its spec values where WebGPU is unavailable. */
export function textureUsage(): TextureUsageFlags {
  return (globalThis as { GPUTextureUsage?: TextureUsageFlags }).GPUTextureUsage ??
    SPEC_TEXTURE_USAGE;
}
