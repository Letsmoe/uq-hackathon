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

float detectBPM(const std::vector<float>& mono, int sample_rate) {
    // Compute energy envelope (RMS over windows)
    const int window_size = 1024;
    std::vector<float> energy;
    for (int i = 0; i + window_size < (int)mono.size(); i += window_size) {
        float sum = 0;
        for (int j = 0; j < window_size; j++)
            sum += mono[i + j] * mono[i + j];
        energy.push_back(std::sqrt(sum / window_size));
    }

    // Autocorrelation on energy envelope
    int n = energy.size();
    float energy_rate = (float)sample_rate / window_size;

    int min_lag = (int)(energy_rate * 60.0f / 200.0f); // 200 BPM max
    int max_lag = (int)(energy_rate * 60.0f / 50.0f);  // 50 BPM min

    std::vector<float> autocorr(max_lag + 1, 0);
    for (int lag = min_lag; lag <= max_lag; lag++) {
        float sum = 0;
        for (int i = 0; i + lag < n; i++)
            sum += energy[i] * energy[i + lag];
        autocorr[lag] = sum;
    }

    // Find peak lag
    int best_lag = min_lag;
    float best_val = 0;
    for (int lag = min_lag; lag <= max_lag; lag++) {
        if (autocorr[lag] > best_val) {
            best_val = autocorr[lag];
            best_lag = lag;
        }
    }

    float bpm = 60.0f * energy_rate / best_lag;

    while (bpm > 0 && bpm > 200) bpm /= 2;
    while (bpm > 0 && bpm < 50)  bpm *= 2;

    return bpm;
}

AudioInfo detectAudio(const char* path) {
    SF_INFO info;
    SNDFILE* file = sf_open(path, SFM_READ, &info);
    if (!file) throw std::runtime_error("Could not open file");

    const int frames_per_read = 1024;
    std::vector<float> buffer(frames_per_read * info.channels);
    std::vector<float> mono;

    // Skip first and last 10%
    sf_seek(file, info.frames * 0.1, SEEK_SET);
    long max_frames  = (long)(info.frames * 0.8);
    long total_frames = 0;
    int frames;

    while (total_frames < max_frames &&
           (frames = sf_readf_float(file, buffer.data(), frames_per_read)) > 0) {
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
        .bpm          = bpm,
        .duration_sec = (float)info.frames / info.samplerate
    };
}

nlohmann::json buildPageList(float bpm,
                             float duration_sec,
                             int time_base      = 480,
                             int beats_per_page = 4) {
    const int   ticks_per_page   = time_base * beats_per_page;
    const float seconds_per_tick = 60.0f / (bpm * time_base);
    const int   total_ticks      = (int)(duration_sec / seconds_per_tick);

    nlohmann::json page_list = nlohmann::json::array();
    int tick      = 0;
    int direction = -1;
    while (tick < total_ticks) {
        page_list.push_back({
            {"start_tick",        tick},
            {"end_tick",          tick + ticks_per_page},
            {"scan_line_direction", direction}
        });
        tick      += ticks_per_page;
        direction *= -1;
    }

    return page_list;
}

// ── pattern-analysis helpers ─────────────────────────────────────────────────

// Normalise a raw pattern entry into a flat vector of note arrays.
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
                if (!k.empty() && k[0] == '_') continue;
                collectPatterns(v, pool);
            }
        }
    }
}

// Returns [min_x, max_x] across all notes/nodes in a pattern.
static std::pair<float, float> patternXExtent(const nlohmann::json& notes)
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

// Returns the last tick in a pattern (before scaling).
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
static std::vector<std::pair<float, float>> simultaneousPairs(const nlohmann::json& notes)
{
    std::map<int, std::vector<float>> by_tick;
    for (auto& n : notes) {
        if (!n.contains("nodes"))
            by_tick[(int)n["tick"]].push_back((float)n["x"]);
    }
    std::vector<std::pair<float, float>> pairs;
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

// buildNoteList internal types

struct PatternMeta {
    float lo, hi;                                    // relative x extent
    int   span;                                      // last tick (unscaled)
    bool  is_stream;                                 // has simultaneous tap notes
    std::vector<std::pair<float, float>> sim_pairs;  // relative-x pairs at same tick
};

struct ActivePattern {
    float lo, hi;   // absolute x interval
    int   ends_at;  // tick at which this pattern finishes
    bool  is_stream;// true → no tap patterns may be placed while this runs
};

// helper funs

// Build the pattern pool and its precomputed metadata from patterns_json.
static void buildPatternPool(const nlohmann::json& patterns_json,
                             std::vector<nlohmann::json>& pool,
                             std::vector<PatternMeta>& meta)
{
    for (auto& [level_name, level] : patterns_json["patterns"].items()) {
        for (auto& [key, val] : level.items()) {
            if (!key.empty() && key[0] == '_') continue;
            collectPatterns(val, pool);
        }
    }

    meta.reserve(pool.size());
    for (auto& p : pool) {
        auto [lo, hi] = patternXExtent(p);
        meta.push_back({lo, hi, patternSpan(p),
                        isStreamPattern(p), simultaneousPairs(p)});
    }
}

// Compute the free x-segments not covered by currently active patterns.
static std::vector<std::pair<float, float>> computeFreeSegments(
    const std::vector<ActivePattern>& active,
    float x_start, float x_end, float x_gap)
{
    std::vector<std::pair<float, float>> occupied;
    for (auto& a : active) occupied.push_back({a.lo, a.hi});
    std::sort(occupied.begin(), occupied.end());

    std::vector<std::pair<float, float>> free_segs;
    float cursor = x_start;
    for (auto& [olo, ohi] : occupied) {
        float gap_start = cursor;
        float gap_end   = olo - x_gap;
        if (gap_end > gap_start + 0.2f)
            free_segs.push_back({gap_start, gap_end});
        cursor = ohi + x_gap;
    }
    if (cursor < x_end - 0.2f)
        free_segs.push_back({cursor, x_end});

    return free_segs;
}

// Choose the x anchor for a pattern within the available free segments,
// taking into account the preferred center (mirror or drift from previous).
// Returns false if no valid placement exists.
static bool chooseAnchor(
    const PatternMeta& pm,
    const std::vector<std::pair<float, float>>& free_segs,
    float preferred_center,
    std::mt19937& rng,
    float& anchor_out)
{
    float pat_center_offset = (pm.lo + pm.hi) / 2.0f;
    float preferred_anchor  = preferred_center - pat_center_offset;

    // Find free segments wide enough to hold this pattern.
    std::vector<int> candidates;
    for (int si = 0; si < (int)free_segs.size(); ++si) {
        auto [fs, fe] = free_segs[si];
        if (fe - fs >= (pm.hi - pm.lo) + 0.2f)
            candidates.push_back(si);
    }
    if (candidates.empty()) return false;

    // Pick the candidate segment closest to preferred_anchor.
    int   best_si   = candidates[0];
    float best_dist = std::numeric_limits<float>::max();
    for (int si : candidates) {
        auto [fs, fe] = free_segs[si];
        float a_min   = fs - pm.lo;
        float a_max   = fe - pm.hi;
        float clamped = std::clamp(preferred_anchor, a_min, a_max);
        float dist    = std::abs(clamped - preferred_anchor);
        if (dist < best_dist) { best_dist = dist; best_si = si; }
    }

    auto [fs, fe]    = free_segs[best_si];
    float anchor_min = fs - pm.lo;
    float anchor_max = fe - pm.hi;

    // Clamp preferred anchor into the valid range, then add a small jitter.
    float anchor_base  = std::clamp(preferred_anchor, anchor_min, anchor_max);
    float jitter_range = std::min(0.1f, (anchor_max - anchor_min) * 0.5f);
    std::uniform_real_distribution<float> jitter(-jitter_range, jitter_range);
    anchor_out = std::clamp(anchor_base + jitter(rng), anchor_min, anchor_max);

    return true;
}

// Enforce close-or-mirrored constraint for simultaneous note pairs in streams.
// May adjust anchor_inout or return false if the constraint cannot be met.
static bool enforceStreamPairConstraint(
    const PatternMeta& pm,
    float anchor_min, float anchor_max,
    float& anchor_inout)
{
    if (!pm.is_stream || pm.sim_pairs.empty()) return true;

    for (auto& [x1r, x2r] : pm.sim_pairs) {
        float diff     = std::abs(x1r - x2r);
        float sum      = (anchor_inout + x1r) + (anchor_inout + x2r);
        bool close     = diff < 0.4f;
        bool mirrored  = std::abs(sum - 1.0f) < 0.25f;
        if (!close && !mirrored) {
            // Try to fix: compute anchor that mirrors the first pair around 0.5.
            // (anchor + x1r) + (anchor + x2r) = 1.0  →  anchor = (1 - x1r - x2r) / 2
            float mirror_anchor = (1.0f - x1r - x2r) / 2.0f;
            if (mirror_anchor >= anchor_min && mirror_anchor <= anchor_max)
                anchor_inout = mirror_anchor;
            else
                return false; // can't satisfy constraint in this segment
        }
    }
    return true;
}

// Check whether adding the candidate pattern would exceed the per-tick density
// cap (max 3 notes at any single tick).
static bool checkTickDensity(
    const nlohmann::json& notes,
    const std::map<int, int>& tick_counts,
    const std::function<int(int)>& transform_tick)
{
    std::map<int, int> candidate_counts;
    for (auto& note : notes) {
        if (note.contains("nodes")) {
            for (auto& n : note["nodes"])
                candidate_counts[transform_tick((int)n["tick"])]++;
        } else {
            candidate_counts[transform_tick((int)note["tick"])]++;
        }
    }
    for (auto& [t, cnt] : candidate_counts) {
        if (tick_counts.count(t) && tick_counts.at(t) + cnt > 3)
            return false;
    }
    return true;
}

// Emit all notes from the chosen pattern into note_list, applying the tick
// transform and x offset, and updating tick_counts.
static void emitPatternNotes(
    const nlohmann::json& notes,
    int direction,
    float anchor,
    int scale,
    const std::function<int(int)>& transform_tick,
    nlohmann::json& note_list,
    std::map<int, int>& tick_counts,
    int& id)
{
    int n_notes = (int)notes.size();
    for (int ni = 0; ni < n_notes; ++ni) {
        int src = (direction == -1) ? (n_notes - 1 - ni) : ni;
        nlohmann::json note = notes[src];

        if (note.contains("nodes")) {
            auto& nodes = note["nodes"];
            if (direction == -1)
                std::reverse(nodes.begin(), nodes.end());
            for (auto& node : nodes) {
                int t    = transform_tick((int)node["tick"]);
                node["tick"] = t;
                node["x"]   = anchor + (float)node["x"];
                tick_counts[t]++;
            }
        } else {
            int orig_tick     = note["tick"];
            int orig_duration = note.value("duration", 0);
            int t             = transform_tick(orig_tick);
            note["tick"]      = t;
            note["duration"]  = orig_duration * scale;
            note["x"]         = anchor + (float)note["x"];
            tick_counts[t]++;
        }

        note["id"] = id++;
        note_list.push_back(note);
    }
}

// Optionally emit a long hold note on the opposite side of a stream pattern
// This balances visual load and gives the other hand gentle load
static void emitStreamCounterHold(
    const PatternMeta& pm,
    float anchor,
    float pat_center_offset,
    int beat_tick,
    int scaled_span,
    const std::vector<ActivePattern>& active,
    nlohmann::json& note_list,
    std::map<int, int>& tick_counts,
    int& id)
{
    if (!pm.is_stream || scaled_span <= 0) return;

    float stream_center = anchor + pat_center_offset;
    float hold_x        = std::clamp(1.0f - stream_center, 0.05f, 0.95f);

    // Only emit if hold_x is not inside any currently active interval.
    bool hold_free = true;
    for (auto& a : active) {
        if (hold_x >= a.lo - 0.05f && hold_x <= a.hi + 0.05f) {
            hold_free = false; break;
        }
    }
    if (hold_x >= anchor + pm.lo - 0.05f && hold_x <= anchor + pm.hi + 0.05f)
        hold_free = false;

    if (hold_free) {
        note_list.push_back({
            {"type",     1},
            {"id",       id++},
            {"tick",     beat_tick},
            {"x",        hold_x},
            {"duration", scaled_span}
        });
        tick_counts[beat_tick]++;
    }
}


nlohmann::json buildNoteList(float bpm, float duration_sec,
                             const nlohmann::json& patterns_json,
                             int time_base      = 480,
                             int scale = 4)
{
    const float seconds_per_tick = 60.0f / (bpm * time_base);
    const int   total_ticks      = (int)(duration_sec / seconds_per_tick);
    const int   ticks_per_page   = time_base * scale;

    // Build pattern pool and precomputed metadata.
    std::vector<nlohmann::json> pool;
    std::vector<PatternMeta>    meta;
    buildPatternPool(patterns_json, pool, meta);

    // Page-direction helper: matches the alternating direction in buildPageList.
    auto direction_at = [&](int tick) -> int {
        int page = tick / ticks_per_page;
        return (page % 2 == 0) ? -1 : 1;
    };

    const float X_START = 0.1f;
    const float X_END   = 0.9f;
    const float X_GAP   = 0.05f;

    std::mt19937 rng(42069);
    std::uniform_int_distribution<int> pick_pat(0, (int)pool.size() - 1);

    // Per-tick note density cap (max 3 notes at any single tick).
    std::map<int, int> tick_counts;

    // Spatial continuity state.
    float prev_center  = 0.5f;
    bool  has_prev     = false;
    bool  next_mirror  = true;
    int   stream_streak = 0;

    std::vector<ActivePattern> active;
    nlohmann::json note_list = nlohmann::json::array();
    int id = 0;

    for (int beat_tick = 0; beat_tick < total_ticks; beat_tick += time_base) {
        // Expire patterns that have finished.
        active.erase(std::remove_if(active.begin(), active.end(),
            [&](const ActivePattern& a) { return a.ends_at <= beat_tick; }),
            active.end());

        // While a stream is active, only holds/drags may be placed alongside it.
        bool stream_active = std::any_of(active.begin(), active.end(),
            [](const ActivePattern& a) { return a.is_stream; });

        auto free_segs = computeFreeSegments(active, X_START, X_END, X_GAP);
        if (free_segs.empty()) continue;

        const int max_tries = 8;
        bool placed = false;

        for (int attempt = 0; attempt < max_tries && !placed; ++attempt) {
            int          pi = pick_pat(rng);
            PatternMeta& pm = meta[pi];

            // Throttle streams after 4 consecutive beats.
            if (pm.is_stream && stream_streak >= 4) continue;

            // Block tap patterns while a stream is running.
            if (stream_active && hasTapNotes(pool[pi])) continue;

            // Compute preferred center (mirror or gradient of previous placement).
            float preferred_center;
            if (!has_prev) {
                preferred_center = 0.5f;
            } else if (next_mirror) {
                preferred_center = 1.0f - prev_center;
            } else {
                std::uniform_real_distribution<float> drift(-0.15f, 0.15f);
                preferred_center = prev_center + drift(rng);
            }

            float anchor;
            if (!chooseAnchor(pm, free_segs, preferred_center, rng, anchor))
                continue;

            // Compute valid anchor range for the chosen segment (needed by the
            // stream-pair constraint check).
            float pat_center_offset = (pm.lo + pm.hi) / 2.0f;
            float preferred_anchor  = preferred_center - pat_center_offset;
            // Recompute anchor_min / anchor_max from the chosen segment.
            // (chooseAnchor already clamped anchor into this range.)
            int best_si = 0;
            float best_dist = std::numeric_limits<float>::max();
            for (int si = 0; si < (int)free_segs.size(); ++si) {
                auto [fs, fe] = free_segs[si];
                if (fe - fs < (pm.hi - pm.lo) + 0.2f) continue;
                float a_min   = fs - pm.lo;
                float a_max   = fe - pm.hi;
                float clamped = std::clamp(preferred_anchor, a_min, a_max);
                float dist    = std::abs(clamped - preferred_anchor);
                if (dist < best_dist) { best_dist = dist; best_si = si; }
            }
            auto [fs, fe]    = free_segs[best_si];
            float anchor_min = fs - pm.lo;
            float anchor_max = fe - pm.hi;

            if (!enforceStreamPairConstraint(pm, anchor_min, anchor_max, anchor))
                continue;

            int direction    = direction_at(beat_tick);
            int unscaled_span = pm.span;
            int scaled_span  = unscaled_span * scale;

            auto transform_tick = [&](int t) -> int {
                int scaled = t * scale;
                return beat_tick + (direction == -1 ? scaled_span - scaled : scaled);
            };

            if (!checkTickDensity(pool[pi], tick_counts, transform_tick))
                continue;

            emitPatternNotes(pool[pi], direction, anchor, scale,
                             transform_tick, note_list, tick_counts, id);

            emitStreamCounterHold(pm, anchor, pat_center_offset,
                                  beat_tick, scaled_span,
                                  active, note_list, tick_counts, id);

            // Register as active and update spatial continuity state.
            active.push_back({anchor + pm.lo, anchor + pm.hi,
                              beat_tick + scaled_span, pm.is_stream});
            prev_center   = anchor + pat_center_offset;
            has_prev      = true;
            next_mirror   = !next_mirror;
            stream_streak = pm.is_stream ? stream_streak + 1 : 0;
            placed        = true;
        }
    }

    return note_list;
}


int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: bpmdetect <file.wav>" << std::endl;
        return 1;
    }

    try {
        AudioInfo audio = detectAudio(argv[1]);

        std::cout << "BPM: "      << audio.bpm          << std::endl;
        std::cout << "Duration: " << audio.duration_sec << "s" << std::endl;

        nlohmann::json chart;
        chart["audio_file"]        = argv[1];
        chart["bpm"]               = audio.bpm;
        chart["time_base"]         = 480;
        chart["start_offset_time"] = 0;
        chart["length"]            = audio.duration_sec;

        int beats_per_page = 4;
        chart["page_list"] = buildPageList(audio.bpm, audio.duration_sec,
                                           chart["time_base"], beats_per_page);

        std::ifstream patterns_file("patterns.json");
        nlohmann::json patterns_json;
        patterns_file >> patterns_json;

        chart["note_list"] = buildNoteList(audio.bpm, audio.duration_sec,
                                           patterns_json, chart["time_base"],
                                           beats_per_page);

        std::string input(argv[1]);
        std::string filename = input.substr(input.find_last_of("/\\") + 1);
        std::string stem     = filename.substr(0, filename.find_last_of('.'));

        std::filesystem::create_directories("charts");
        std::string out_path = "charts/" + stem + ".json";

        std::ofstream out(out_path);
        out << chart.dump(2);
        out.close();

        std::cout << "Saved " << out_path << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
