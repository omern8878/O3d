/**
 * Throws if `actual` does not contain exactly the numbers in `expected`
 * (same length, same order). Intended for exactly representable floats.
 */
export function assertFloatsEqual(
  label: string,
  actual: ArrayLike<number>,
  expected: readonly number[],
): void {
  const matches =
    actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value)

  if (!matches) {
    throw new Error(
      `${label} failed: expected [${expected.join(', ')}], got [${Array.from(actual).join(', ')}]`,
    )
  }
}
