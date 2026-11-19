// Orquestación de la manilla: sensores, alertas, red, voz y OLED (app.py).
//
// Todos los cambios de estado ocurren en la tarea principal, que consume la
// cola de eventos. Las demás tareas solo publican eventos.
#pragma once

#include <functional>
#include <string>

#include "mining/alerts.h"
#include "mining/canvas.h"
#include "mining/events.h"
#include "mining/menu.h"
#include "mining/outbox.h"
#include "mining/recorder.h"
#include "mining/renderer.h"
#include "mining/settings.h"
#include "mining/voice_queue.h"
#include "mining/wallclock.h"

namespace mining {

struct AppContext {
    const Settings* settings = nullptr;
    AlertOutputs* outputs = nullptr;
    WallClock* clock = nullptr;
    MonotonicClock monotonic;
    // Only when the link with the central is configured.
    Outbox* outbox = nullptr;
    std::function<void()> wakeLink;
    // Link configured and voice enabled.
    VoiceQueue* voices = nullptr;
    std::function<void()> wakeUploader;
    // Voice enabled.
    Recorder* recorder = nullptr;
};

class Application {
public:
    explicit Application(AppContext context);

    void process(const Event& event);
    // Once per second.
    void tick();
    void render(Canvas& canvas);
    void close();

    Menu& menu() { return menu_; }
    AlertController& alerts() { return alerts_; }

private:
    void execute(const Intent& intent);
    void sendMessage(const std::string& code);
    void acknowledge(int64_t noticeId);
    void startRecording();
    void finishRecording();
    void sendVoice();
    void discardVoice();
    void sendAlarms(const Assessment& assessment, bool simulated);
    void refreshPending();

    AppContext ctx_;
    Menu menu_;
    Renderer renderer_;
    AlertController alerts_;
    bool hasRecording_ = false;
    RecordingResult recording_;
    // One automatic alert per transition into danger, re-armed when the group returns to normal.
    bool alarmArmed_[2] = {true, true};
};

}  // namespace mining
