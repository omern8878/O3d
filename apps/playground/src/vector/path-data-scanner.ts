const NUMBER_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/
const SEPARATORS = /[\s,]/

/**
 * Cursor over SVG path data (`d`). Numbers may be packed without separators
 * (`1-2.5.5`), and arc flags may be glued together (`a1 1 0 01 5 5`), so a
 * plain split cannot tokenize it.
 */
export class PathDataScanner {
  private readonly data: string
  private index = 0

  constructor(data: string) {
    this.data = data
  }

  /** The next command letter, or `null` if a number (or the end) comes first. */
  readCommand(): string | null {
    this.skipSeparators()
    const char = this.data[this.index]
    if (char !== undefined && /[a-zA-Z]/.test(char)) {
      this.index++
      return char
    }
    return null
  }

  /** Whether another number follows, i.e. the current command repeats. */
  hasNumber(): boolean {
    this.skipSeparators()
    return NUMBER_PATTERN.test(this.data.slice(this.index, this.index + 32))
  }

  /** Reads a number; returns `NaN` if none is there. */
  readNumber(): number {
    this.skipSeparators()
    const match = NUMBER_PATTERN.exec(this.data.slice(this.index, this.index + 64))
    if (!match) return Number.NaN
    this.index += match[0].length
    return Number(match[0])
  }

  /** Reads a single-character arc flag (`0` or `1`). */
  readFlag(): boolean {
    this.skipSeparators()
    const char = this.data[this.index]
    this.index++
    return char === '1'
  }

  isDone(): boolean {
    this.skipSeparators()
    return this.index >= this.data.length
  }

  /** Skips one unexpected character so malformed data cannot loop forever. */
  skipCharacter(): void {
    this.index++
  }

  private skipSeparators(): void {
    while (this.index < this.data.length && SEPARATORS.test(this.data[this.index]!)) {
      this.index++
    }
  }
}
