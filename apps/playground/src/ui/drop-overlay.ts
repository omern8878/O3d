/**
 * A full-window drop zone: dragging files over the page shows an overlay,
 * dropping hands the first file to `onFile`. Nested drag events are counted
 * so the overlay does not flicker over child elements.
 */
export class DropOverlay {
  private readonly overlay: HTMLElement
  private depth = 0

  constructor(container: HTMLElement, onFile: (file: File) => void) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'drop-overlay'
    this.overlay.hidden = true
    this.overlay.dataset.testid = 'drop-overlay'
    this.overlay.innerHTML = '<div class="drop-card"><strong>Drop to import</strong><span>.svg or .obj, any size</span></div>'
    container.append(this.overlay)

    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      this.depth++
      this.overlay.hidden = false
    })
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'copy'
    })
    window.addEventListener('dragleave', () => {
      this.depth = Math.max(0, this.depth - 1)
      if (this.depth === 0) this.overlay.hidden = true
    })
    window.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      this.depth = 0
      this.overlay.hidden = true
      const file = event.dataTransfer?.files[0]
      if (file) onFile(file)
    })
  }
}
