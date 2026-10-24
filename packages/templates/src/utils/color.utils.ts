import type { ColorInput } from "../types/entity.types.ts";

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_CHANNEL = 255;

/**
 * Converts a hex string (`#RRGGBB` / `#RGB`) or a normalized RGB object into a
 * `[r, g, b]` tuple of floats in `0..1`. Object channels are clamped to that
 * range.
 *
 * @throws {Error} if a string is not a valid 3- or 6-digit hex color.
 */
export function parseColor(input: ColorInput): [number, number, number] {
  if (typeof input === "string") {
    return parseHex(input);
  }
  return [clamp01(input.r), clamp01(input.g), clamp01(input.b)];
}

function parseHex(hex: string): [number, number, number] {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }

  const digits = expandShorthand(match[1]!);
  const channel = (offset: number) =>
    parseInt(digits.slice(offset, offset + 2), 16) / MAX_CHANNEL;

  return [channel(0), channel(2), channel(4)];
}

/** `"f80"` -> `"ff8800"`; 6-digit input is returned unchanged. */
function expandShorthand(digits: string): string {
  return digits.length === 3
    ? [...digits].map((digit) => digit + digit).join("")
    : digits;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Packs a normalized RGBA color into the `u32` layout the batch buffers use:
 * red in the lowest byte (`r | g << 8 | b << 16 | a << 24`), which the GPU
 * reads as `unorm8x4`. Channels are clamped to `0..1`.
 */
export function packRgba(r: number, g: number, b: number, a: number = 1): number {
  const byte = (value: number) => Math.round(clamp01(value) * MAX_CHANNEL);
  return (byte(r) | (byte(g) << 8) | (byte(b) << 16) | (byte(a) << 24)) >>> 0;
}

/** {@link packRgba} for any {@link ColorInput}, with a separate alpha. */
export function packColor(input: ColorInput, alpha: number = 1): number {
  const [r, g, b] = parseColor(input);
  return packRgba(r, g, b, alpha);
}
