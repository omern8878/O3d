import type { ClearColor, RendererConfig } from "../types/renderer.types.ts";

const DEFAULT_POWER_PREFERENCE: GPUPowerPreference = "high-performance";
const DEFAULT_CLEAR_COLOR: ClearColor = { r: 0, g: 0, b: 0, a: 1 };
/** Caps the render resolution to save fill-rate and battery on mobile. */
const MAX_PIXEL_RATIO = 2;

/**
 * Owns the WebGPU connection: adapter, device, queue and canvas context.
 *
 * WebGPU setup is asynchronous, so instances are built with
 * {@link GpuContext.create}.
 */
export class GpuContext {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly queue: GPUQueue;
  readonly context: GPUCanvasContext;
  readonly canvas: HTMLCanvasElement;
  readonly format: GPUTextureFormat;
  private readonly defaultClearColor: ClearColor;

  private constructor(
    adapter: GPUAdapter,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    config: RendererConfig,
  ) {
    this.adapter = adapter;
    this.device = device;
    this.queue = device.queue;
    this.context = context;
    this.canvas = config.canvas;
    this.format = format;
    this.defaultClearColor = config.clearColor ?? DEFAULT_CLEAR_COLOR;
  }

  /**
   * Requests an adapter and device, and configures the canvas for rendering.
   *
   * @throws {Error} if WebGPU is unavailable or any setup step fails.
   */
  static async create(config: RendererConfig): Promise<GpuContext> {
    if (!navigator.gpu) {
      throw new Error(
        "WebGPU is not supported in this browser. Use a recent Chrome, Edge or Safari, and serve the page over HTTPS or localhost.",
      );
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: config.powerPreference ?? DEFAULT_POWER_PREFERENCE,
    });
    if (!adapter) {
      throw new Error("WebGPU is supported, but no suitable GPU adapter was found.");
    }

    const device = await adapter.requestDevice();
    GpuContext.reportDeviceLoss(device);

    const context = config.canvas.getContext("webgpu");
    if (!context) {
      throw new Error("Failed to acquire a WebGPU context from the canvas.");
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });

    return new GpuContext(adapter, device, context, format, config);
  }

  /**
   * Matches the canvas drawing buffer to its on-screen size in device pixels
   * (pixel ratio capped at 2x). Call it before rendering and on resize.
   */
  resizeToDisplaySize(): void {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * pixelRatio));

    // Assigning width/height reallocates the drawing buffer, so skip no-ops.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /** Clears the current frame to `color` (or the configured clear color). */
  clearFrame(color: ClearColor = this.defaultClearColor): void {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: color,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();
    this.queue.submit([encoder.finish()]);
  }

  /** Logs unexpected device loss; an intentional `destroy()` is not an error. */
  private static reportDeviceLoss(device: GPUDevice): void {
    void device.lost.then((info) => {
      if (info.reason !== "destroyed") {
        console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
      }
    });
  }
}
