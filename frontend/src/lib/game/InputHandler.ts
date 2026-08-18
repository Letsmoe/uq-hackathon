export type PressCallback = (x: number, y: number, pointerId: number) => void;
export type ReleaseCallback = (pointerId: number) => void;

/**
 * Translates pointer events into playfield coordinates.
 *
 * Coordinates are reported in the renderer's logical space rather than in
 * backing-store pixels. The canvas is sized by devicePixelRatio and the whole
 * frame is additionally CSS-scaled to fit the screen, so the only reliable
 * mapping is from the element's visual rect onto the logical dimensions.
 */
export class InputHandler {
  private pointerPositions = new Map<number, { x: number; y: number }>();

  constructor(
    private canvas: HTMLCanvasElement,
    private logicalWidth: number,
    private logicalHeight: number,
    private onPress: PressCallback,
    private onRelease: ReleaseCallback,
  ) {
    this.attach();
  }

  setLogicalSize(width: number, height: number) {
    this.logicalWidth = width;
    this.logicalHeight = height;
  }

  /**
   * True when a finger is currently within `radius` of the given x. Drag notes
   * are judged by proximity of a held finger rather than by a fresh press, so
   * the engine polls this each frame.
   */
  hasPointerNearX(x: number, radius: number): boolean {
    for (const position of this.pointerPositions.values()) {
      if (Math.abs(position.x - x) <= radius) {
        return true;
      }
    }
    return false;
  }

  get activePointerCount(): number {
    return this.pointerPositions.size;
  }

  detach() {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.pointerPositions.clear();
  }

  private attach() {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.style.touchAction = "none";
  }

  private toLogical(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.logicalWidth,
      y: ((clientY - rect.top) / rect.height) * this.logicalHeight,
    };
  }

  private handlePointerDown = (event: PointerEvent) => {
    event.preventDefault();

    // Keeps events flowing for this finger even if it slides off the canvas,
    // so a hold or drag is not silently dropped part-way through.
    this.canvas.setPointerCapture(event.pointerId);

    const { x, y } = this.toLogical(event.clientX, event.clientY);
    this.pointerPositions.set(event.pointerId, { x, y });
    this.onPress(x, y, event.pointerId);
  };

  // Tracks position only. A moving finger must not re-trigger a press, or
  // dragging across the playfield would machine-gun taps.
  private handlePointerMove = (event: PointerEvent) => {
    if (!this.pointerPositions.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    const { x, y } = this.toLogical(event.clientX, event.clientY);
    this.pointerPositions.set(event.pointerId, { x, y });
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (!this.pointerPositions.delete(event.pointerId)) {
      return;
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.onRelease(event.pointerId);
  };
}
