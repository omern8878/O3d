import { parseDeclarations } from './svg-attributes.ts'

/** One simple selector: an optional tag, id and classes (`rect#a.b.c`). */
type SimpleSelector = { tag: string | null; id: string | null; classes: string[] }

type CssRule = {
  selector: SimpleSelector
  /** `[ids, classes, tags]`, compared lexicographically. */
  specificity: [number, number, number]
  order: number
  declarations: Record<string, string>
}

/** The element facts a selector can match. */
export type StyledElement = { tag: string; id: string | null; classes: readonly string[] }

const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g
const SIMPLE_SELECTOR = /^([a-zA-Z][\w-]*|\*)?((?:[#.][\w-]+)*)$/

/**
 * The subset of CSS that SVG exporters (Illustrator, Inkscape, Figma) emit:
 * rules with simple selectors (`tag`, `.class`, `#id`, `tag.class`, `*`)
 * and selector lists. Combinators, pseudo-classes and at-rules are ignored.
 */
export class SvgStylesheet {
  private readonly rules: CssRule[] = []

  constructor(cssText: string) {
    const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^{]+\{[^{}]*\}/g, '')
    let order = 0
    for (const [, selectorList, body] of css.matchAll(RULE_PATTERN)) {
      const declarations = parseDeclarations(body!)
      for (const raw of selectorList!.split(',')) {
        const selector = parseSimpleSelector(raw.trim())
        if (selector) {
          this.rules.push({ selector, specificity: specificityOf(selector), order: order++, declarations })
        }
      }
    }
  }

  get isEmpty(): boolean {
    return this.rules.length === 0
  }

  /** Declarations applying to `element`, later and more specific rules winning. */
  declarationsFor(element: StyledElement): Record<string, string> {
    const matching = this.rules
      .filter((rule) => matches(rule.selector, element))
      .sort((a, b) => compareSpecificity(a, b) || a.order - b.order)
    return Object.assign({}, ...matching.map((rule) => rule.declarations))
  }
}

function parseSimpleSelector(text: string): SimpleSelector | null {
  const match = SIMPLE_SELECTOR.exec(text)
  if (!match || text.length === 0) return null
  const parts = match[2]!.match(/[#.][\w-]+/g) ?? []
  return {
    tag: match[1] && match[1] !== '*' ? match[1] : null,
    id: parts.find((p) => p.startsWith('#'))?.slice(1) ?? null,
    classes: parts.filter((p) => p.startsWith('.')).map((p) => p.slice(1)),
  }
}

function matches(selector: SimpleSelector, element: StyledElement): boolean {
  return (selector.tag === null || selector.tag === element.tag) &&
    (selector.id === null || selector.id === element.id) &&
    selector.classes.every((c) => element.classes.includes(c))
}

function specificityOf(selector: SimpleSelector): [number, number, number] {
  return [selector.id ? 1 : 0, selector.classes.length, selector.tag ? 1 : 0]
}

function compareSpecificity(a: CssRule, b: CssRule): number {
  for (let i = 0; i < 3; i++) {
    const difference = a.specificity[i]! - b.specificity[i]!
    if (difference !== 0) return difference
  }
  return 0
}
