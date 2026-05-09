/**
 * audio_analysis.cpp
 *
 * Detects pitch and volume (RMS dBFS) per frame from an audio file.
 *
 * Dependencies: aubio, libsndfile
 *
 * Install (macOS):
 *   brew install aubio libsndfile
 *
 * Install (Ubuntu/Debian):
 *   sudo apt install libaubio-dev libsndfile1-dev
 *
 * Compile:
 *   g++ audio_analysis.cpp -o audio_analysis \
 *       $(pkg-config --cflags --libs aubio sndfile) -std=c++17
 *
 * Usage:
 *   ./audio_analysis <audio_file.wav>
 */

#include <aubio/aubio.h>
#include <sndfile.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

static constexpr uint_t HOP_SIZE             = 512;   // samples between frames
static constexpr uint_t WIN_SIZE             = 1024;  // FFT window (>= 2 * HOP_SIZE)
static constexpr float  SILENCE_DB           = -70.f; // skip frames quieter than this
static constexpr float  MIN_PITCH_CONFIDENCE = 0.7f;  // 0–1, higher = fewer false positives


static float compute_rms(const float* buf, uint_t n)
{
    double sum = 0.0;
    for (uint_t i = 0; i < n; ++i)
        sum += static_cast<double>(buf[i]) * buf[i];
    return static_cast<float>(std::sqrt(sum / n));
}

static float to_db(float rms)
{
    return (rms > 0.f) ? 20.f * std::log10(rms) : -120.f;
}

static std::string hz_to_note(float hz)
{
    if (hz <= 0.f) return "---";
    static const char* names[] = {
        "C","C#","D","D#","E","F","F#","G","G#","A","A#","B"
    };
    int midi = static_cast<int>(std::round(12.f * std::log2(hz / 440.f))) + 69;
    if (midi < 0 || midi > 127) return "---";
    return std::string(names[midi % 12]) + std::to_string(midi / 12 - 1);
}

int main(int argc, char** argv)
{
    if (argc < 2) {
        std::fprintf(stderr, "Usage: %s <audio_file.wav>\n", argv[0]);
        return 1;
    }

    // Open file
    SF_INFO sfinfo{};
    SNDFILE* sndfile = sf_open(argv[1], SFM_READ, &sfinfo);
    if (!sndfile) {
        std::fprintf(stderr, "Error opening file: %s\n", sf_strerror(nullptr));
        return 1;
    }

    const uint_t sample_rate = static_cast<uint_t>(sfinfo.samplerate);
    const int    channels    = sfinfo.channels;

    std::printf("File        : %s\n", argv[1]);
    std::printf("Sample rate : %u Hz | Channels: %d | Duration: %.2f s\n\n",
                sample_rate, channels,
                static_cast<double>(sfinfo.frames) / sample_rate);

    // Buffers
    std::vector<float> interleaved(HOP_SIZE * static_cast<uint_t>(channels));
    std::vector<float> mono(HOP_SIZE);

    // aubio pitch detector (YIN)
    aubio_pitch_t* pitch_det = new_aubio_pitch("yin", WIN_SIZE, HOP_SIZE, sample_rate);
    aubio_pitch_set_unit(pitch_det, "Hz");
    aubio_pitch_set_silence(pitch_det, SILENCE_DB);
    aubio_pitch_set_tolerance(pitch_det, 1.f - MIN_PITCH_CONFIDENCE);

    fvec_t* in_vec    = new_fvec(HOP_SIZE);
    fvec_t* pitch_out = new_fvec(1);

    // Header
    std::printf("%-10s  %-10s  %-8s  %-10s\n", "Time (s)", "Pitch (Hz)", "Note", "Vol (dBFS)");
    std::printf("%s\n", std::string(44, '-').c_str());

    sf_count_t frames_read;
    double elapsed = 0.0;

    while ((frames_read = sf_readf_float(sndfile, interleaved.data(), HOP_SIZE)) > 0)
    {
        const uint_t n = static_cast<uint_t>(frames_read);

        // Downmix to mono
        for (uint_t i = 0; i < n; ++i) {
            float sum = 0.f;
            for (int ch = 0; ch < channels; ++ch)
                sum += interleaved[i * channels + ch];
            mono[i] = sum / channels;
            in_vec->data[i] = mono[i];
        }
        for (uint_t i = n; i < HOP_SIZE; ++i)
            in_vec->data[i] = 0.f;

        // Volume
        float rms_db = to_db(compute_rms(mono.data(), n));

        // Pitch
        aubio_pitch_do(pitch_det, in_vec, pitch_out);
        float pitch_hz = fvec_get_sample(pitch_out, 0);
        float conf     = aubio_pitch_get_confidence(pitch_det);
        if (conf < MIN_PITCH_CONFIDENCE || rms_db < SILENCE_DB)
            pitch_hz = 0.f;

        std::printf("%-10.3f  %-10.1f  %-8s  %.1f\n",
                    elapsed, pitch_hz, hz_to_note(pitch_hz).c_str(), rms_db);

        elapsed += static_cast<double>(n) / sample_rate;
    }

    // Cleanup
    del_aubio_pitch(pitch_det);
    del_fvec(in_vec);
    del_fvec(pitch_out);
    aubio_cleanup();
    sf_close(sndfile);

    return 0;
}