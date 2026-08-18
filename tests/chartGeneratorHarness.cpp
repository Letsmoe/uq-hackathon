// Native harness for the chart generator. Builds a synthetic track with a
// silent intro, a loud body and a quiet outro, generates a chart at every
// difficulty and checks the generated notes against the difficulty's own rules.
//
// Compiled and run by tests/chartGenerator.test.ts.

#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "../main.cpp"

static const int SAMPLE_RATE = 44100;
static const float TRACK_BPM = 128.0f;
static const float INTRO_SEC = 6.0f;
static const float BODY_SEC = 60.0f;
static const float OUTRO_SEC = 6.0f;

struct Failure {
    std::string message;
};

static std::vector<Failure> failures;

static void expect(bool condition, const std::string& message) {
    if (condition) {
        return;
    }

    failures.push_back({message});
}

/** Percussive click: a short exponentially decaying burst. */
static void addClick(std::vector<float>& samples, float timeSec, float amplitude) {
    int start = (int)(timeSec * SAMPLE_RATE);
    int length = SAMPLE_RATE / 20;

    for (int i = 0; i < length && start + i < (int)samples.size(); ++i) {
        float decay = std::exp(-12.0f * (float)i / (float)SAMPLE_RATE * 20.0f);
        float tone = std::sin(6.2831853f * 180.0f * (float)i / (float)SAMPLE_RATE);

        samples[start + i] += amplitude * decay * tone;
    }
}

static std::vector<float> synthesizeTrack() {
    float totalSec = INTRO_SEC + BODY_SEC + OUTRO_SEC;
    std::vector<float> samples((size_t)(totalSec * SAMPLE_RATE), 0.0f);

    const float beatSec = 60.0f / TRACK_BPM;
    // Deliberately off-grid so the harness also exercises beat offset detection.
    const float firstBeatSec = INTRO_SEC + 0.137f;

    for (float t = firstBeatSec; t < INTRO_SEC + BODY_SEC; t += beatSec) {
        addClick(samples, t, 1.0f);
        addClick(samples, t + beatSec * 0.5f, 0.55f);
    }

    for (float t = INTRO_SEC + BODY_SEC; t + 0.1f < totalSec; t += beatSec) {
        addClick(samples, t, 0.04f);
    }

    return samples;
}

static std::string readFile(const std::string& path) {
    std::ifstream stream(path);
    std::stringstream buffer;

    buffer << stream.rdbuf();
    return buffer.str();
}

static int startTickOf(const nlohmann::json& note) {
    return noteStartTick(note);
}

static void checkOrdering(const nlohmann::json& noteList, const std::string& label) {
    int previousTick = -1;

    for (size_t index = 0; index < noteList.size(); ++index) {
        expect(startTickOf(noteList[index]) >= previousTick, label + ": notes are not tick ordered");
        expect(noteList[index].value("id", -1) == (int)index, label + ": ids are not sequential");

        previousTick = startTickOf(noteList[index]);
    }
}

static void checkTickSpacing(
    const nlohmann::json& noteList,
    const DifficultySpec& spec,
    float secondsPerTick,
    const std::string& label
) {
    std::map<int, int> perTick;

    for (const nlohmann::json& note : noteList) {
        perTick[startTickOf(note)]++;
    }

    int previousTick = -1;

    for (const auto& [tick, count] : perTick) {
        expect(count <= spec.maxNotesPerTick, label + ": chord wider than the difficulty allows");

        if (previousTick >= 0) {
            float gapSec = (float)(tick - previousTick) * secondsPerTick;
            expect(gapSec >= spec.minNoteIntervalSec - 0.005f, label + ": taps closer than minNoteIntervalSec");
        }

        previousTick = tick;
    }
}

static void checkDensity(
    const nlohmann::json& noteList,
    const DifficultySpec& spec,
    float secondsPerTick,
    const std::string& label
) {
    std::vector<float> times;

    for (const nlohmann::json& note : noteList) {
        times.push_back((float)startTickOf(note) * secondsPerTick);
    }

    for (size_t start = 0; start < times.size(); ++start) {
        size_t end = start;

        while (end < times.size() && times[end] - times[start] < DENSITY_WINDOW_SEC) {
            ++end;
        }

        float notesPerSecond = (float)(end - start) / DENSITY_WINDOW_SEC;
        expect(notesPerSecond <= spec.targetNotesPerSecond + 0.01f, label + ": density budget exceeded");
    }
}

static void checkPlayfield(const nlohmann::json& noteList, const std::string& label) {
    for (const nlohmann::json& note : noteList) {
        for (float x : noteXValues(note)) {
            expect(x >= PLAYFIELD_MIN_X - 0.001f, label + ": note left of the playfield");
            expect(x <= PLAYFIELD_MAX_X + 0.001f, label + ": note right of the playfield");
        }
    }
}

static void checkQuietSections(
    const nlohmann::json& noteList,
    float secondsPerTick,
    const std::string& label
) {
    for (const nlohmann::json& note : noteList) {
        float timeSec = (float)startTickOf(note) * secondsPerTick;

        expect(timeSec >= INTRO_SEC - 0.5f, label + ": note placed in the silent intro");
        expect(timeSec <= INTRO_SEC + BODY_SEC + 1.0f, label + ": note placed in the quiet outro");
    }
}

static void checkHandTravel(
    const nlohmann::json& noteList,
    const DifficultySpec& spec,
    float secondsPerTick,
    const std::string& label
) {
    bool hasPrevious = false;
    float previousX = 0.0f;
    float previousTimeSec = 0.0f;

    for (const nlohmann::json& note : noteList) {
        float timeSec = (float)startTickOf(note) * secondsPerTick;
        float x = noteXValues(note)[0];
        float gapSec = timeSec - previousTimeSec;

        // Chords and concurrent patterns are covered by the other hand, so only
        // notes far enough apart to be one hand's problem are checked.
        if (hasPrevious && gapSec > 0.001f && gapSec < 1.0f) {
            float speed = std::fabs(x - previousX) / gapSec;
            expect(speed <= spec.handSpeedPerSecond * 6.0f, label + ": hand travel far beyond handSpeed");
        }

        hasPrevious = true;
        previousX = x;
        previousTimeSec = timeSec;
    }
}

static void checkPages(const nlohmann::json& chart) {
    const nlohmann::json& pages = chart["page_list"];

    expect(!pages.empty(), "page list is empty");
    expect(pages[0].value("start_tick", -1) == 0, "page list does not start at tick 0");

    for (size_t index = 1; index < pages.size(); ++index) {
        int previousEnd = pages[index - 1].value("end_tick", -1);

        expect(pages[index].value("start_tick", -2) == previousEnd, "pages are not contiguous");
        expect(
            pages[index].value("scan_line_direction", 0)
                == -pages[index - 1].value("scan_line_direction", 0),
            "scan line direction does not alternate"
        );
    }
}

static nlohmann::json generate(
    const std::vector<float>& samples,
    const std::string& patternsJson,
    const std::string& difficulty
) {
    char* raw = analyze_audio_json(
        samples.data(),
        (int)samples.size(),
        SAMPLE_RATE,
        patternsJson.c_str(),
        480,
        4,
        difficulty.c_str()
    );

    std::string text(raw);
    free_result(raw);

    return nlohmann::json::parse(text);
}

int main(int argc, char** argv) {
    std::string patternsPath = "patterns.json";

    if (argc > 1) {
        patternsPath = argv[1];
    }

    std::string patternsJson = readFile(patternsPath);

    if (patternsJson.empty()) {
        std::printf("FAIL: could not read %s\n", patternsPath.c_str());
        return 1;
    }

    std::vector<float> samples = synthesizeTrack();
    const std::vector<std::string> difficulties =
        {"easy", "normal", "hard", "expert", "chaos"};

    std::vector<size_t> noteCounts;

    for (const std::string& difficulty : difficulties) {
        nlohmann::json chart = generate(samples, patternsJson, difficulty);

        expect(!chart.contains("error"), difficulty + ": generator returned an error");

        if (chart.contains("error")) {
            continue;
        }

        float bpm = chart.value("bpm", 0.0f);
        int timeBase = chart.value("time_base", 480);
        float secondsPerTick = 60.0f / (bpm * (float)timeBase);
        DifficultySpec spec = specForDifficulty(difficulty);
        const nlohmann::json& noteList = chart["note_list"];

        expect(bpm > 0.0f, difficulty + ": no bpm detected");
        expect(!noteList.empty(), difficulty + ": chart has no notes");

        checkOrdering(noteList, difficulty);
        checkTickSpacing(noteList, spec, secondsPerTick, difficulty);
        checkDensity(noteList, spec, secondsPerTick, difficulty);
        checkPlayfield(noteList, difficulty);
        checkQuietSections(noteList, secondsPerTick, difficulty);
        checkHandTravel(noteList, spec, secondsPerTick, difficulty);
        checkPages(chart);

        noteCounts.push_back(noteList.size());

        std::printf(
            "%-7s bpm=%.1f notes=%zu nps=%.2f\n",
            difficulty.c_str(),
            bpm,
            noteList.size(),
            (float)noteList.size() / BODY_SEC
        );
    }

    for (size_t index = 1; index < noteCounts.size(); ++index) {
        expect(
            noteCounts[index] > noteCounts[index - 1],
            "note count does not grow with difficulty: " + difficulties[index]
        );
    }

    // The same inputs must produce the same chart, otherwise a replay of a song
    // would not match the score it was played against.
    nlohmann::json first = generate(samples, patternsJson, "hard");
    nlohmann::json second = generate(samples, patternsJson, "hard");
    expect(first == second, "generation is not deterministic");

    for (const Failure& failure : failures) {
        std::printf("FAIL: %s\n", failure.message.c_str());
    }

    if (!failures.empty()) {
        std::printf("%zu check(s) failed\n", failures.size());
        return 1;
    }

    std::printf("all checks passed\n");
    return 0;
}
