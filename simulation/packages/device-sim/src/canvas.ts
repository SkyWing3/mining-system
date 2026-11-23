// Superficie de dibujo monocroma de 128x64 (canvas.h). Las coordenadas incluyen
// ambos extremos, como en Pillow; `y` del texto es su borde superior.

export type Font = 'small' | 'large'

export interface Canvas {
  clear(): void
  setFont(font: Font): void
  textWidth(text: string): number
  text(x: number, y: number, text: string, on: boolean): void
  box(x0: number, y0: number, x1: number, y1: number, on: boolean): void
  frame(x0: number, y0: number, x1: number, y1: number, on: boolean): void
  roundedFrame(x0: number, y0: number, x1: number, y1: number, radius: number, on: boolean): void
  line(x0: number, y0: number, x1: number, y1: number, on: boolean): void
  ellipse(x0: number, y0: number, x1: number, y1: number, filled: boolean, on: boolean): void
}

/**
 * Registra cada operación como texto para comparar fotogramas (FakeCanvas de las
 * pruebas del firmware): ancho de 5 px por carácter en la fuente chica y 7 en la grande.
 */
export class RecordingCanvas implements Canvas {
  ops: string[] = []
  font: Font = 'small'

  clear(): void { this.ops = [] }
  setFont(font: Font): void { this.font = font }
  textWidth(text: string): number { return [...text].length * (this.font === 'large' ? 7 : 5) }
  text(x: number, y: number, text: string, on: boolean): void { this.ops.push(`text ${x},${y}${on ? ' ' : ' inv '}${text}`) }
  box(x0: number, y0: number, x1: number, y1: number, on: boolean): void { this.shape('box', x0, y0, x1, y1, on) }
  frame(x0: number, y0: number, x1: number, y1: number, on: boolean): void { this.shape('frame', x0, y0, x1, y1, on) }
  roundedFrame(x0: number, y0: number, x1: number, y1: number, _radius: number, on: boolean): void { this.shape('rframe', x0, y0, x1, y1, on) }
  line(x0: number, y0: number, x1: number, y1: number, on: boolean): void { this.shape('line', x0, y0, x1, y1, on) }
  ellipse(x0: number, y0: number, x1: number, y1: number, filled: boolean, on: boolean): void { this.shape(filled ? 'disc' : 'ellipse', x0, y0, x1, y1, on) }

  hasText(needle: string): boolean {
    return this.ops.some(op => op.startsWith('text ') && op.includes(needle))
  }

  private shape(kind: string, x0: number, y0: number, x1: number, y1: number, on: boolean): void {
    this.ops.push(`${kind} ${x0},${y0},${x1},${y1}${on ? '' : ' off'}`)
  }
}
