import type { RuntimeNote } from "./types";

export type InputCallback = (x: number, y: number) => void;
export type HoldCallback = (noteId: number, held: boolean) => void;

export class InputHandler {
  private activeNotes: RuntimeNote[] = [];
  private scanPixelY = 0;
  private heldNoteId: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private onInput: InputCallback,
    private onHold: HoldCallback,
  ) {
    this.attach();
  }

  private attach() {
    this.canvas.addEventListener("touchstart", this.onTouchDown, { passive: false });
    this.canvas.addEventListener("touchend", this.onTouchUp);
    this.canvas.addEventListener("touchmove", this.onTouchDown, { passive: false });
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mouseup", this.onMouseUp);
    this.canvas.style.touchAction = "none";
  }

  detach() {
    this.canvas.removeEventListener("touchstart", this.onTouchDown);
    this.canvas.removeEventListener("touchend", this.onTouchUp);
    this.canvas.removeEventListener("touchmove", this.onTouchDown);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
  }

  setActiveNotes(notes: RuntimeNote[], scanPixelY: number) {
    this.activeNotes = notes;
    this.scanPixelY = scanPixelY;
  }

  private canvasCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  private handleDown(x: number, y: number) {
    const hold = this.activeNotes.find(
      (n) => n.type === 2 && !n.hit && !n.missed && !n.holdActive,
    );
    if (hold) {
      this.heldNoteId = hold.id;
      this.onHold(hold.id, true);
    } else {
      this.onInput(x, y);
    }
  }

  private handleUp() {
    if (this.heldNoteId !== null) {
      this.onHold(this.heldNoteId, false);
      this.heldNoteId = null;
    }
  }

  private onTouchDown = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0] ?? e.changedTouches[0];
    if (!t) return;
    const { x, y } = this.canvasCoords(t.clientX, t.clientY);
    this.handleDown(x, y);
  };

  private onTouchUp = (_e: TouchEvent) => {
    this.handleUp();
  };

  private onMouseDown = (e: MouseEvent) => {
    const { x, y } = this.canvasCoords(e.clientX, e.clientY);
    this.handleDown(x, y);
  };

  private onMouseUp = (_e: MouseEvent) => {
    this.handleUp();
  };
}
