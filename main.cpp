#include <soundtouch/SoundTouch.h>
#include <soundtouch/BPMDetect.h>

#include <vector>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <random>

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
        float lo, hi;   // relative x extent (first-note x = 0)
        int   span;     // last tick (unscaled)
    };
    std::vector<PatternMeta> meta;
    meta.reserve(pool.size());
    for (auto& p : pool) {
        auto [lo, hi] = patternXExtent(p);
        meta.push_back({lo, hi, patternSpan(p)});
    }

    // precompute page directions
    auto directionAt = [&](int tick) -> int {
        int page = tick / ticks_per_page;
        // buildPageList starts direction at -1 and flips each page
        return (page % 2 == 0) ? -1 : 1;
    };

    // Walk beats, placing patterns spatially ────────────────────────────
    // Active placements: track which x-intervals are occupied and until when.
    struct Active {
        float lo, hi;      // absolute x interval
        int   ends_at;     // tick at which this pattern finishes
    };
    std::vector<Active> active;

    const float X_GAP   = 0.05f;  // minimum gap between patterns in x
    const float X_MAX   = 0.9f;   // 0.9*screen width

    std::mt19937 rng(42069);
    std::uniform_int_distribution<int> pickPat(0, (int)pool.size() - 1);

    nlohmann::json note_list = nlohmann::json::array();
    int id = 0;

    for (int beat_tick = 0; beat_tick < total_ticks; beat_tick += time_base) {
        // Remove patterns that have ended
        active.erase(std::remove_if(active.begin(), active.end(),
            [&](const Active& a){ return a.ends_at <= beat_tick; }),
            active.end());

        // Collect free x-intervals (gaps between / around active patterns)
        // Sort active by lo
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

        if (free_segs.empty()) continue; // no room at all this beat

        // Try a random pattern; retry a few times if it doesn't fit
        const int MAX_TRIES = 5;
        bool placed = false;
        for (int attempt = 0; attempt < MAX_TRIES && !placed; ++attempt) {
            int pi = pickPat(rng);
            PatternMeta& pm = meta[pi];
            float width  = pm.hi - pm.lo;  // total x span of pattern

            // Find free segments wide enough
            std::vector<int> candidates;
            for (int si = 0; si < (int)free_segs.size(); ++si) {
                auto [fs, fe] = free_segs[si];
                if (fe - fs >= width + 0.2f)
                    candidates.push_back(si);
            }
            if (candidates.empty()) continue;

            // Pick a random candidate segment
            int si = candidates[rng() % candidates.size()];
            auto [fs, fe] = free_segs[si];

            // Random anchor within the segment so pattern fits
            // anchor = absolute x of pattern's first note (offset 0)
            // pattern spans [anchor + pm.lo, anchor + pm.hi]
            // must have: anchor + pm.lo >= fs  →  anchor >= fs - pm.lo
            //            anchor + pm.hi <= fe  →  anchor <= fe - pm.hi
            float anchor_min = fs - pm.lo;
            float anchor_max = fe - pm.hi;
            std::uniform_real_distribution<float> pickX(anchor_min, anchor_max);
            float anchor = pickX(rng);

            // ── Emit notes ───────────────────────────────────────────────────
            int direction    = directionAt(beat_tick);
            int unscaled_span = pm.span;
            int scaled_span  = unscaled_span * scale;

            const nlohmann::json& notes = pool[pi];
            int n_notes = (int)notes.size();

            for (int ni = 0; ni < n_notes; ++ni) {
                // When direction == -1, reverse tick order within the pattern:
                // a note at tick T becomes tick (span - T) so the pattern
                // plays "upside-down" along the scanline.
                int src = (direction == -1) ? (n_notes - 1 - ni) : ni;
                nlohmann::json note = notes[src];

                auto transformTick = [&](int t) -> int {
                    int scaled = t * scale;
                    return beat_tick + (direction == -1 ? scaled_span - scaled : scaled);
                };

                if (note.contains("nodes")) {
                    // Drag note: transform each node
                    auto& nodes = note["nodes"];
                    // If reversed, also reverse node order within the drag
                    if (direction == -1) {
                        std::reverse(nodes.begin(), nodes.end());
                    }
                    for (auto& node : nodes) {
                        node["tick"] = transformTick((int)node["tick"]);
                        node["x"]    = anchor + (float)node["x"];
                    }
                } else {
                    int orig_tick     = note["tick"];
                    int orig_duration = note.value("duration", 0);
                    note["tick"]      = transformTick(orig_tick);
                    note["duration"]  = orig_duration * scale;
                    note["x"]         = anchor + (float)note["x"];
                }

                note["id"] = id++;
                note_list.push_back(note);
            }

            // Register as active
            active.push_back({anchor + pm.lo, anchor + pm.hi,
                              beat_tick + scaled_span});
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