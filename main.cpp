#include <soundtouch/SoundTouch.h>
#include <soundtouch/BPMDetect.h>

#include <vector>
#include <algorithm>
#include <cmath>

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

nlohmann::json buildPageList(float bpm, float duration_sec, int time_base = 480, int beats_per_page = 4) {
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

nlohmann::json buildNoteList(float bpm, float duration_sec, int time_base = 480) {
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
        chart["page_list"] = buildPageList(audio.bpm, audio.duration_sec);
        chart["note_list"] = buildNoteList(audio.bpm, audio.duration_sec);

        std::cout << chart.dump(2) << std::endl;
    } catch (const std::exception &e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}