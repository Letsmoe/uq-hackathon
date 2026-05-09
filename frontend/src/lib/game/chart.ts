// Real Cytus II-style chart schema

export interface ChartNote {
  id?: number;
  type: 0 | 1 | 2 | 3; // 0=tap, 1=flick, 2=hold, 3=chain
  tick?: number;
  duration?: number;
  x?: number;
  nodes?: ChartChainNode[];
}

export interface ChartChainNode {
  tick: number;
  duration: number;
  x: number;
}

export interface PageEntry {
  start_tick: number;
  end_tick: number;
  scan_line_direction: number; // -1 = top→bottom, 1 = bottom→top
}

export interface Chart {
  bpm: number;
  time_base: number;
  length: number;            // song length in seconds
  start_offset_time: number;
  note_list: ChartNote[];
  page_list: PageEntry[];
}

export function tickToSeconds(tick: number, bpm: number, timeBase: number): number {
  return tick / (timeBase * (bpm / 60));
}

/** Returns normalised scan line Y in [0,1] where 0=top, 1=bottom */
export function getScanLineY(
  timeSeconds: number,
  pageList: PageEntry[],
  bpm: number,
  timeBase: number,
): number {
  for (const p of pageList) {
    const ps = tickToSeconds(p.start_tick, bpm, timeBase);
    const pe = tickToSeconds(p.end_tick, bpm, timeBase);
    if (timeSeconds >= ps && timeSeconds <= pe) {
      const t = (timeSeconds - ps) / (pe - ps);
      return p.scan_line_direction === -1 ? t : 1 - t;
    }
  }
  return 0;
}

export function getCurrentPageDir(
  timeSeconds: number,
  pageList: PageEntry[],
  bpm: number,
  timeBase: number,
): number {
  for (const p of pageList) {
    const ps = tickToSeconds(p.start_tick, bpm, timeBase);
    const pe = tickToSeconds(p.end_tick, bpm, timeBase);
    if (timeSeconds >= ps && timeSeconds <= pe) return p.scan_line_direction;
  }
  return -1;
}
