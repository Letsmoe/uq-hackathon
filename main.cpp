#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <map>
#include <random>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include <emscripten/emscripten.h>
#include "vendor/nlohmann/json.hpp"

// If vendor json.hpp locally instead, replace the above w/
// #include "vendor/nlohmann/json.hpp"

struct AudioInfo {
    float bpm;
    float duration_sec;
};

static char* copyStringToHeap(const std::string& str) {
    char* result = static_cast<char*>(std::malloc(str.size() + 1));
    if (!result) return nullptr;

    std::memcpy(result, str.c_str(), str.size() + 1);
    return result;
}

float detectBPM(const std::vector<float>& mono, int sampleRate) {
    if (mono.empty() || sampleRate <= 0) {
        return 0.0f;
    }

    const int windowSize = 1024;

    if ((int)mono.size() < windowSize * 4) {
        return 0.0f;
    }

    std::vector<float> energy;

    for (int i = 0; i + windowSize < (int)mono.size(); i += windowSize) {
        float sum = 0.0f;

        for (int j = 0; j < windowSize; j++) {
            sum += mono[i + j] * mono[i + j];
        }

        energy.push_back(std::sqrt(sum / windowSize));
    }

    int n = (int)energy.size();
    float energyRate = (float)sampleRate / windowSize;

    int minLag = (int)(energyRate * 60.0f / 200.0f);
    int maxLag = (int)(energyRate * 60.0f / 50.0f);

    minLag = std::max(1, minLag);
    maxLag = std::min(maxLag, n - 1);

    if (maxLag <= minLag) {
        return 0.0f;
    }

    std::vector<float> autocorr(maxLag + 1, 0.0f);

    for (int lag = minLag; lag <= maxLag; lag++) {
        float sum = 0.0f;

        for (int i = 0; i + lag < n; i++) {
            sum += energy[i] * energy[i + lag];
        }

        autocorr[lag] = sum;
    }

    int bestLag = minLag;
    float bestVal = 0.0f;

    for (int lag = minLag; lag <= maxLag; lag++) {
        if (autocorr[lag] > bestVal) {
            bestVal = autocorr[lag];
            bestLag = lag;
        }
    }

    if (bestLag <= 0 || bestVal <= 0.0f) {
        return 0.0f;
    }

    float bpm = 60.0f * energyRate / bestLag;

    while (bpm > 160.0f) bpm /= 2.0f;
    while (bpm > 0.0f && bpm < 50.0f) bpm *= 2.0f;

    return bpm;
}

AudioInfo detectAudioFromMono(const float* samples, int sampleCount, int sampleRate) {
    if (!samples || sampleCount <= 0 || sampleRate <= 0) {
        throw std::runtime_error("Invalid audio input");
    }

    int start = (int)(sampleCount * 0.1f);
    int end = (int)(sampleCount * 0.9f);

    if (end <= start) {
        start = 0;
        end = sampleCount;
    }

    std::vector<float> mono;
    mono.reserve(end - start);

    for (int i = start; i < end; ++i) {
        mono.push_back(samples[i]);
    }

    float bpm = detectBPM(mono, sampleRate);

    return {
        bpm,
        (float)sampleCount / sampleRate
    };
}

nlohmann::json buildPageList(
    float bpm,
    float durationSec,
    int timeBase = 480,
    int beatsPerPage = 4
) {
    nlohmann::json pageList = nlohmann::json::array();

    if (bpm <= 0.0f || durationSec <= 0.0f || timeBase <= 0 || beatsPerPage <= 0) {
        return pageList;
    }

    const int ticksPerPage = timeBase * beatsPerPage;
    const float secondsPerTick = 60.0f / (bpm * timeBase);
    const int totalTicks = (int)(durationSec / secondsPerTick);

    int tick = 0;
    int direction = -1;

    while (tick < totalTicks) {
        pageList.push_back({
            {"start_tick", tick},
            {"end_tick", tick + ticksPerPage},
            {"scan_line_direction", direction}
        });

        tick += ticksPerPage;
        direction *= -1;
    }

    return pageList;
}

static void collectPatterns(
    const nlohmann::json& val,
    std::vector<nlohmann::json>& pool
) {
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

static std::pair<float, float> patternXExtent(const nlohmann::json& notes) {
    float lo = 0.0f;
    float hi = 0.0f;

    for (auto& note : notes) {
        if (note.contains("nodes")) {
            for (auto& node : note["nodes"]) {
                float x = node.value("x", 0.0f);
                lo = std::min(lo, x);
                hi = std::max(hi, x);
            }
        } else {
            float x = note.value("x", 0.0f);
            lo = std::min(lo, x);
            hi = std::max(hi, x);
        }
    }

    return {lo, hi};
}

static int patternSpan(const nlohmann::json& notes) {
    int last = 0;

    for (auto& note : notes) {
        if (note.contains("nodes")) {
            for (auto& node : note["nodes"]) {
                last = std::max(last, node.value("tick", 0));
            }
        } else {
            int tick = note.value("tick", 0);
            int duration = note.value("duration", 0);
            last = std::max(last, tick + duration);
        }
    }

    return last;
}

static bool isStreamPattern(const nlohmann::json& notes) {
    std::set<int> seen;

    for (auto& note : notes) {
        if (note.contains("nodes")) continue;

        int tick = note.value("tick", 0);

        if (!seen.insert(tick).second) {
            return true;
        }
    }

    return false;
}

static std::vector<std::pair<float, float>> simultaneousPairs(const nlohmann::json& notes) {
    std::map<int, std::vector<float>> byTick;

    for (auto& note : notes) {
        if (!note.contains("nodes")) {
            int tick = note.value("tick", 0);
            float x = note.value("x", 0.0f);
            byTick[tick].push_back(x);
        }
    }

    std::vector<std::pair<float, float>> pairs;

    for (auto& [tick, xs] : byTick) {
        if (xs.size() >= 2) {
            pairs.push_back({xs[0], xs[1]});
        }
    }

    return pairs;
}

static bool hasTapNotes(const nlohmann::json& notes) {
    for (auto& note : notes) {
        if (!note.contains("nodes") && note.value("duration", 0) == 0) {
            return true;
        }
    }

    return false;
}

nlohmann::json buildNoteList(
    float bpm,
    float durationSec,
    const nlohmann::json& patternsJson,
    int timeBase = 480,
    int beatsPerPage = 4
) {
    nlohmann::json noteList = nlohmann::json::array();

    if (bpm <= 0.0f || durationSec <= 0.0f || timeBase <= 0 || beatsPerPage <= 0) {
        return noteList;
    }

    if (!patternsJson.contains("patterns") || !patternsJson["patterns"].is_object()) {
        return noteList;
    }

    const int scale = beatsPerPage;
    const float secondsPerTick = 60.0f / (bpm * timeBase);
    const int totalTicks = (int)(durationSec / secondsPerTick);
    const int ticksPerPage = timeBase * beatsPerPage;

    std::vector<nlohmann::json> pool;

    for (auto& [levelName, level] : patternsJson["patterns"].items()) {
        if (!level.is_object()) continue;

        for (auto& [key, val] : level.items()) {
            if (!key.empty() && key[0] == '_') continue;
            collectPatterns(val, pool);
        }
    }

    if (pool.empty()) {
        return noteList;
    }

    struct PatternMeta {
        float lo;
        float hi;
        int span;
        bool isStream;
        std::vector<std::pair<float, float>> simPairs;
    };

    std::vector<PatternMeta> meta;
    meta.reserve(pool.size());

    for (auto& pattern : pool) {
        auto [lo, hi] = patternXExtent(pattern);

        meta.push_back({
            lo,
            hi,
            patternSpan(pattern),
            isStreamPattern(pattern),
            simultaneousPairs(pattern)
        });
    }

    auto directionAt = [&](int tick) -> int {
        int page = tick / ticksPerPage;
        return (page % 2 == 0) ? -1 : 1;
    };

    struct Active {
        float lo;
        float hi;
        int endsAt;
        bool isStream;
    };

    std::vector<Active> active;

    const float X_GAP = 0.05f;
    const float X_MAX = 0.9f;

    // Seed combines the magic base with bpm and duration so every song gets
    // a distinct, reproducible sequence.
    std::mt19937 rng(42069u ^ (std::hash<float>{}(bpm) * 2654435761u)
                              ^ (std::hash<float>{}(durationSec) * 2246822519u));
    std::uniform_int_distribution<int> pick_pat(0, (int)pool.size() - 1);

    std::map<int, int> tickCounts;

    float prevCenter = 0.5f;
    bool hasPrev = false;
    bool nextMirror = true;

    int streamStreak = 0;
    int id = 0;

    for (int beatTick = 0; beatTick < totalTicks; beatTick += timeBase) {
        active.erase(
            std::remove_if(
                active.begin(),
                active.end(),
                [&](const Active& a) {
                    return a.endsAt <= beatTick;
                }
            ),
            active.end()
        );

        bool streamActive = std::any_of(
            active.begin(),
            active.end(),
            [](const Active& a) {
                return a.isStream;
            }
        );

        std::vector<std::pair<float, float>> occupied;

        for (auto& a : active) {
            occupied.push_back({a.lo, a.hi});
        }

        std::sort(occupied.begin(), occupied.end());

        std::vector<std::pair<float, float>> freeSegs;
        float cursor = 0.1f;

        for (auto& [olo, ohi] : occupied) {
            float gapStart = cursor;
            float gapEnd = olo - X_GAP;

            if (gapEnd > gapStart + 0.2f) {
                freeSegs.push_back({gapStart, gapEnd});
            }

            cursor = ohi + X_GAP;
        }

        if (cursor < X_MAX - 0.2f) {
            freeSegs.push_back({cursor, X_MAX});
        }

        if (freeSegs.empty()) {
            continue;
        }

        const int MAX_TRIES = 8;
        bool placed = false;

        for (int attempt = 0; attempt < MAX_TRIES && !placed; ++attempt) {
            int          pi = pick_pat(rng);
            PatternMeta& pm = meta[pi];

            if (pm.isStream && streamStreak >= 4) {
                continue;
            }

            if (streamActive && hasTapNotes(pool[pi])) {
                continue;
            }

            float patCenterOffset = (pm.lo + pm.hi) / 2.0f;
            float preferredCenter;

            if (!hasPrev) {
                // First pattern: pick a random edge-biased start (left or right third)
                std::uniform_int_distribution<int> side(0, 1);
                preferredCenter = side(rng) == 0 ? 0.2f : 0.8f;
            } else if (nextMirror) {
                // Hard mirror: flip to the opposite side
                preferredCenter = 1.0f - prevCenter;
            } else {
                // Drift toward whichever edge we are closest to, with a strong pull
                float edgeTarget = (prevCenter < 0.5f) ? 0.15f : 0.85f;
                std::uniform_real_distribution<float> drift(0.0f, 1.0f);
                // 60% pull toward edge, 40% random nudge
                float t = drift(rng);
                preferredCenter = prevCenter + (edgeTarget - prevCenter) * 0.6f
                                  + (t - 0.5f) * 0.2f;
            }
            // Keep within playfield bounds
            preferredCenter = std::clamp(preferredCenter, 0.15f, 0.85f);

            float preferredAnchor = preferredCenter - patCenterOffset;

            std::vector<int> candidates;

            for (int si = 0; si < (int)freeSegs.size(); ++si) {
                auto [fs, fe] = freeSegs[si];

                if (fe - fs >= (pm.hi - pm.lo) + 0.2f) {  // min gap 0.2
                    candidates.push_back(si);
                }
            }

            if (candidates.empty()) {
                continue;
            }

            int bestSi = candidates[0];
            float bestDist = std::numeric_limits<float>::max();

            for (int si : candidates) {
                auto [fs, fe] = freeSegs[si];

                float anchorMin = fs - pm.lo;
                float anchorMax = fe - pm.hi;
                float clamped = std::clamp(preferredAnchor, anchorMin, anchorMax);
                float dist = std::abs(clamped - preferredAnchor);

                if (dist < bestDist) {
                    bestDist = dist;
                    bestSi = si;
                }
            }

            auto [fs, fe] = freeSegs[bestSi];

            float anchorMin = fs - pm.lo;
            float anchorMax = fe - pm.hi;

            if (anchorMax < anchorMin) {
                continue;
            }

            float anchorBase = std::clamp(preferredAnchor, anchorMin, anchorMax);
            float jitterRange = std::min(0.15f, (anchorMax - anchorMin) * 0.5f);

            std::uniform_real_distribution<float> jitter(-jitterRange, jitterRange);

            float anchor = std::clamp(anchorBase + jitter(rng), anchorMin, anchorMax);

            if (pm.isStream && !pm.simPairs.empty()) {
                bool pairsOk = true;

                for (auto& [x1r, x2r] : pm.simPairs) {
                    float diff = std::abs(x1r - x2r);
                    float sum = (anchor + x1r) + (anchor + x2r);

                    bool close = diff < 0.4f;
                    bool mirrored = std::abs(sum - 1.0f) < 0.25f;

                    if (!close && !mirrored) {
                        pairsOk = false;
                        break;
                    }
                }

                if (!pairsOk) {
                    auto& [x1r, x2r] = pm.simPairs[0];
                    float mirrorAnchor = (1.0f - x1r - x2r) / 2.0f;

                    if (mirrorAnchor >= anchorMin && mirrorAnchor <= anchorMax) {
                        anchor = mirrorAnchor;
                    } else {
                        continue;
                    }
                }
            }

            int direction = directionAt(beatTick);
            int unscaledSpan = pm.span;
            int scaledSpan = unscaledSpan * scale;

            auto transform_tick = [&](int t) -> int {
                int scaled = t * scale;
                return beatTick + (direction == -1 ? scaledSpan - scaled : scaled);
            };

            bool tickOk = true;

            {
                std::map<int, int> candidateCounts;

                for (auto& note : pool[pi]) {
                    if (note.contains("nodes")) {
                        for (auto& node : note["nodes"]) {
                            candidateCounts[transform_tick(node.value("tick", 0))]++;
                        }
                    } else {
                        candidateCounts[transform_tick(note.value("tick", 0))]++;
                    }
                }

                for (auto& [tick, count] : candidateCounts) {
                    if (tickCounts[tick] + count > 3) {
                        tickOk = false;
                        break;
                    }
                }
            }

            if (!tickOk) {
                continue;
            }

            const nlohmann::json& notes = pool[pi];
            int noteCount = (int)notes.size();

            for (int ni = 0; ni < noteCount; ++ni) {
                int src = (direction == -1) ? (noteCount - 1 - ni) : ni;

                nlohmann::json note = notes[src];

                if (note.contains("nodes")) {
                    auto& nodes = note["nodes"];

                    if (direction == -1) {
                        std::reverse(nodes.begin(), nodes.end());
                    }

                    for (auto& node : nodes) {
                        int t = transform_tick(node.value("tick", 0));

                        node["tick"] = t;
                        node["x"] = anchor + node.value("x", 0.0f);

                        tickCounts[t]++;
                    }
                } else {
                    int origTick = note.value("tick", 0);
                    int origDuration = note.value("duration", 0);

                    int t = transform_tick(origTick);

                    note["tick"] = t;
                    note["duration"] = origDuration * scale;
                    note["x"] = anchor + note.value("x", 0.0f);

                    tickCounts[t]++;
                }

                note["id"] = id++;
                noteList.push_back(note);
            }

            if (pm.isStream && scaledSpan > 0) {
                float streamCenter = anchor + patCenterOffset;
                float holdX = std::clamp(1.0f - streamCenter, 0.05f, 0.95f);

                bool holdFree = true;

                for (auto& a : active) {
                    if (holdX >= a.lo - 0.05f && holdX <= a.hi + 0.05f) {
                        holdFree = false;
                        break;
                    }
                }

                if (holdX >= anchor + pm.lo - 0.05f && holdX <= anchor + pm.hi + 0.05f) {
                    holdFree = false;
                }

                if (holdFree) {
                    noteList.push_back({
                        {"type", 1},
                        {"id", id++},
                        {"tick", beatTick},
                        {"x", holdX},
                        {"duration", scaledSpan}
                    });

                    tickCounts[beatTick]++;
                }
            }

            active.push_back({
                anchor + pm.lo,
                anchor + pm.hi,
                beatTick + scaledSpan,
                pm.isStream
            });

            prevCenter = anchor + patCenterOffset;
            hasPrev = true;
            nextMirror = !nextMirror;
            streamStreak = pm.isStream ? streamStreak + 1 : 0;

            placed = true;
        }
    }

    return noteList;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
char* analyze_audio_json(
    const float* monoSamples,
    int sampleCount,
    int sampleRate,
    const char* patternsJsonString,
    int timeBase,
    int beatsPerPage
) {
    try {
        if (!patternsJsonString) {
            throw std::runtime_error("Missing patterns JSON");
        }

        if (timeBase <= 0) {
            timeBase = 480;
        }

        if (beatsPerPage <= 0) {
            beatsPerPage = 4;
        }

        AudioInfo audio = detectAudioFromMono(
            monoSamples,
            sampleCount,
            sampleRate
        );

        nlohmann::json patternsJson = nlohmann::json::parse(patternsJsonString);

        nlohmann::json chart;

        chart["bpm"] = audio.bpm;
        chart["time_base"] = timeBase;
        chart["start_offset_time"] = 0;
        chart["length"]            = audio.duration_sec;

        chart["page_list"] = buildPageList(
            audio.bpm,
            audio.duration_sec,
            timeBase,
            beatsPerPage
        );

        chart["note_list"] = buildNoteList(
            audio.bpm,
            audio.duration_sec,
            patternsJson,
            timeBase,
            beatsPerPage
        );

        return copyStringToHeap(chart.dump());
    } catch (const std::exception& e) {
        nlohmann::json error;

        error["error"] = e.what();

        return copyStringToHeap(error.dump());
    }
}

EMSCRIPTEN_KEEPALIVE
void free_result(char* ptr) {
    std::free(ptr);
}

}