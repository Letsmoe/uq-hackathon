import type { RuntimeNote } from "./types";

export type InputCallback = () => void;
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
    this.canvas.addEventListener("touchstart", this.onDown, { passive: false });
    this.canvas.addEventListener("touchend", this.onUp);
    this.canvas.addEventListener("touchmove", this.onDown, { passive: false });
    this.canvas.style.touchAction = "none";
  }

  detach() {
    this.canvas.removeEventListener("touchstart", this.onDown);
    this.canvas.removeEventListener("touchend", this.onUp);
    this.canvas.removeEventListener("touchmove", this.onUp);
  }

  setActiveNotes(notes: RuntimeNote[], scanPixelY: number) {
    this.activeNotes = notes;
    this.scanPixelY = scanPixelY;
  }

  private onDown = (e: TouchEvent) => {
    e.preventDefault();
    // Check if closest note is a hold — register hold start
    const hold = this.activeNotes.find(
      (n) => n.type === 2 && !n.hit && !n.missed && !n.holdActive,
    );
    if (hold) {
      this.heldNoteId = hold.id;
      this.onHold(hold.id, true);
    } else {
      this.onInput();
    }
  };

  private onUp = (_e: TouchEvent) => {
    if (this.heldNoteId !== null) {
      this.onHold(this.heldNoteId, false);
      this.heldNoteId = null;
    }
  };
}
