import type { RuntimeNote } from './types';

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
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointerup',   this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    document.addEventListener('keydown', this.onKey);
    this.canvas.style.touchAction = 'none';
  }

  detach() {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup',   this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    document.removeEventListener('keydown', this.onKey);
  }

  setActiveNotes(notes: RuntimeNote[], scanPixelY: number) {
    this.activeNotes = notes;
    this.scanPixelY  = scanPixelY;
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    // Check if closest note is a hold — register hold start
    const hold = this.activeNotes.find(n => n.type === 2 && !n.hit && !n.missed && !n.holdActive);
    if (hold) {
      this.heldNoteId = hold.id;
      this.onHold(hold.id, true);
    } else {
      this.onInput();
    }
  };

  private onUp = (_e: PointerEvent) => {
    if (this.heldNoteId !== null) {
      this.onHold(this.heldNoteId, false);
      this.heldNoteId = null;
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (!['Space', 'KeyD', 'KeyF', 'KeyJ', 'KeyK'].includes(e.code)) return;
    e.preventDefault();
    const hold = this.activeNotes.find(n => n.type === 2 && !n.hit && !n.missed && !n.holdActive);
    if (hold) {
      this.heldNoteId = hold.id;
      this.onHold(hold.id, true);
    } else {
      this.onInput();
    }
  };
}
