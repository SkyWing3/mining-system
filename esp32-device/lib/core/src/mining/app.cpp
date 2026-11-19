#include "mining/app.h"

#include "mining/catalog.h"
#include "mining/log.h"
#include "mining/text.h"

namespace mining {

namespace {
struct AlarmGroup {
    const char* group;
    const char* code;
};
const AlarmGroup kAlarmGroups[] = {{"co", kCoAlarm}, {"heat", kHeatAlarm}};
}  // namespace

Application::Application(AppContext context)
    : ctx_(std::move(context)),
      alerts_(*ctx_.outputs, ctx_.settings->alerts.silenceSeconds, ctx_.settings->alerts.buttonFeedback,
              ctx_.settings->linkConfigured(), ctx_.monotonic) {
    menu_.link.configured = ctx_.settings->linkConfigured();
    refreshPending();
}

void Application::close() {
    if (ctx_.recorder != nullptr && ctx_.recorder->recording()) ctx_.recorder->cancel();
    alerts_.close();
}

void Application::render(Canvas& canvas) { renderer_.render(menu_, canvas); }

// --- events -------------------------------------------------------------------

void Application::process(const Event& event) {
    if (const Action* action = std::get_if<Action>(&event)) {
        alerts_.onButton();
        for (const Intent& intent : menu_.handle(*action)) execute(intent);
    } else if (const MonitorUpdate* update = std::get_if<MonitorUpdate>(&event)) {
        menu_.monitor(update->snapshot, update->assessment);
        alerts_.onLevel(update->assessment.level);
        sendAlarms(update->assessment, update->snapshot.simulated);
    } else if (const TransportEvent* transport = std::get_if<TransportEvent>(&event)) {
        menu_.transport(*transport);
        if (transport->kind == TransportKind::Connected || transport->kind == TransportKind::Disconnected)
            alerts_.onConnection(transport->kind == TransportKind::Connected);
        refreshPending();
    } else if (const NoticeReceived* notice = std::get_if<NoticeReceived>(&event)) {
        if (menu_.receiveNotice(*notice)) alerts_.onNotice(notice->severity);
    } else if (const VoiceEvent* voice = std::get_if<VoiceEvent>(&event)) {
        if (voice->uploaded) {
            menu_.voiceUploaded(voice->voiceId);
        } else {
            menu_.voiceRejected(voice->voiceId);
        }
        refreshPending();
    }
}

void Application::tick() {
    alerts_.tick();
    Recorder* recorder = ctx_.recorder;
    if (recorder != nullptr && recorder->recording()) {
        double elapsed = recorder->elapsedSeconds();
        menu_.recordingProgress(static_cast<int>(elapsed));
        if (elapsed >= ctx_.settings->voice.maxSeconds) finishRecording();
    }
    refreshPending();
}

// --- intents ------------------------------------------------------------------

void Application::execute(const Intent& intent) {
    switch (intent.type) {
        case IntentType::SendMessage: sendMessage(intent.code); break;
        case IntentType::AcknowledgeNotice: acknowledge(intent.noticeId); break;
        case IntentType::SilenceAlarm: alerts_.silence(); break;
        case IntentType::StartRecording: startRecording(); break;
        case IntentType::StopRecording: finishRecording(); break;
        case IntentType::SendVoice: sendVoice(); break;
        case IntentType::DiscardVoice: discardVoice(); break;
    }
}

void Application::sendMessage(const std::string& code) {
    if (ctx_.outbox == nullptr) {
        menu_.messageFailed("Sin configurar");
        return;
    }
    std::string id, error;
    if (ctx_.outbox->enqueueMessage(code, std::nullopt, ctx_.clock->stamp(), id, error)) {
        menu_.messageQueued(id);
        if (ctx_.wakeLink) ctx_.wakeLink();
    } else {
        LOG_E("No se pudo guardar el mensaje: %s", error.c_str());
        menu_.messageFailed(error);
    }
    refreshPending();
}

void Application::acknowledge(int64_t noticeId) {
    if (ctx_.outbox != nullptr) {
        std::string error;
        if (ctx_.outbox->enqueueNoticeAck(noticeId, "read", error)) {
            if (ctx_.wakeLink) ctx_.wakeLink();
        } else {
            LOG_E("No se pudo guardar la confirmación del aviso: %s", error.c_str());
        }
    }
    if (menu_.notice() == nullptr) alerts_.onNoticeCleared();
}

void Application::startRecording() {
    if (ctx_.recorder == nullptr) {
        menu_.recordingFailed("Voz desactivada");
    } else if (ctx_.voices == nullptr) {
        menu_.recordingFailed("Sin configurar");
    } else if (ctx_.voices->pending() >= ctx_.voices->maxPending()) {
        menu_.recordingFailed("Cola de voz llena");
    } else {
        if (hasRecording_) discardVoice();
        std::string error = ctx_.recorder->start();
        if (error.empty()) {
            menu_.recordingStarted();
        } else {
            LOG_E("No se pudo grabar: %s", error.c_str());
            menu_.recordingFailed(error);
        }
    }
}

void Application::finishRecording() {
    if (ctx_.recorder == nullptr || !ctx_.recorder->recording()) return;
    RecordingResult result = ctx_.recorder->stop();
    if (result.ok) {
        hasRecording_ = true;
        recording_ = result;
        menu_.recordingFinished(result.durationMs);
    } else {
        LOG_E("Grabación inválida: %s", result.error.c_str());
        hasRecording_ = false;
        menu_.recordingFailed(result.error);
    }
}

void Application::sendVoice() {
    if (!hasRecording_ || ctx_.voices == nullptr) {
        menu_.voiceResult("Sin grabación");
        return;
    }
    hasRecording_ = false;
    std::string id;
    switch (ctx_.voices->enqueue(ctx_.recorder->path(), recording_.durationMs, recording_.peak, recording_.stamp, id)) {
        case VoiceQueue::Result::Ok:
            menu_.voiceResult("Guardado en cola", id);
            if (ctx_.wakeUploader) ctx_.wakeUploader();
            break;
        case VoiceQueue::Result::Full:
            ctx_.recorder->discard();
            menu_.voiceResult("Cola de voz llena");
            break;
        case VoiceQueue::Result::Error:
            LOG_E("No se pudo guardar la grabación");
            ctx_.recorder->discard();
            menu_.voiceResult("Error al guardar");
            break;
    }
    refreshPending();
}

void Application::discardVoice() {
    hasRecording_ = false;
    if (ctx_.recorder != nullptr) ctx_.recorder->discard();
}

void Application::sendAlarms(const Assessment& assessment, bool simulated) {
    for (size_t index = 0; index < 2; ++index) {
        const AlarmGroup& group = kAlarmGroups[index];
        Level level = assessment.groupLevel(group.group);
        if (level == Level::Danger && alarmArmed_[index]) {
            alarmArmed_[index] = false;
            std::string detail = utf8Prefix(assessment.detail(group.group) + (simulated ? " (simulado)" : ""), kMaxDetail);
            if (ctx_.outbox != nullptr) {
                std::string id, error;
                if (ctx_.outbox->enqueueMessage(group.code, detail, ctx_.clock->stamp(), id, error)) {
                    if (ctx_.wakeLink) ctx_.wakeLink();
                } else {
                    LOG_E("No se pudo guardar la alarma: %s", error.c_str());
                }
            }
        } else if (level == Level::Normal) {
            alarmArmed_[index] = true;
        }
    }
}

void Application::refreshPending() {
    menu_.pendingMessages = ctx_.outbox != nullptr ? ctx_.outbox->pendingMessages() : 0;
    menu_.pendingVoices = ctx_.voices != nullptr ? static_cast<size_t>(ctx_.voices->pending()) : 0;
}

}  // namespace mining
