#include "mining/menu.h"

#include "mining/catalog.h"

namespace mining {

const char* const kPages[kPageCount] = {"Estado", "Gases", "Temperatura", "Mensajes", "Voz", "Ajustes"};

namespace {
// Central notices kept in memory; older ones stay in the outbox confirmations.
constexpr size_t kMaxNotices = 10;
}

void Menu::transport(const TransportEvent& event) {
    switch (event.kind) {
        case TransportKind::Connected: link.connected = true; break;
        case TransportKind::Disconnected: link.connected = false; break;
        case TransportKind::Identity:
            link.identity = event.identity;
            link.blocked.clear();
            break;
        case TransportKind::Blocked: link.blocked = event.detail; break;
        case TransportKind::Delivered:
            link.blocked.clear();
            if (!pendingId.empty() && event.messageId == pendingId) deliveryStatus = "Enviado a central";
            break;
        case TransportKind::Rejected:
            if (!pendingId.empty() && event.messageId == pendingId) deliveryStatus = "Rechazado";
            break;
    }
}

void Menu::monitor(const SensorSnapshot& value, const Assessment& result) {
    if (result.level == Level::Danger && assessment.level != Level::Danger) {
        alarmVisible = true;
    } else if (result.level != Level::Danger) {
        alarmVisible = false;
    }
    snapshot = value;
    assessment = result;
}

bool Menu::receiveNotice(const NoticeReceived& notice) {
    for (const auto& current : notices) {
        if (current.noticeId == notice.noticeId) return false;
    }
    if (notices.size() >= kMaxNotices) return false;
    notices.push_back(notice);
    return true;
}

void Menu::messageQueued(const std::string& messageId) {
    pendingId = messageId;
    deliveryStatus = "Guardado en cola";
}

void Menu::messageFailed(const std::string& status) {
    pendingId.clear();
    deliveryStatus = status;
}

void Menu::recordingStarted() {
    voiceMode = VoiceMode::Recording;
    recordingSeconds = 0;
}

void Menu::recordingProgress(int seconds) { recordingSeconds = seconds; }

void Menu::recordingFinished(int durationMs) {
    voiceMode = VoiceMode::Confirm;
    voiceDurationMs = durationMs;
    voiceConfirmSelected = 0;
}

void Menu::recordingFailed(const std::string& status) {
    voiceMode = VoiceMode::Result;
    voiceStatus = status;
    voiceConfirmSelected = 0;
}

void Menu::voiceResult(const std::string& status, const std::string& voiceId) {
    voiceMode = VoiceMode::Result;
    voiceStatus = status;
    pendingVoiceId = voiceId;
}

void Menu::voiceUploaded(const std::string& voiceId) {
    if (!pendingVoiceId.empty() && voiceId == pendingVoiceId) voiceStatus = "Enviado a central";
}

void Menu::voiceRejected(const std::string& voiceId) {
    if (!pendingVoiceId.empty() && voiceId == pendingVoiceId) voiceStatus = "Rechazado";
}

std::vector<Intent> Menu::handle(Action action) {
    if (!notices.empty()) {
        if (action != Action::Enter) return {};
        Intent intent{IntentType::AcknowledgeNotice, "", notices.front().noticeId};
        notices.erase(notices.begin());
        return {intent};
    }
    if (alarmVisible) {
        if (action != Action::Enter) return {};
        alarmVisible = false;
        return {{IntentType::SilenceAlarm}};
    }
    if (page == kMessagesPage) return messages(action);
    if (page == kVoicePage) return voice(action);
    if (page) {
        if (action == Action::Enter) page.reset();
        return {};
    }
    if (action == Action::Enter) {
        page = selected;
        if (page == kMessagesPage) {
            messageMode = MessageMode::Choose;
        } else if (page == kVoicePage) {
            voiceMode = VoiceMode::Idle;
            voiceConfirmSelected = 0;
        }
        return {};
    }
    scroll(selected, offset, kPageCount, action, kVisibleRows);
    return {};
}

std::vector<Intent> Menu::messages(Action action) {
    if (messageMode == MessageMode::Result) {
        if (action == Action::Enter) messageMode = MessageMode::Choose;
        return {};
    }
    if (messageMode == MessageMode::Confirm) {
        if (action != Action::Enter) {
            confirmSelected = 1 - confirmSelected;
            return {};
        }
        if (confirmSelected == 1) {
            messageMode = MessageMode::Choose;
            return {};
        }
        messageMode = MessageMode::Result;
        return {{IntentType::SendMessage, kMessages[messageSelected].code}};
    }
    if (action == Action::Enter) {
        if (messageSelected == static_cast<int>(kMessageCount)) {
            page.reset();
            messageMode = MessageMode::None;
        } else {
            confirmSelected = 0;
            messageMode = MessageMode::Confirm;
        }
        return {};
    }
    scroll(messageSelected, messageOffset, static_cast<int>(kMessageCount) + 1, action, kVisibleRows);
    return {};
}

std::vector<Intent> Menu::voice(Action action) {
    switch (voiceMode) {
        case VoiceMode::Recording:
            return action == Action::Enter ? std::vector<Intent>{{IntentType::StopRecording}} : std::vector<Intent>{};
        case VoiceMode::Confirm:
            if (action != Action::Enter) {
                voiceConfirmSelected = 1 - voiceConfirmSelected;
                return {};
            }
            if (voiceConfirmSelected == 1) {
                voiceMode = VoiceMode::Idle;
                voiceConfirmSelected = 0;
                return {{IntentType::DiscardVoice}};
            }
            return {{IntentType::SendVoice}};
        case VoiceMode::Result:
            if (action == Action::Enter) {
                voiceMode = VoiceMode::Idle;
                voiceConfirmSelected = 0;
            }
            return {};
        case VoiceMode::Idle:
            break;
    }
    // Idle: two options, Grabar and Volver.
    if (action != Action::Enter) {
        voiceConfirmSelected = 1 - voiceConfirmSelected;
        return {};
    }
    if (voiceConfirmSelected == 1) {
        page.reset();
        voiceConfirmSelected = 0;
        return {};
    }
    return {{IntentType::StartRecording}};
}

void scroll(int& selected, int& offset, int count, Action action, int rows) {
    selected = ((selected + (action == Action::Up ? -1 : 1)) % count + count) % count;
    if (selected < offset) {
        offset = selected;
    } else if (selected >= offset + rows) {
        offset = selected - rows + 1;
    }
}

}  // namespace mining
