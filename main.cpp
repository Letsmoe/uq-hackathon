#include <soundtouch/SoundTouch.h>
#include <soundtouch/BPMDetect.h>

#include <vector>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <map>
#include <random>
#include <set>

#include <fstream>
#include <iostream>
#include <sndfile.h>
#include <nlohmann/json.hpp>


struct AudioInfo {
    float bpm;
    float duration_sec;
};

float detectBPM(const std::vector<float>& mono, int sampleRate) {
    // Compute energy envelope (RMS over windows)
    const int windowSize = 1024;
    std::vector<float> energy;
    for (int i = 0; i + windowSize < mono.size(); i += windowSize) {
        float sum = 0;
        for (int j = 0; j < windowSize; j++)
            sum += mono[i + j] * mono[i + j];
        energy.push_back(std::sqrt(sum / windowSize));
    }

    // Autocorrelation on energy envelope
    int n = energy.size();
    float energyRate = (float)sampleRate / windowSize;

    int minLag = (int)(energyRate * 60.0f / 200.0f); // 200 BPM max
    int maxLag = (int)(energyRate * 60.0f / 50.0f);  // 50 BPM min

    std::vector<float> autocorr(maxLag + 1, 0);
    for (int lag = minLag; lag <= maxLag; lag++) {
        float sum = 0;
        for (int i = 0; i + lag < n; i++)
            sum += energy[i] * energy[i + lag];
        autocorr[lag] = sum;
    }

    // Find peak lag
    int bestLag = minLag;
    float bestVal = 0;
    for (int lag = minLag; lag <= maxLag; lag++) {
        if (autocorr[lag] > bestVal) {
            bestVal = autocorr[lag];
            bestLag = lag;
        }
    }

    float bpm = 60.0f * energyRate / bestLag;

    while (bpm > 0 && bpm > 200) bpm /= 2;
    while (bpm > 0 && bpm < 50)  bpm *= 2;

    return bpm;
}

AudioInfo detectAudio(const char *path) {
    SF_INFO info;
    SNDFILE *file = sf_open(path, SFM_READ, &info);
    if (!file) throw std::runtime_error("Could not open file");

    const int FRAMES = 1024;
    std::vector<float> buffer(FRAMES * info.channels);
    std::vector<float> mono;

    // Skip first and last 10%
    sf_seek(file, info.frames * 0.1, SEEK_SET);
    long maxFrames = (long)(info.frames * 0.8);
    long total_frames = 0;
    int frames;

    while (total_frames < maxFrames &&
           (frames = sf_readf_float(file, buffer.data(), FRAMES)) > 0) {
        for (int i = 0; i < frames; i++) {
            float sum = 0;
            for (int ch = 0; ch < info.channels; ch++)
                sum += buffer[i * info.channels + ch];
            mono.push_back(sum / info.channels);
        }
        total_frames += frames;
    }

    sf_close(file);

    float bpm = detectBPM(mono, info.samplerate);

    return {
        .bpm = bpm,
        .duration_sec = (float)info.frames / info.samplerate
    };
}
// AudioInfo detectAudio(const char *path) {
//     SF_INFO info;
//     SNDFILE *file = sf_open(path, SFM_READ, &info);
//     if (!file) {
//         throw std::runtime_error("Could not open file");
//     }

//     soundtouch::BPMDetect bpmDetect(info.channels, info.samplerate);

//     float buffer[2048];
//     int frames;
//     long total_frames = 0;
//     while ((frames = sf_readf_float(file, buffer, 1024)) > 0) {
//         bpmDetect.inputSamples(buffer, frames);
//         total_frames += frames;
//     }

//     sf_close(file);

//     return {
//         .bpm = bpmDetect.getBpm(),
//         .duration_sec = (float)total_frames / info.samplerate
//     };
// }

nlohmann::json buildPageList(float bpm,
    float duration_sec,
    int time_base = 480,
    int beats_per_page = 4) {
    const int ticks_per_page = time_base * beats_per_page;
    const float seconds_per_tick = 60.0f / (bpm * time_base);
    const int total_ticks = (int)(duration_sec / seconds_per_tick);

    nlohmann::json page_list = nlohmann::json::array();
    int tick = 0;
    int direction = -1;
    while (tick < total_ticks) {
        page_list.push_back({
            {"start_tick", tick},
            {"end_tick", tick + ticks_per_page},
            {"scan_line_direction", direction}
        });
        tick += ticks_per_page;
        direction *= -1;
    }

    return page_list;
}

nlohmann::json buildNoteListOLD(float bpm, float duration_sec, int time_base = 480) {
    const float seconds_per_tick = 60.0f / (bpm * time_base);
    const int total_ticks = (int)(duration_sec / seconds_per_tick);

    nlohmann::json note_list = nlohmann::json::array();
    int id = 0;

    for (int tick = 0; tick < total_ticks; tick += time_base) {
        note_list.push_back({
            {"type", 0},
            {"id", id++},
            {"tick", tick},
            {"x", 0.5},
            {"duration", 0}
        });
    }

    return note_list;
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Normalise a raw pattern entry into a flat vector of note objects.
// Handles: direct arrays, objects with "notes" key, nested sub-groups.
static void collectPatterns(const nlohmann::json& val,
                            std::vector<nlohmann::json>& pool)
{
    if (val.is_array()) {
        pool.push_back(val);
    } else if (val.is_object()) {
        if (val.contains("notes") && val["notes"].is_array()) {
            pool.push_back(val["notes"]);
        } else {
            for (auto& [k, v] : val.items()) {
                // Skips keys that start with '_'.
                if (!k.empty() && k[0] == '_') continue;
                collectPatterns(v, pool);
            }
        }
    }
}

//  [min_x, max_x]
static std::pair<float,float> patternXExtent(const nlohmann::json& notes)
{
    float lo = 0.f, hi = 0.f;
    for (auto& note : notes) {
        if (note.contains("nodes")) {
            for (auto& n : note["nodes"]) {
                float x = n["x"];
                lo = std::min(lo, x); hi = std::max(hi, x);
            }
        } else {
            float x = note["x"];
            lo = std::min(lo, x); hi = std::max(hi, x);
        }
    }
    return {lo, hi};
}

// last tick in a pattern (before scaling)
static int patternSpan(const nlohmann::json& notes)
{
    int last = 0;
    for (auto& note : notes) {
        if (note.contains("nodes")) {
            for (auto& n : note["nodes"])
                last = std::max(last, (int)n["tick"]);
        } else {
            last = std::max(last, (int)note["tick"] + (int)note.value("duration", 0));
        }
    }
    return last;
}

// Returns true if any two tap notes (non-drag) share the same unscaled tick.
// These are "stream" patterns that deserve special placement treatment.
static bool isStreamPattern(const nlohmann::json& notes)
{
    std::set<int> seen;
    for (auto& n : notes) {
        if (n.contains("nodes")) continue;
        int t = n["tick"];
        if (!seen.insert(t).second) return true;
    }
    return false;
}

// Returns the relative-x pairs {x1, x2} for every tick that has exactly two
// simultaneous tap notes (unscaled). Used to validate close/mirror placement.
static std::vector<std::pair<float,float>> simultaneousPairs(const nlohmann::json& notes)
{
    std::map<int, std::vector<float>> by_tick;
    for (auto& n : notes) {
        if (!n.contains("nodes"))
            by_tick[(int)n["tick"]].push_back((float)n["x"]);
    }
    std::vector<std::pair<float,float>> pairs;
    for (auto& [t, xs] : by_tick)
        if (xs.size() >= 2)
            pairs.push_back({xs[0], xs[1]});
    return pairs;
}

// Returns true if the pattern contains any plain tap note
// (no drag nodes, duration == 0). Used to block tap patterns during streams.
static bool hasTapNotes(const nlohmann::json& notes)
{
    for (auto& n : notes) {
        if (!n.contains("nodes") && n.value("duration", 0) == 0)
            return true;
    }
    return false;
}

nlohmann::json buildNoteList(float bpm, float duration_sec,
                             const nlohmann::json& patterns_json,
                             int time_base = 480,
                             int beats_per_page = 4)
{
    const int   scale            = beats_per_page;
    const float seconds_per_tick = 60.0f / (bpm * time_base);
    const int   total_ticks      = (int)(duration_sec / seconds_per_tick);
    const int   ticks_per_page   = time_base * beats_per_page;

    // pattern pool
    std::vector<nlohmann::json> pool;
    for (auto& [level_name, level] : patterns_json["patterns"].items()) {
        for (auto& [key, val] : level.items()) {
            if (!key.empty() && key[0] == '_') continue;
            collectPatterns(val, pool);
        }
    }

    // precompute x-extents and spans (unscaled ticks)
    struct PatternMeta {
        float lo, hi;                           // relative x extent
        int   span;                             // last tick (unscaled)
        bool  is_stream;                        // has simultaneous tap notes
        std::vector<std::pair<float,float>> sim_pairs; // relative-x pairs at same tick
    };
    std::vector<PatternMeta> meta;
    meta.reserve(pool.size());
    for (auto& p : pool) {
        auto [lo, hi] = patternXExtent(p);
        meta.push_back({lo, hi, patternSpan(p),
                        isStreamPattern(p), simultaneousPairs(p)});
    }

    // precompute page directions
    auto directionAt = [&](int tick) -> int {
        int page = tick / ticks_per_page;
        // buildPageList starts direction at -1 and flips each page
        return (page % 2 == 0) ? -1 : 1;
    };

    // Walk beats, placing patterns spatially
    // Active placements: track which x-intervals are occupied and until when.
    struct Active {
        float lo, hi;      // absolute x interval
        int   ends_at;     // tick at which this pattern finishes
        bool  is_stream;   // true → no tap patterns may be placed while this runs
    };
    std::vector<Active> active;

    const float X_GAP   = 0.05f;  // minimum gap between patterns in x
    const float X_MAX   = 0.9f;   // 0.9*screen width

    std::mt19937 rng(42069);
    std::uniform_int_distribution<int> pickPat(0, (int)pool.size() - 1);

    // Tick density tracking (hard cap: max 3 notes share any one tick)
    std::map<int, int> tick_counts;

    // Spatial continuity state
    // prev_center : absolute x of the center of the last successfully placed pattern.
    // next_mirror : when true the next pattern mirrors around 0.5; when false it
    //               drifts (gradient) from the previous center. Alternates each beat.
    float prev_center = 0.5f;
    bool  has_prev    = false;
    bool  next_mirror = true;

    // Stream pattern throttle
    int stream_streak = 0;

    nlohmann::json note_list = nlohmann::json::array();
    int id = 0;

    for (int beat_tick = 0; beat_tick < total_ticks; beat_tick += time_base) {
        // Remove patterns that have ended
        active.erase(std::remove_if(active.begin(), active.end(),
            [&](const Active& a){ return a.ends_at <= beat_tick; }),
            active.end());

        // If any running pattern is a stream, only holds/drags may be placed
        // alongside it — no additional tap notes allowed.
        bool stream_active = std::any_of(active.begin(), active.end(),
            [](const Active& a){ return a.is_stream; });

        // Collect free x-intervals (gaps between / around active patterns)
        std::vector<std::pair<float,float>> occupied;
        for (auto& a : active) occupied.push_back({a.lo, a.hi});
        std::sort(occupied.begin(), occupied.end());

        // Build free segments: gaps in [0.1, 0.9] not covered by occupied
        std::vector<std::pair<float,float>> free_segs;
        float cursor = 0.1f;
        for (auto& [olo, ohi] : occupied) {
            float gap_start = cursor;
            float gap_end   = olo - X_GAP;
            if (gap_end > gap_start + 0.2f)
                free_segs.push_back({gap_start, gap_end});
            cursor = ohi + X_GAP;
        }
        if (cursor < X_MAX - 0.2f)
            free_segs.push_back({cursor, X_MAX});

        if (free_segs.empty()) continue;

        // Bumped slightly to absorb the extra tick-cap constraint
        const int MAX_TRIES = 8;
        bool placed = false;

        for (int attempt = 0; attempt < MAX_TRIES && !placed; ++attempt) {
            int pi = pickPat(rng);
            PatternMeta& pm = meta[pi];

            // Skip stream patterns once they've run 4 beats in a row.
            if (pm.is_stream && stream_streak >= 4) continue;

            // While a stream is running, only holds/drags may be placed.
            if (stream_active && hasTapNotes(pool[pi])) continue;

            // mirror or gradient of previous
            float pat_center_offset = (pm.lo + pm.hi) / 2.0f;
            float preferred_center;
            if (!has_prev) {
                preferred_center = 0.5f;
            } else if (next_mirror) {
                preferred_center = 1.0f - prev_center;
            } else {
                std::uniform_real_distribution<float> drift(-0.15f, 0.15f);
                preferred_center = prev_center + drift(rng);
            }
            float preferred_anchor = preferred_center - pat_center_offset;

            // Find free segments wide enough to hold this pattern
            std::vector<int> candidates;
            for (int si = 0; si < (int)free_segs.size(); ++si) {
                auto [fs, fe] = free_segs[si];
                if (fe - fs >= (pm.hi - pm.lo) + 0.2f)
                    candidates.push_back(si);
            }
            if (candidates.empty()) continue;

            // Pick the candidate segment closest to preferred_anchor.
            int best_si = candidates[0];
            float best_dist = std::numeric_limits<float>::max();
            for (int si : candidates) {
                auto [fs, fe] = free_segs[si];
                float a_min = fs - pm.lo;
                float a_max = fe - pm.hi;
                float clamped = std::clamp(preferred_anchor, a_min, a_max);
                float dist = std::abs(clamped - preferred_anchor);
                if (dist < best_dist) { best_dist = dist; best_si = si; }
            }
            auto [fs, fe] = free_segs[best_si];
            float anchor_min = fs - pm.lo;
            float anchor_max = fe - pm.hi;

            // Clamp preferred anchor into the valid range + small jitter.
            float anchor_base  = std::clamp(preferred_anchor, anchor_min, anchor_max);
            float jitter_range = std::min(0.1f, (anchor_max - anchor_min) * 0.5f);
            std::uniform_real_distribution<float> jitter(-jitter_range, jitter_range);
            float anchor = std::clamp(anchor_base + jitter(rng), anchor_min, anchor_max);

            // enforce close-or-mirrored for simultaneous pairs of streams
            // For every pair of notes that share a tick, their absolute x values
            // must be either close  (|x1-x2| < 0.4) or mirrored (x1+x2 ≈ 1.0).
            // Since the difference is fixed by the pattern, only the mirror
            // condition depends on anchor. If the current anchor fails, try to
            // recompute it for perfect mirroring.
            if (pm.is_stream && !pm.sim_pairs.empty()) {
                bool pairs_ok = true;
                for (auto& [x1r, x2r] : pm.sim_pairs) {
                    float diff   = std::abs(x1r - x2r);
                    float sum    = (anchor + x1r) + (anchor + x2r); // 2*anchor + x1r+x2r
                    bool close    = diff < 0.4f;
                    bool mirrored = std::abs(sum - 1.0f) < 0.25f;
                    if (!close && !mirrored) { pairs_ok = false; break; }
                }
                if (!pairs_ok) {
                    // Try to fix: compute anchor that mirrors the first pair around 0.5.
                    // (anchor + x1r) + (anchor + x2r) = 1.0  →  anchor = (1 - x1r - x2r) / 2
                    auto& [x1r, x2r] = pm.sim_pairs[0];
                    float mirror_anchor = (1.0f - x1r - x2r) / 2.0f;
                    if (mirror_anchor >= anchor_min && mirror_anchor <= anchor_max)
                        anchor = mirror_anchor;
                    else
                        continue; // can't satisfy constraint in this segment
                }
            }

            // tick density cap
            int direction     = directionAt(beat_tick);
            int unscaled_span = pm.span;
            int scaled_span   = unscaled_span * scale;

            auto transformTick = [&](int t) -> int {
                int scaled = t * scale;
                return beat_tick + (direction == -1 ? scaled_span - scaled : scaled);
            };

            bool tick_ok = true;
            {
                std::map<int, int> candidate_counts;
                for (auto& note : pool[pi]) {
                    if (note.contains("nodes")) {
                        for (auto& n : note["nodes"])
                            candidate_counts[transformTick((int)n["tick"])]++;
                    } else {
                        candidate_counts[transformTick((int)note["tick"])]++;
                    }
                }
                for (auto& [t, cnt] : candidate_counts) {
                    if (tick_counts[t] + cnt > 3) { tick_ok = false; break; }
                }
            }
            if (!tick_ok) continue;

            // Emit notes
            const nlohmann::json& notes = pool[pi];
            int n_notes = (int)notes.size();

            for (int ni = 0; ni < n_notes; ++ni) {
                int src = (direction == -1) ? (n_notes - 1 - ni) : ni;
                nlohmann::json note = notes[src];

                if (note.contains("nodes")) {
                    auto& nodes = note["nodes"];
                    if (direction == -1)
                        std::reverse(nodes.begin(), nodes.end());
                    for (auto& node : nodes) {
                        int t = transformTick((int)node["tick"]);
                        node["tick"] = t;
                        node["x"]    = anchor + (float)node["x"];
                        tick_counts[t]++;
                    }
                } else {
                    int orig_tick     = note["tick"];
                    int orig_duration = note.value("duration", 0);
                    int t = transformTick(orig_tick);
                    note["tick"]     = t;
                    note["duration"] = orig_duration * scale;
                    note["x"]        = anchor + (float)note["x"];
                    tick_counts[t]++;
                }

                note["id"] = id++;
                note_list.push_back(note);
            }

            // A long hold on the far side balances the visual load and gives the
            // player's other hand something gentle to do during a dense stream
            if (pm.is_stream && scaled_span > 0) {
                float stream_center = anchor + pat_center_offset;
                float hold_x = std::clamp(1.0f - stream_center, 0.05f, 0.95f);

                // Only emit if hold_x is not inside any currently active interval.
                bool hold_free = true;
                for (auto& a : active) {
                    if (hold_x >= a.lo - 0.05f && hold_x <= a.hi + 0.05f) {
                        hold_free = false; break;
                    }
                }
                // long hold on the other side
                if (hold_x >= anchor + pm.lo - 0.05f && hold_x <= anchor + pm.hi + 0.05f)
                    hold_free = false;

                if (hold_free) {
                    note_list.push_back({
                        {"type",     1},           // long hold
                        {"id",       id++},
                        {"tick",     beat_tick},
                        {"x",        hold_x},
                        {"duration", scaled_span}
                    });
                    tick_counts[beat_tick]++;      // count the hold start tick
                }
            }

            // Register as active and update spatial continuity state.
            active.push_back({anchor + pm.lo, anchor + pm.hi,
                              beat_tick + scaled_span, pm.is_stream});
            prev_center = anchor + pat_center_offset;
            has_prev    = true;
            next_mirror = !next_mirror;
            stream_streak = pm.is_stream ? stream_streak + 1 : 0;
            placed = true;
        }
    }

    return note_list;
}


int main(int argc, char *argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: bpmdetect <file.wav>" << std::endl;
        return 1;
    }

    try {
        AudioInfo audio = detectAudio(argv[1]);

        std::cout << "BPM: " << audio.bpm << std::endl;
        std::cout << "Duration: " << audio.duration_sec << "s" << std::endl;


        nlohmann::json chart;
        chart["bpm"] = audio.bpm;
        chart["time_base"] = 480;
        chart["start_offset_time"] = 0;
        chart["length"] = audio.duration_sec;

        int beats_per_page = 4;
        chart["page_list"] = buildPageList(audio.bpm, audio.duration_sec, chart["time_base"], beats_per_page);

        // Load patterns.json
        std::ifstream patterns_file("patterns.json");
        nlohmann::json patterns_json;
        patterns_file >> patterns_json;

        chart["note_list"] = buildNoteList(audio.bpm, audio.duration_sec, patterns_json, chart["time_base"], beats_per_page);
        // chart["note_list"] = buildNoteListOLD(audio.bpm, audio.duration_sec);

        // std::cout << chart.dump(2) << std::endl;

        std::string input(argv[1]);

        std::string filename = input.substr(input.find_last_of("/\\") + 1);
        std::string stem = filename.substr(0, filename.find_last_of('.'));

        std::filesystem::create_directories("charts");
        std::string outpath = "charts/" + stem + ".json";

        std::ofstream out(outpath);
        out << chart.dump(2);
        out.close();

        std::cout << "Saved " << outpath << std::endl;
    } catch (const std::exception &e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}