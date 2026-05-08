#include <soundtouch/SoundTouch.h>
#include <soundtouch/BPMDetect.h>
#include <iostream>
#include <sndfile.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: bpmdetect <file.wav>" << std::endl;
        return 1;
    }

    SF_INFO info;
    SNDFILE *file = sf_open(argv[1], SFM_READ, &info);
    if (!file) {
        std::cerr << "Could not open file" << std::endl;
        return 1;
    }

    soundtouch::BPMDetect bpm(info.channels, info.samplerate);

    float buffer[4096];
    int frames;
    while ((frames = sf_readf_float(file, buffer, 1024)) > 0) {
        bpm.inputSamples(buffer, frames);
    }

    sf_close(file);
    std::cout << "BPM: " << bpm.getBpm() << std::endl;
    return 0;
}