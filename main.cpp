#include <soundtouch/SoundTouch.h>
#include <soundtouch/BPMDetect.h>
#include <iostream>
#include <sndfile.h>
#include <nlohmann/json.hpp>

struct AudioInfo {
    float bpm;
    float duration_sec;
};

AudioInfo detectAudio(const char *path) {
    SF_INFO info;
    SNDFILE *file = sf_open(path, SFM_READ, &info);
    if (!file) {
        throw std::runtime_error("Could not open file");
    }

    soundtouch::BPMDetect bpmDetect(info.channels, info.samplerate);

    float buffer[4096];
    int frames;
    long total_frames = 0;
    while ((frames = sf_readf_float(file, buffer, 1024)) > 0) {
        bpmDetect.inputSamples(buffer, frames);
        total_frames += frames;
    }

    sf_close(file);

    return {
        .bpm = bpmDetect.getBpm(),
        .duration_sec = (float)total_frames / info.samplerate
    };
}

nlohmann::json buildPageList(float bpm, float duration_sec, int time_base = 480, int beats_per_page = 2) {
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
        chart["note_list"] = nlohmann::json::array();

        // std::cout << chart.dump(2) << std::endl;
    } catch (const std::exception &e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}