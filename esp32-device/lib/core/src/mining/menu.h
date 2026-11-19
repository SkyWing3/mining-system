// Estado de navegación de la OLED; no accede a sensores, red ni GPIO (display/menu.py).
//
// `Menu::handle()` devuelve intenciones (enviar, grabar, confirmar un aviso...)
// que ejecuta la aplicación; el resultado vuelve al menú mediante sus métodos.
#pragma once

#include <optional>
#include <string>
#include <vector>

#include "mining/events.h"
#include "mining/levels.h"
#include "mining/readings.h"

namespace mining {

constexpr int kPageCount = 6;
extern const char* const kPages[kPageCount];
constexpr int kMessagesPage = 3;
constexpr int kVoicePage = 4;

enum class IntentType : uint8_t { SendMessage, StartRecording, StopRecording, SendVoice, DiscardVoice, AcknowledgeNotice, SilenceAlarm };

struct Intent {
    Intent(IntentType type, std::string code = "", int64_t noticeId = 0) : type(type), code(std::move(code)), noticeId(noticeId) {}

    IntentType type;
    std::string code;
    int64_t noticeId;
};

enum class MessageMode : uint8_t { None, Choose, Confirm, Result };
enum class VoiceMode : uint8_t { Idle, Recording, Confirm, Result };

struct LinkState {
    bool configured = false;
    bool connected = false;
    std::optional<Identity> identity;
    std::string blocked;
};

class Menu {
public:
    static constexpr int kVisibleRows = 3;

    // --- live updates ---
    bool connected() const { return link.connected; }
    const NoticeReceived* notice() const { return notices.empty() ? nullptr : &notices.front(); }
    void transport(const TransportEvent& event);
    void monitor(const SensorSnapshot& snapshot, const Assessment& assessment);
    // Queue a notice for display; returns false if it is already shown or queued.
    bool receiveNotice(const NoticeReceived& notice);

    // --- results of intents ---
    void messageQueued(const std::string& messageId);
    void messageFailed(const std::string& status);
    void recordingStarted();
    void recordingProgress(int seconds);
    void recordingFinished(int durationMs);
    void recordingFailed(const std::string& status);
    void voiceResult(const std::string& status, const std::string& voiceId = "");
    void voiceUploaded(const std::string& voiceId);
    void voiceRejected(const std::string& voiceId);

    // --- navigation ---
    std::vector<Intent> handle(Action action);

    int selected = 0;
    int offset = 0;
    std::optional<int> page;
    // Messages page.
    MessageMode messageMode = MessageMode::None;
    int messageSelected = 0;
    int messageOffset = 0;
    int confirmSelected = 0;
    std::string pendingId;
    std::string deliveryStatus;
    // Voice page.
    VoiceMode voiceMode = VoiceMode::Idle;
    std::string voiceStatus;
    int voiceConfirmSelected = 0;
    int voiceDurationMs = 0;
    int recordingSeconds = 0;
    std::string pendingVoiceId;
    // Live data.
    LinkState link;
    SensorSnapshot snapshot;
    Assessment assessment;
    size_t pendingMessages = 0;
    size_t pendingVoices = 0;
    // Overlays: central notices first, then the danger alarm.
    std::vector<NoticeReceived> notices;
    bool alarmVisible = false;

private:
    std::vector<Intent> messages(Action action);
    std::vector<Intent> voice(Action action);
};

// Move the selection with wrap-around and keep it inside the visible window.
void scroll(int& selected, int& offset, int count, Action action, int rows);

}  // namespace mining
