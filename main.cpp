#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <limits>
#include <map>
#include <random>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define CHART_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define CHART_EXPORT
#endif

#include "vendor/nlohmann/json.hpp"

// Tick resolution the patterns in patterns.json are authored against.
static const int PATTERN_TIME_BASE = 240;

// Notes are drawn at x * screenWidth, so the outer margins keep the note
// graphics fully on screen.
static const float PLAYFIELD_MIN_X = 0.08f;
static const float PLAYFIELD_MAX_X = 0.92f;

// Horizontal clearance between two patterns that are on screen together.
static const float PATTERN_X_GAP = 0.08f;

static const float DENSITY_WINDOW_SEC = 4.0f;
static const int ENERGY_WINDOW = 1024;

// Musical intensity is measured this many times per beat, which is also the
// finest grid a pattern may start on.
static const int INTENSITY_SUBDIVISION = 4;

// A pattern may start no further apart than this, so slow tracks subdivide the
// beat instead of leaving multi-second holes.
static const float MAX_SLOT_SEC = 0.35f;
static const int MAX_STRETCH = 8;
static const int PATTERN_TRIES = 12;
static const int ANCHOR_TRIES = 6;

static char* copyStringToHeap(const std::string& str) {
    char* result = static_cast<char*>(std::malloc(str.size() + 1));
    if (!result) return nullptr;

    std::memcpy(result, str.c_str(), str.size() + 1);
    return result;
}

// ── Audio analysis ──────────────────────────────────────────────────────────

struct AudioAnalysis {
    float bpm;
    float durationSec;
    float beatOffsetSec;
    // How busy the track is, 0..1, sampled INTENSITY_SUBDIVISION times per beat
    // starting at beatOffsetSec.
    std::vector<float> gridIntensity;
};

static std::vector<float> computeEnergyEnvelope(const std::vector<float>& mono) {
    std::vector<float> energy;

    for (size_t i = 0; i + ENERGY_WINDOW < mono.size(); i += ENERGY_WINDOW) {
        float sum = 0.0f;

        for (int j = 0; j < ENERGY_WINDOW; ++j) {
            sum += mono[i + j] * mono[i + j];
        }

        energy.push_back(std::sqrt(sum / ENERGY_WINDOW));
    }

    return energy;
}

/** Half-wave rectified energy difference: rises only where the track gets louder. */
static std::vector<float> computeOnsetEnvelope(const std::vector<float>& energy) {
    std::vector<float> onset(energy.size(), 0.0f);

    for (size_t i = 1; i < energy.size(); ++i) {
        onset[i] = std::max(0.0f, energy[i] - energy[i - 1]);
    }

    return onset;
}

static float percentileOf(std::vector<float> values, float fraction) {
    if (values.empty()) {
        return 0.0f;
    }

    size_t index = (size_t)(fraction * (float)(values.size() - 1));
    std::nth_element(values.begin(), values.begin() + index, values.end());

    return values[index];
}

/** Scales values so that the given percentile maps to 1.0, then clamps to 0..1. */
static void normalizeByPercentile(std::vector<float>& values, float fraction) {
    float reference = percentileOf(values, fraction);

    if (reference <= 0.0f) {
        return;
    }

    for (float& value : values) {
        value = std::clamp(value / reference, 0.0f, 1.0f);
    }
}

static float envelopePeakNear(
    const std::vector<float>& envelope,
    float envelopeRate,
    float timeSec,
    float radiusSec
) {
    if (envelope.empty()) {
        return 0.0f;
    }

    int center = (int)std::lround(timeSec * envelopeRate);
    int radius = std::max(1, (int)std::lround(radiusSec * envelopeRate));
    int from = std::max(0, center - radius);
    int to = std::min((int)envelope.size() - 1, center + radius);
    float peak = 0.0f;

    for (int i = from; i <= to; ++i) {
        peak = std::max(peak, envelope[i]);
    }

    return peak;
}

static float envelopeMeanNear(
    const std::vector<float>& envelope,
    float envelopeRate,
    float timeSec,
    float radiusSec
) {
    if (envelope.empty()) {
        return 0.0f;
    }

    int center = (int)std::lround(timeSec * envelopeRate);
    int radius = std::max(1, (int)std::lround(radiusSec * envelopeRate));
    int from = std::max(0, center - radius);
    int to = std::min((int)envelope.size() - 1, center + radius);
    float sum = 0.0f;

    for (int i = from; i <= to; ++i) {
        sum += envelope[i];
    }

    return sum / (float)(to - from + 1);
}

static std::vector<float> autocorrelate(
    const std::vector<float>& values,
    int minLag,
    int maxLag
) {
    std::vector<float> correlation(maxLag + 1, 0.0f);
    int n = (int)values.size();

    for (int lag = minLag; lag <= maxLag; ++lag) {
        float sum = 0.0f;

        for (int i = 0; i + lag < n; ++i) {
            sum += values[i] * values[i + lag];
        }

        correlation[lag] = sum;
    }

    return correlation;
}

/**
 * Autocorrelation locks onto whichever metrical level is strongest, which for
 * drum-heavy tracks is usually half the real tempo. When the half lag is nearly
 * as periodic, the faster reading is the musically correct one.
 */
static int preferFasterMetricalLevel(
    const std::vector<float>& correlation,
    int bestLag,
    int minLag
) {
    for (int divisor : {2, 3}) {
        int faster = bestLag / divisor;

        if (faster < minLag) continue;
        if (correlation[faster] >= correlation[bestLag] * 0.8f) return faster;
    }

    return bestLag;
}

static float detectBPM(const std::vector<float>& energy, float energyRate) {
    int minLag = std::max(1, (int)(energyRate * 60.0f / 200.0f));
    int maxLag = std::min((int)(energyRate * 60.0f / 50.0f), (int)energy.size() - 1);

    if (maxLag <= minLag) {
        return 0.0f;
    }

    std::vector<float> correlation = autocorrelate(energy, minLag, maxLag);

    int bestLag = 0;
    float bestVal = 0.0f;

    for (int lag = minLag; lag <= maxLag; ++lag) {
        if (correlation[lag] <= bestVal) continue;

        bestVal = correlation[lag];
        bestLag = lag;
    }

    if (bestLag <= 0 || bestVal <= 0.0f) {
        return 0.0f;
    }

    float bpm = 60.0f * energyRate / (float)preferFasterMetricalLevel(correlation, bestLag, minLag);

    while (bpm >= 190.0f) bpm /= 2.0f;
    while (bpm > 0.0f && bpm < 80.0f) bpm *= 2.0f;

    return bpm;
}

/** Total onset strength landing on the beat grid for one candidate phase. */
static float scoreBeatPhase(
    const std::vector<float>& onset,
    float envelopeRate,
    float beatSec,
    float offsetSec
) {
    float envelopeLengthSec = (float)onset.size() / envelopeRate;
    float score = 0.0f;

    for (float t = offsetSec; t < envelopeLengthSec; t += beatSec) {
        score += envelopePeakNear(onset, envelopeRate, t, beatSec * 0.06f);
    }

    return score;
}

/**
 * Finds where the beat grid actually starts. Without this the grid begins at
 * sample zero and every note sits a fraction of a beat off the music.
 */
static float detectBeatOffset(
    const std::vector<float>& onset,
    float envelopeRate,
    float bpm
) {
    if (onset.empty() || bpm <= 0.0f) {
        return 0.0f;
    }

    const float beatSec = 60.0f / bpm;
    const int phaseSteps = 48;

    float bestOffset = 0.0f;
    float bestScore = -1.0f;

    for (int step = 0; step < phaseSteps; ++step) {
        float offsetSec = beatSec * (float)step / (float)phaseSteps;
        float score = scoreBeatPhase(onset, envelopeRate, beatSec, offsetSec);

        if (score > bestScore) {
            bestScore = score;
            bestOffset = offsetSec;
        }
    }

    return bestOffset;
}

/**
 * How much is going on musically at each grid position, blending attack
 * strength with local loudness so that intros, breakdowns and outros end up
 * clearly below the drops, and so that an off-beat slot only scores highly when
 * the track actually plays something there.
 */
static std::vector<float> computeGridIntensity(
    const std::vector<float>& energy,
    const std::vector<float>& onset,
    float envelopeRate,
    float bpm,
    float beatOffsetSec,
    float durationSec
) {
    const float slotSec = 60.0f / bpm / (float)INTENSITY_SUBDIVISION;
    const int slotCount = (int)((durationSec - beatOffsetSec) / slotSec);

    if (slotCount <= 0) {
        return {};
    }

    std::vector<float> attack;
    std::vector<float> loudness;

    for (int slot = 0; slot < slotCount; ++slot) {
        float t = beatOffsetSec + (float)slot * slotSec;

        attack.push_back(envelopePeakNear(onset, envelopeRate, t, slotSec * 0.5f));
        loudness.push_back(envelopeMeanNear(energy, envelopeRate, t, slotSec * 2.0f));
    }

    normalizeByPercentile(attack, 0.9f);
    normalizeByPercentile(loudness, 0.9f);

    std::vector<float> intensity;
    intensity.reserve(slotCount);

    for (int slot = 0; slot < slotCount; ++slot) {
        intensity.push_back(attack[slot] * 0.6f + loudness[slot] * 0.4f);
    }

    return intensity;
}

static AudioAnalysis analyzeAudio(const float* samples, int sampleCount, int sampleRate) {
    if (!samples || sampleCount <= 0 || sampleRate <= 0) {
        throw std::runtime_error("Invalid audio input");
    }

    std::vector<float> mono(samples, samples + sampleCount);

    AudioAnalysis analysis;
    analysis.bpm = 0.0f;
    analysis.durationSec = (float)sampleCount / (float)sampleRate;
    analysis.beatOffsetSec = 0.0f;

    if (sampleCount < ENERGY_WINDOW * 4) {
        return analysis;
    }

    std::vector<float> energy = computeEnergyEnvelope(mono);
    std::vector<float> onset = computeOnsetEnvelope(energy);
    float envelopeRate = (float)sampleRate / (float)ENERGY_WINDOW;

    analysis.bpm = detectBPM(energy, envelopeRate);

    if (analysis.bpm <= 0.0f) {
        return analysis;
    }

    analysis.beatOffsetSec = detectBeatOffset(onset, envelopeRate, analysis.bpm);
    analysis.gridIntensity = computeGridIntensity(
        energy,
        onset,
        envelopeRate,
        analysis.bpm,
        analysis.beatOffsetSec,
        analysis.durationSec
    );

    return analysis;
}

// ── Difficulty ──────────────────────────────────────────────────────────────

/**
 * Every knob that separates one difficulty from the next. Density is a budget
 * rather than a per-beat coin flip, so a chart cannot pile up notes faster than
 * the player can clear them no matter how busy the track is.
 */
struct DifficultySpec {
    // Highest patterns/level_N group the chart may draw from.
    int maxPatternLevel;
    // Ceiling on note density measured over a DENSITY_WINDOW_SEC window.
    float targetNotesPerSecond;
    // Floor on the time between two consecutive taps anywhere in the chart.
    float minNoteIntervalSec;
    // Widest chord allowed.
    int maxNotesPerTick;
    // How many patterns may be on screen at the same time.
    int maxConcurrentPatterns;
    // Beats quieter than this get no notes at all.
    float intensityThreshold;
    // Budget for how far a hand may travel across the playfield per second.
    float handSpeedPerSecond;
};

static DifficultySpec specForDifficulty(const std::string& name) {
    if (name == "easy") {
        return {1, 1.3f, 0.30f, 1, 1, 0.50f, 0.55f};
    }

    if (name == "hard") {
        return {3, 3.5f, 0.14f, 3, 2, 0.30f, 1.25f};
    }

    if (name == "expert") {
        return {4, 5.0f, 0.10f, 3, 2, 0.22f, 1.70f};
    }

    if (name == "chaos") {
        return {5, 6.5f, 0.075f, 4, 3, 0.15f, 2.20f};
    }

    return {2, 2.3f, 0.20f, 2, 1, 0.40f, 0.85f};
}

// ── Pattern library ─────────────────────────────────────────────────────────

/** One entry from patterns.json plus the metadata placement decisions need. */
struct Pattern {
    nlohmann::json notes;
    int level;
    float minX;
    float maxX;
    // Authored ticks from the pattern start to its last note or hold tail.
    int span;
    // Authored ticks between the two closest taps, 0 when everything is one chord.
    int minTapInterval;
    // Authored tick → how many notes start on it.
    std::map<int, int> tapTicks;
    int maxNotesPerTick;
    int noteCount;
};

static int noteStartTick(const nlohmann::json& note) {
    if (!note.contains("nodes")) {
        return note.value("tick", 0);
    }

    const nlohmann::json& nodes = note["nodes"];

    if (nodes.empty()) {
        return 0;
    }

    return nodes[0].value("tick", 0);
}

static std::vector<float> noteXValues(const nlohmann::json& note) {
    if (!note.contains("nodes")) {
        return {note.value("x", 0.0f)};
    }

    std::vector<float> values;

    for (const nlohmann::json& node : note["nodes"]) {
        values.push_back(node.value("x", 0.0f));
    }

    return values;
}

static std::pair<float, float> patternXExtent(const nlohmann::json& notes) {
    float lo = std::numeric_limits<float>::max();
    float hi = std::numeric_limits<float>::lowest();

    for (const nlohmann::json& note : notes) {
        for (float x : noteXValues(note)) {
            lo = std::min(lo, x);
            hi = std::max(hi, x);
        }
    }

    if (lo > hi) {
        return {0.0f, 0.0f};
    }

    return {lo, hi};
}

static int patternSpan(const nlohmann::json& notes) {
    int last = 0;

    for (const nlohmann::json& note : notes) {
        if (note.contains("nodes")) {
            for (const nlohmann::json& node : note["nodes"]) {
                last = std::max(last, node.value("tick", 0));
            }
            continue;
        }

        last = std::max(last, note.value("tick", 0) + note.value("duration", 0));
    }

    return last;
}

static int smallestGap(const std::map<int, int>& tapTicks) {
    int smallest = 0;
    bool hasPrevious = false;
    int previous = 0;

    for (const auto& [tick, count] : tapTicks) {
        if (hasPrevious && (smallest == 0 || tick - previous < smallest)) {
            smallest = tick - previous;
        }

        previous = tick;
        hasPrevious = true;
    }

    return smallest;
}

static Pattern makePattern(const nlohmann::json& notes, int level) {
    Pattern pattern;

    pattern.notes = notes;
    pattern.level = level;
    pattern.span = patternSpan(notes);
    pattern.noteCount = (int)notes.size();
    pattern.maxNotesPerTick = 0;

    auto [lo, hi] = patternXExtent(notes);
    pattern.minX = lo;
    pattern.maxX = hi;

    for (const nlohmann::json& note : notes) {
        pattern.tapTicks[noteStartTick(note)]++;
    }

    for (const auto& [tick, count] : pattern.tapTicks) {
        pattern.maxNotesPerTick = std::max(pattern.maxNotesPerTick, count);
    }

    pattern.minTapInterval = smallestGap(pattern.tapTicks);

    return pattern;
}

static void collectPatterns(
    const nlohmann::json& value,
    int level,
    std::vector<Pattern>& pool
) {
    if (value.is_array()) {
        pool.push_back(makePattern(value, level));
        return;
    }

    if (!value.is_object()) {
        return;
    }

    if (value.contains("notes") && value["notes"].is_array()) {
        pool.push_back(makePattern(value["notes"], level));
        return;
    }

    for (const auto& [key, child] : value.items()) {
        if (!key.empty() && key[0] == '_') continue;
        collectPatterns(child, level, pool);
    }
}

static int levelFromKey(const std::string& key) {
    const std::string prefix = "level_";

    if (key.rfind(prefix, 0) != 0) {
        return 1;
    }

    int level = std::atoi(key.c_str() + prefix.size());

    if (level <= 0) {
        return 1;
    }

    return level;
}

static std::vector<Pattern> loadPatternPool(const nlohmann::json& patternsJson) {
    std::vector<Pattern> pool;

    if (!patternsJson.contains("patterns") || !patternsJson["patterns"].is_object()) {
        return pool;
    }

    for (const auto& [levelName, level] : patternsJson["patterns"].items()) {
        if (!level.is_object()) continue;
        collectPatterns(level, levelFromKey(levelName), pool);
    }

    return pool;
}

// ── Chart building ──────────────────────────────────────────────────────────

nlohmann::json buildPageList(
    float bpm,
    float durationSec,
    float beatOffsetSec,
    int timeBase,
    int beatsPerPage
) {
    nlohmann::json pageList = nlohmann::json::array();

    if (bpm <= 0.0f || durationSec <= 0.0f || timeBase <= 0 || beatsPerPage <= 0) {
        return pageList;
    }

    const int ticksPerPage = timeBase * beatsPerPage;
    const float secondsPerTick = 60.0f / (bpm * (float)timeBase);
    const int totalTicks = (int)(durationSec / secondsPerTick);
    const int offsetTicks = (int)(beatOffsetSec / secondsPerTick);

    // The lead-in page runs bottom→top so the scan line reaches the top exactly
    // on the first beat, where the first regular top→bottom page takes over.
    if (offsetTicks > 0) {
        pageList.push_back({
            {"start_tick", 0},
            {"end_tick", offsetTicks},
            {"scan_line_direction", 1}
        });
    }

    int tick = offsetTicks;
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

struct ActivePattern {
    float minX;
    float maxX;
    int endTick;
};

/**
 * Walks the beat grid and places patterns under the difficulty's rules. The
 * rules, in the order they are applied per grid slot:
 *
 *  1. the slot must be musically loud enough (intensityThreshold, relaxed on
 *     downbeats), which is what keeps intros and breakdowns empty,
 *  2. the screen must have room (maxConcurrentPatterns),
 *  3. the trailing density must be under budget (targetNotesPerSecond),
 *  4. the pattern's difficulty level is picked from the local intensity, so the
 *     hardest shapes only show up where the track earns them,
 *  5. the pattern is stretched until its taps clear minNoteIntervalSec,
 *  6. no tap may land closer than minNoteIntervalSec to an existing one and no
 *     tick may exceed maxNotesPerTick,
 *  7. the x anchor must be reachable from the previous pattern at handSpeed and
 *     must not collide with a pattern that is still on screen.
 */
class ChartBuilder {
public:
    ChartBuilder(
        const AudioAnalysis& audio,
        const DifficultySpec& spec,
        int timeBase,
        int beatsPerPage,
        uint32_t seed
    )
        : audio(audio),
          spec(spec),
          timeBase(timeBase),
          beatsPerPage(beatsPerPage),
          rng(seed) {
        secondsPerTick = 60.0f / (audio.bpm * (float)timeBase);
        tickScale = std::max(1, timeBase / PATTERN_TIME_BASE);
        offsetTicks = (int)(audio.beatOffsetSec / secondsPerTick);
        minIntervalTicks = (int)(spec.minNoteIntervalSec / secondsPerTick);
        maxPatternSpanTicks = timeBase * beatsPerPage * 2;
        slotsPerBeat = slotsPerBeatFor(audio.bpm);
    }

    nlohmann::json build(const std::vector<Pattern>& pool) {
        groupByLevel(pool);

        const int stride = INTENSITY_SUBDIVISION / slotsPerBeat;
        const int slotTicks = timeBase / slotsPerBeat;

        for (size_t index = 0; index < audio.gridIntensity.size(); index += (size_t)stride) {
            int slotTick = offsetTicks + (int)(index / (size_t)stride) * slotTicks;

            expireActive(slotTick);
            tryPlaceOnSlot(pool, index, slotTick);
        }

        return sortedNoteList();
    }

    /** Keeps slots short enough that a slow track still gets a usable grid. */
    static int slotsPerBeatFor(float bpm) {
        float beatSec = 60.0f / bpm;
        int slots = 1;

        while (slots < INTENSITY_SUBDIVISION && beatSec / (float)slots > MAX_SLOT_SEC) {
            slots *= 2;
        }

        return slots;
    }

private:
    const AudioAnalysis& audio;
    const DifficultySpec& spec;
    int timeBase;
    int beatsPerPage;
    std::mt19937 rng;

    float secondsPerTick = 0.0f;
    int tickScale = 1;
    int offsetTicks = 0;
    int minIntervalTicks = 0;
    int maxPatternSpanTicks = 0;
    int slotsPerBeat = 1;

    // Pattern indices per difficulty level, indexed by level - 1.
    std::vector<std::vector<int>> patternsByLevel;

    std::vector<nlohmann::json> notes;
    std::map<int, int> notesPerTick;
    std::set<int> occupiedTicks;
    std::deque<float> recentNoteTimes;
    std::vector<ActivePattern> active;

    float previousCenter = 0.5f;
    float previousPlacementSec = -100.0f;

    void groupByLevel(const std::vector<Pattern>& pool) {
        patternsByLevel.assign(spec.maxPatternLevel, {});

        for (size_t index = 0; index < pool.size(); ++index) {
            if (!patternAllowed(pool[index])) continue;
            patternsByLevel[pool[index].level - 1].push_back((int)index);
        }
    }

    bool patternAllowed(const Pattern& pattern) const {
        if (pattern.level < 1 || pattern.level > spec.maxPatternLevel) return false;
        if (pattern.noteCount <= 0) return false;
        if (pattern.maxNotesPerTick > spec.maxNotesPerTick) return false;
        if (pattern.maxX - pattern.minX > PLAYFIELD_MAX_X - PLAYFIELD_MIN_X) return false;

        return stretchFor(pattern) > 0;
    }

    /**
     * Smallest power-of-two tick multiplier that spaces the pattern's taps at
     * least minNoteIntervalSec apart. Returns 0 when even the widest stretch
     * would leave the pattern too fast or make it outstay its welcome.
     */
    int stretchFor(const Pattern& pattern) const {
        for (int stretch = 1; stretch <= MAX_STRETCH; stretch *= 2) {
            if (patternSpanTicks(pattern, stretch) > maxPatternSpanTicks) return 0;
            if (tapsAreReachable(pattern, stretch)) return stretch;
        }

        return 0;
    }

    bool tapsAreReachable(const Pattern& pattern, int stretch) const {
        if (pattern.minTapInterval <= 0) return true;
        return pattern.minTapInterval * tickScale * stretch >= minIntervalTicks;
    }

    int patternSpanTicks(const Pattern& pattern, int stretch) const {
        return pattern.span * tickScale * stretch;
    }

    void expireActive(int beatTick) {
        auto expired = std::remove_if(
            active.begin(),
            active.end(),
            [beatTick](const ActivePattern& pattern) {
                return pattern.endTick <= beatTick;
            }
        );

        active.erase(expired, active.end());
    }

    void tryPlaceOnSlot(const std::vector<Pattern>& pool, size_t slotIndex, int slotTick) {
        float intensity = audio.gridIntensity[slotIndex];

        if (intensity < thresholdForSlot(slotIndex)) return;
        if ((int)active.size() >= spec.maxConcurrentPatterns) return;

        float nowSec = (float)slotTick * secondsPerTick;

        if (notesPerSecondAt(nowSec) >= spec.targetNotesPerSecond) return;

        int index = choosePattern(pool, intensity, slotTick);

        if (index < 0) return;

        int stretch = stretchFor(pool[index]);
        float anchor = chooseAnchor(pool[index], nowSec);

        if (!std::isfinite(anchor)) return;

        emitPattern(pool[index], slotTick, anchor, stretch, nowSec);
    }

    /**
     * Downbeats are the musically obvious place for a pattern, so they qualify
     * sooner; slots inside a beat have to be clearly audible to earn a note.
     */
    float thresholdForSlot(size_t slotIndex) const {
        size_t ticksPerBar = (size_t)(INTENSITY_SUBDIVISION * beatsPerPage);

        if (slotIndex % ticksPerBar == 0) return spec.intensityThreshold * 0.8f;
        if (slotIndex % (size_t)INTENSITY_SUBDIVISION == 0) return spec.intensityThreshold;

        return spec.intensityThreshold * 1.3f;
    }

    float notesPerSecondAt(float nowSec) {
        float windowStart = nowSec - DENSITY_WINDOW_SEC;

        while (!recentNoteTimes.empty() && recentNoteTimes.front() < windowStart) {
            recentNoteTimes.pop_front();
        }

        return (float)recentNoteTimes.size() / DENSITY_WINDOW_SEC;
    }

    int choosePattern(const std::vector<Pattern>& pool, float intensity, int beatTick) {
        for (int attempt = 0; attempt < PATTERN_TRIES; ++attempt) {
            int index = drawPatternIndex(intensity);

            if (index >= 0 && patternFitsHere(pool[index], beatTick)) return index;
        }

        return -1;
    }

    /** Loud beats draw from the hardest level the difficulty allows, quiet ones from level 1. */
    int drawPatternIndex(float intensity) {
        int wanted = 1 + (int)(intensity * (float)spec.maxPatternLevel);
        wanted = std::clamp(wanted, 1, spec.maxPatternLevel);

        for (int level = wanted; level >= 1; --level) {
            if (!patternsByLevel[level - 1].empty()) return pickFromLevel(level);
        }

        return -1;
    }

    int pickFromLevel(int level) {
        const std::vector<int>& candidates = patternsByLevel[level - 1];
        std::uniform_int_distribution<size_t> pick(0, candidates.size() - 1);

        return candidates[pick(rng)];
    }

    bool patternFitsHere(const Pattern& pattern, int beatTick) {
        int stretch = stretchFor(pattern);

        if (stretch <= 0) return false;
        if (!fitsDensityBudget(pattern, beatTick)) return false;

        return ticksAreFree(pattern, beatTick, stretch);
    }

    bool fitsDensityBudget(const Pattern& pattern, int beatTick) {
        float nowSec = (float)beatTick * secondsPerTick;
        float current = notesPerSecondAt(nowSec);
        float added = (float)pattern.noteCount / DENSITY_WINDOW_SEC;

        return current + added <= spec.targetNotesPerSecond;
    }

    bool ticksAreFree(const Pattern& pattern, int beatTick, int stretch) const {
        for (const auto& [authoredTick, count] : pattern.tapTicks) {
            int tick = beatTick + authoredTick * tickScale * stretch;

            if (!tickAvailable(tick, count)) return false;
        }

        return true;
    }

    bool tickAvailable(int tick, int count) const {
        int existing = 0;
        auto found = notesPerTick.find(tick);

        if (found != notesPerTick.end()) {
            existing = found->second;
        }

        if (existing + count > spec.maxNotesPerTick) return false;

        return !hasNeighbourWithin(tick, minIntervalTicks);
    }

    /** True when another tap sits close enough that the two would fight for the same hand. */
    bool hasNeighbourWithin(int tick, int distance) const {
        auto after = occupiedTicks.lower_bound(tick);

        if (after != occupiedTicks.end() && *after != tick && *after - tick < distance) {
            return true;
        }

        if (after == occupiedTicks.begin()) {
            return false;
        }

        return tick - *std::prev(after) < distance;
    }

    /**
     * Places the pattern horizontally within reach of the previous one. The
     * reach grows with the gap since the last placement, so a pattern that
     * follows immediately stays close and one after a rest may cross the field.
     */
    float chooseAnchor(const Pattern& pattern, float nowSec) {
        float width = pattern.maxX - pattern.minX;
        float centerOffset = (pattern.minX + pattern.maxX) * 0.5f;
        float reach = reachableDistance(nowSec);

        for (int attempt = 0; attempt < ANCHOR_TRIES; ++attempt) {
            float center = proposeCenter(reach * (1.0f + (float)attempt * 0.25f), width);
            float anchor = center - centerOffset;

            if (xRangeFree(anchor + pattern.minX, anchor + pattern.maxX)) return anchor;
        }

        return std::numeric_limits<float>::quiet_NaN();
    }

    float reachableDistance(float nowSec) const {
        float restSec = std::max(0.0f, nowSec - previousPlacementSec);
        float reach = spec.handSpeedPerSecond * restSec;

        return std::clamp(reach, 0.12f, PLAYFIELD_MAX_X - PLAYFIELD_MIN_X);
    }

    float proposeCenter(float reach, float width) {
        std::uniform_real_distribution<float> offset(-reach, reach);

        // A mild pull to the middle keeps a run of patterns from parking on an edge.
        float target = previousCenter + (0.5f - previousCenter) * 0.15f + offset(rng);
        float half = width * 0.5f;

        return std::clamp(target, PLAYFIELD_MIN_X + half, PLAYFIELD_MAX_X - half);
    }

    bool xRangeFree(float minX, float maxX) const {
        for (const ActivePattern& other : active) {
            if (minX < other.maxX + PATTERN_X_GAP && maxX > other.minX - PATTERN_X_GAP) {
                return false;
            }
        }

        return true;
    }

    void emitPattern(
        const Pattern& pattern,
        int beatTick,
        float anchor,
        int stretch,
        float nowSec
    ) {
        for (const nlohmann::json& source : pattern.notes) {
            nlohmann::json note = transformNote(source, beatTick, anchor, stretch);

            registerNote(note);
            notes.push_back(note);
        }

        active.push_back({
            anchor + pattern.minX,
            anchor + pattern.maxX,
            beatTick + patternSpanTicks(pattern, stretch)
        });

        previousCenter = anchor + (pattern.minX + pattern.maxX) * 0.5f;
        previousPlacementSec = nowSec;
    }

    nlohmann::json transformNote(
        const nlohmann::json& source,
        int beatTick,
        float anchor,
        int stretch
    ) const {
        nlohmann::json note = source;
        int multiplier = tickScale * stretch;

        if (!note.contains("nodes")) {
            note["tick"] = beatTick + note.value("tick", 0) * multiplier;
            note["duration"] = note.value("duration", 0) * multiplier;
            note["x"] = anchor + note.value("x", 0.0f);
            return note;
        }

        for (nlohmann::json& node : note["nodes"]) {
            node["tick"] = beatTick + node.value("tick", 0) * multiplier;
            node["duration"] = node.value("duration", 0) * multiplier;
            node["x"] = anchor + node.value("x", 0.0f);
        }

        return note;
    }

    void registerNote(const nlohmann::json& note) {
        int tick = noteStartTick(note);

        notesPerTick[tick]++;
        occupiedTicks.insert(tick);
        recentNoteTimes.push_back((float)tick * secondsPerTick);
    }

    /** The engine keys notes by id, so ids are handed out in play order. */
    nlohmann::json sortedNoteList() {
        std::sort(
            notes.begin(),
            notes.end(),
            [](const nlohmann::json& a, const nlohmann::json& b) {
                return noteStartTick(a) < noteStartTick(b);
            }
        );

        nlohmann::json noteList = nlohmann::json::array();

        for (size_t index = 0; index < notes.size(); ++index) {
            notes[index]["id"] = (int)index;
            noteList.push_back(notes[index]);
        }

        return noteList;
    }
};

static uint32_t seedFor(const AudioAnalysis& audio, const std::string& difficulty) {
    size_t bpmHash = std::hash<float>{}(audio.bpm);
    size_t durationHash = std::hash<float>{}(audio.durationSec);
    size_t difficultyHash = std::hash<std::string>{}(difficulty);

    return 42069u
        ^ (uint32_t)(bpmHash * 6364136223846793005ULL)
        ^ (uint32_t)(durationHash * 1442695040888963407ULL)
        ^ (uint32_t)(difficultyHash * 1099511628211ULL);
}

nlohmann::json buildNoteList(
    const AudioAnalysis& audio,
    const nlohmann::json& patternsJson,
    const std::string& difficulty,
    int timeBase,
    int beatsPerPage
) {
    if (audio.bpm <= 0.0f || audio.gridIntensity.empty()) {
        return nlohmann::json::array();
    }

    std::vector<Pattern> pool = loadPatternPool(patternsJson);

    if (pool.empty()) {
        return nlohmann::json::array();
    }

    DifficultySpec spec = specForDifficulty(difficulty);

    ChartBuilder builder(audio, spec, timeBase, beatsPerPage, seedFor(audio, difficulty));

    return builder.build(pool);
}

extern "C" {

CHART_EXPORT
char* analyze_audio_json(
    const float* monoSamples,
    int sampleCount,
    int sampleRate,
    const char* patternsJsonString,
    int timeBase,
    int beatsPerPage,
    const char* difficultyName
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

        std::string difficulty = "normal";

        if (difficultyName && difficultyName[0] != '\0') {
            difficulty = difficultyName;
        }

        AudioAnalysis audio = analyzeAudio(monoSamples, sampleCount, sampleRate);
        nlohmann::json patternsJson = nlohmann::json::parse(patternsJsonString);

        nlohmann::json chart;

        chart["bpm"] = audio.bpm;
        chart["time_base"] = timeBase;
        chart["start_offset_time"] = 0;
        chart["length"] = audio.durationSec;

        chart["page_list"] = buildPageList(
            audio.bpm,
            audio.durationSec,
            audio.beatOffsetSec,
            timeBase,
            beatsPerPage
        );

        chart["note_list"] = buildNoteList(
            audio,
            patternsJson,
            difficulty,
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

CHART_EXPORT
void free_result(char* ptr) {
    std::free(ptr);
}

}
