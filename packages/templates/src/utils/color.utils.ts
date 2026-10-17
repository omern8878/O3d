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
