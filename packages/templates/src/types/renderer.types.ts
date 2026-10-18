/** Normalized RGBA color, each channel in `0..1`. */
export type ClearColor = { r: number; g: number; b: number; a: number };

/** Configuration for creating a WebGPU renderer. */
export type RendererConfig = {
  /** Canvas to render into. */
  canvas: HTMLCanvasElement;
  /** GPU selection hint. Defaults to `'high-performance'`. */
  powerPreference?: GPUPowerPreference;
  /** Color used by `clearFrame()` when none is passed. Defaults to opaque black. */
  clearColor?: ClearColor;
};

/**
 * How each instance is drawn: `'quad'` fills the whole instance rectangle,
 * `'circle'` draws an anti-aliased disc inscribed in it (an SDF, so it needs
 * no extra geometry).
 */
export type ShapeMode = "quad" | "circle";
