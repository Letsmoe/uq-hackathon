import type { RuntimeNote } from "./types";

export type HitCallback = (noteId: number, timeMs: number) => void;
export type SwipeCallback = (
  noteId: number,
  dir: "left" | "right",
  timeMs: number,
) => void;
export type HoldCallback = (
  noteId: number,
  held: boolean,
  timeMs: number,
) => void;

interface PointerState {
  id: number;
  startX: number;
  startY: number;
  startT: number;
  noteId: number | null; // note being held
}

const SWIPE_THRESHOLD_PX = 40;
const HIT_RADIUS_X_LANES = 0.7; // fraction of lane width
const HIT_RADIUS_Y_PX = 80; // pixels above/below scan line

export class InputHandler {
  private pointers: Map<number, PointerState> = new Map();
  private W: number;
  private H: number;
  private LANES: number;

  constructor(
    private canvas: HTMLCanvasElement,
    W: number,
    H: number,
    private onTap: HitCallback,
    private onSwipe: SwipeCallback,
    private onHold: HoldCallback,
    LANES = 8,
  ) {
    this.W = W;
    this.H = H;
    this.LANES = LANES;
    this.attach();
  }

  // ── Attach / detach ───────────────────────────────────────────────────────

  private attach() {
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.style.touchAction = "none";
  }

  detach() {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
  }

  // ── Active notes (updated each frame by GameEngine) ───────────────────────

  private activeNotes: RuntimeNote[] = [];
  private scanPixelY = 0;

  setActiveNotes(notes: RuntimeNote[], scanPixelY: number) {
    this.activeNotes = notes;
    this.scanPixelY = scanPixelY;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Scale canvas coordinates to the internal 1920×1200 coordinate space */
  private scale(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.W / rect.width;
    const scaleY = this.H / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private laneWidth() {
    return this.W / this.LANES;
  }

  /**
   * Find the closest unhit, un-missed note to the tap position
   * that is within hit radius of the scan line.
   */
  private findNote(x: number): RuntimeNote | null {
    const lw = this.laneWidth();
    let best: RuntimeNote | null = null;
    let bestD = Infinity;

    for (const note of this.activeNotes) {
      if (note.hit || note.missed) continue;

      const dy = Math.abs(note.pixelY - this.scanPixelY);
      if (dy > HIT_RADIUS_Y_PX) continue;

      const dx = Math.abs(note.pixelX - x);
      if (dx > lw * HIT_RADIUS_X_LANES) continue;

      const d = dx + dy;
      if (d < bestD) {
        bestD = d;
        best = note;
      }
    }

    return best;
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    const { x, y } = this.scale(e);
    const note = this.findNote(x);

    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      startX: x,
      startY: y,
      startT: performance.now(),
      noteId: note?.id ?? null,
    });

    if (!note) return;

    if (note.type === "hold") {
      this.onHold(note.id, true, e.timeStamp);
    } else if (note.type === "tap") {
      this.onTap(note.id, e.timeStamp);
    }
    // swipe: wait for pointerup to detect direction
  };

  private onMove = (e: PointerEvent) => {
    const state = this.pointers.get(e.pointerId);
    if (!state || state.noteId === null) return;

    const { x } = this.scale(e);
    const dx = x - state.startX;
    const note = this.activeNotes.find((n) => n.id === state.noteId);
    if (!note || note.type !== "swipe") return;

    // Trigger swipe early if threshold exceeded
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && !note.hit) {
      const dir = dx > 0 ? "right" : "left";
      this.onSwipe(note.id, dir, e.timeStamp);
    }
  };

  private onUp = (e: PointerEvent) => {
    const state = this.pointers.get(e.pointerId);
    if (!state) return;

    const { x } = this.scale(e);
    const dx = x - state.startX;

    if (state.noteId !== null) {
      const note = this.activeNotes.find((n) => n.id === state.noteId);
      if (note) {
        if (note.type === "hold") {
          this.onHold(note.id, false, e.timeStamp);
        } else if (note.type === "swipe" && !note.hit) {
          // Fallback: resolve swipe on up if not already triggered
          if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
            this.onSwipe(note.id, dx > 0 ? "right" : "left", e.timeStamp);
          }
        }
      }
    }

    this.pointers.delete(e.pointerId);
  };

  resize(W: number, H: number) {
    this.W = W;
    this.H = H;
  }
}
