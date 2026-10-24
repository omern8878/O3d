const ATTRIBUTE_PATTERN = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Parses a tag's raw attribute text into a name -> value map. */
export function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const [, name, doubleQuoted, singleQuoted] of raw.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[name!] = doubleQuoted ?? singleQuoted ?? ''
  }
  return attributes
}

/** Parses CSS declarations (`fill: red; stroke: blue`) into a property map. */
export function parseDeclarations(text: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).replace(/!important/i, '').trim()
    if (property && value) declarations[property] = value
  }
  return declarations
}
