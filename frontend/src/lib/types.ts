// ============================================================
//  types.ts — Domain types shared across the app
// ============================================================

export interface ChartNote {
	/** Beat index (0 = first beat of the song) */
	beat: number;
	/** Horizontal position, 0 (left lane edge) → 1 (right lane edge) */
	x: number;
	type: "tap" | "hold";
	/** Duration in beats — hold notes only */
	holdBeats?: number;
}

export interface Song {
	id: string;
	title: string;
	artist: string;
	/** Cover art URL (optional) */
	coverUrl?: string;
	/** Beats per minute */
	bpm: number;
	/** Total chart length in beats */
	length: number;
	/** Chart difficulty label */
	difficulty?: "easy" | "normal" | "hard" | "chaos";
	/** All notes in the chart, any order */
	notes: ChartNote[];
	/**
	 * Optional URL to an audio file.
	 * If omitted the game synthesises a simple beat track.
	 */
	audioUrl?: string;

	player: {
		bpm: number;
		length: number;
		note_list: {
			id?: number;
			type: 0 | 1 | 2 | 3;
			// type 0 (tap) and type 2 (hold)
			tick?: number;
			duration?: number;
			x?: number;
			// type 3 (drag / slide)
			nodes?: {
				tick: number;
				duration: number;
				x: number;
			}[];
			}[];
		page_list: {
			end_tick: number;
			scan_line_direction: number;
			start_tick: number;
			}[];
		start_offset_time: number;
		time_base: number;
	};
}
