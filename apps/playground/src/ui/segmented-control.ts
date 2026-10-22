/** One choice in a {@link createSegmentedControl}. */
export type SegmentOption<T extends string> = { value: T; label: string }

/**
 * A labelled row of mutually exclusive buttons. Returns the element and a
 * setter that updates the highlighted choice without firing `onChange`.
 */
export function createSegmentedControl<T extends string>(
  label: string,
  testId: string,
  options: readonly SegmentOption<T>[],
  initial: T,
  onChange: (value: T) => void,
): { element: HTMLElement; set(value: T): void } {
  const row = document.createElement('div')
  row.className = 'control-row'
  const caption = document.createElement('span')
  caption.className = 'control-label'
  caption.textContent = label
  const group = document.createElement('div')
  group.className = 'segmented'
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', label)

  const buttons = options.map(({ value, label: text }) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = text
    button.dataset.testid = `${testId}-${value}`
    button.addEventListener('click', () => {
      set(value)
      onChange(value)
    })
    group.append(button)
    return { value, button }
  })

  function set(value: T): void {
    for (const entry of buttons) {
      const active = entry.value === value
      entry.button.classList.toggle('active', active)
      entry.button.setAttribute('aria-pressed', String(active))
    }
  }

  set(initial)
  row.append(caption, group)
  return { element: row, set }
}
