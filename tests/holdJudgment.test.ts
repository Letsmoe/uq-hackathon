import { test, expect, describe } from "bun:test";
import { JudgmentSystem } from "../frontend/src/lib/game/Judgment";
import { makeInitialState, NoteType } from "../frontend/src/lib/game/types";
import type { RuntimeNote, JudgmentEvent } from "../frontend/src/lib/game/types";

const HOLD_START = 2;
const HOLD_END = 3;

function makeHoldNote(): RuntimeNote {
  return {
    id: 1,
    type: NoteType.Hold,
    tick: 0,
    x: 0.5,
    duration: 480,
    pixelX: 100,
    pixelY: 200,
    endPixelY: 600,
    timeSeconds: HOLD_START,
    endTimeSeconds: HOLD_END,
    hit: false,
    missed: false,
    holdActive: false,
    holdProgress: 0,
    holdHeadResult: null,
    chainNodeIdx: 0,
  };
}

function makeSystem() {
  const state = makeInitialState();
  const events: JudgmentEvent[] = [];
  const judgment = new JudgmentSystem(state, (event) => events.push(event));
  return { state, events, judgment };
}

describe("hold judgment", () => {
  test("grabbing a hold scores nothing until the tail runs out", () => {
    const { state, events, judgment } = makeSystem();
    const note = makeHoldNote();

    judgment.judgeHoldStart(note, HOLD_START);
    expect(note.holdActive).toBe(true);
    expect(state.score).toBe(0);
    expect(state.combo).toBe(0);
    expect(events).toHaveLength(0);

    judgment.updateHold(note, HOLD_START + 0.5);
    expect(note.holdProgress).toBeCloseTo(0.5);
    expect(state.score).toBe(0);
    expect(events).toHaveLength(0);
  });

  test("holding to the end awards the head timing grade", () => {
    const { state, events, judgment } = makeSystem();
    const note = makeHoldNote();

    judgment.judgeHoldStart(note, HOLD_START);
    const completed = judgment.updateHold(note, HOLD_END);

    expect(completed).toBe(true);
    expect(note.hit).toBe(true);
    expect(note.holdActive).toBe(false);
    expect(state.perfects).toBe(1);
    expect(state.combo).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe("perfect");
  });

  test("a late but in-window grab banks the weaker grade", () => {
    const { state, judgment } = makeSystem();
    const note = makeHoldNote();

    judgment.judgeHoldStart(note, HOLD_START + 0.12);
    judgment.updateHold(note, HOLD_END);

    expect(state.goods).toBe(1);
    expect(state.perfects).toBe(0);
  });

  test("releasing early misses the note", () => {
    const { state, events, judgment } = makeSystem();
    const note = makeHoldNote();

    judgment.judgeHoldStart(note, HOLD_START);
    judgment.updateHold(note, HOLD_START + 0.4);
    judgment.judgeHoldEnd(note);

    expect(note.missed).toBe(true);
    expect(note.hit).toBe(false);
    expect(note.holdActive).toBe(false);
    expect(state.misses).toBe(1);
    expect(state.score).toBe(0);
    expect(state.combo).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe("miss");
  });

  test("a completed hold is not scored again on release", () => {
    const { state, judgment } = makeSystem();
    const note = makeHoldNote();

    judgment.judgeHoldStart(note, HOLD_START);
    judgment.updateHold(note, HOLD_END);
    judgment.judgeHoldEnd(note);

    expect(state.misses).toBe(0);
    expect(state.perfects).toBe(1);
  });

  test("a hold that is never grabbed misses once", () => {
    const { state, judgment } = makeSystem();
    const note = makeHoldNote();

    judgment.checkMisses([note], HOLD_START + 0.4);
    judgment.checkMisses([note], HOLD_START + 0.6);

    expect(state.misses).toBe(1);
  });
});
