#include "mining/renderer.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "mining/catalog.h"
#include "mining/text.h"

namespace mining {

namespace {
constexpr int kLines[] = {15, 27, 39};
constexpr int kFooterLine = 54;
constexpr int kFooterText = 53;

std::string upper(const char* value) {
    std::string out(value);
    for (char& c : out) {
        if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    }
    return out;
}

std::string format(const char* pattern, double value) {
    char buffer[40];
    snprintf(buffer, sizeof buffer, pattern, value);
    return buffer;
}

std::string celsius(const std::optional<double>& value) {
    return value ? format("%.1f \xC2\xB0" "C", *value) : "--";
}
}  // namespace

std::string clockText(int seconds) {
    char buffer[16];
    snprintf(buffer, sizeof buffer, "%d:%02d", seconds / 60, seconds % 60);
    return buffer;
}

std::string linkText(const Menu& menu) {
    if (!menu.link.configured) return "Central: sin configurar";
    return menu.connected() ? "Central: conectada" : "Central: sin enlace";
}

void Renderer::render(const Menu& menu, Canvas& canvas) {
    canvas_ = &canvas;
    canvas.clear();
    canvas.setFont(Font::Small);
    if (menu.notice() != nullptr) {
        noticeOverlay(menu);
    } else if (menu.alarmVisible) {
        alarmOverlay(menu);
    } else {
        header(menu);
        if (!menu.page) {
            main(menu);
        } else if (*menu.page == kMessagesPage) {
            messages(menu);
        } else if (*menu.page == kVoicePage) {
            voice(menu);
        } else {
            lines(detail(menu));
        }
        footerText(footer(menu));
    }
    canvas_ = nullptr;
}

// --- layout pieces --------------------------------------------------------

void Renderer::header(const Menu& menu) {
    text(3, 0, menu.page ? upper(kPages[*menu.page]) : "MINING SYSTEM");
    int x = 124;
    if (menu.link.configured) {
        // Filled dot: linked to the central; hollow: no link.
        canvas_->ellipse(x - 4, 3, x + 2, 9, menu.connected(), true);
        x -= 10;
    }
    Level level = menu.assessment.level;
    if (level == Level::Caution || level == Level::Danger) {
        std::string mark = level == Level::Danger ? "!!" : "!";
        x -= canvas_->textWidth(mark);
        text(x, 0, mark);
        x -= 4;
    }
    if (menu.snapshot.simulated) {
        x -= canvas_->textWidth("SIM");
        text(x, 0, "SIM");
    }
    canvas_->line(0, 12, 127, 12, true);
}

void Renderer::main(const Menu& menu) {
    int last = std::min(menu.offset + Menu::kVisibleRows, kPageCount);
    for (int index = menu.offset, row = 0; index < last; ++index, ++row) {
        int y = 15 + row * 13;
        bool selected = index == menu.selected;
        if (selected) canvas_->box(2, y, 119, y + 11, true);
        icon(index, 5, y + 2, !selected);
        text(18, y, kPages[index], !selected);
    }
    scrollbar(menu.selected, kPageCount);
}

void Renderer::messages(const Menu& menu) {
    if (menu.messageMode == MessageMode::Choose) {
        std::vector<std::string> items;
        for (const auto& option : kMessages) items.push_back(option.label);
        items.push_back("< Volver");
        options(items, menu.messageSelected, menu.messageOffset, Menu::kVisibleRows);
        scrollbar(menu.messageSelected, static_cast<int>(items.size()));
    } else if (menu.messageMode == MessageMode::Confirm) {
        text(3, 15, kMessages[menu.messageSelected].label);
        options({"Enviar", "Cancelar"}, menu.confirmSelected, 0, 2, 29);
    } else {
        lines({menu.deliveryStatus, linkText(menu), "< Volver"});
    }
}

void Renderer::voice(const Menu& menu) {
    switch (menu.voiceMode) {
        case VoiceMode::Recording:
            text(3, 15, "Grabando");
            if (menu.recordingSeconds % 2 == 0) canvas_->ellipse(112, 17, 118, 23, true, true);
            canvas_->setFont(Font::Large);
            text(3, 30, clockText(menu.recordingSeconds));
            canvas_->setFont(Font::Small);
            break;
        case VoiceMode::Confirm:
            text(3, 15, "Duración " + clockText(menu.voiceDurationMs / 1000));
            options({"Enviar", "Descartar"}, menu.voiceConfirmSelected, 0, 2, 29);
            break;
        case VoiceMode::Result:
            lines({menu.voiceStatus, linkText(menu), "< Volver"});
            break;
        case VoiceMode::Idle:
            text(3, 15, "Mensaje de voz");
            options({"Grabar", "< Volver"}, menu.voiceConfirmSelected, 0, 2, 29);
            break;
    }
}

void Renderer::noticeOverlay(const Menu& menu) {
    const NoticeReceived* notice = menu.notice();
    banner(notice->severity != "critical" ? "AVISO CENTRAL" : "AVISO URGENTE");
    wrapped(notice->text, 18);
    if (menu.notices.size() > 1) text(3, 43, "+" + std::to_string(menu.notices.size() - 1) + " aviso(s)");
    footerText("ENTER: enterado");
}

void Renderer::alarmOverlay(const Menu& menu) {
    banner("PELIGRO");
    canvas_->setFont(Font::Large);
    int row = 0;
    for (const auto& condition : menu.assessment.conditions) {
        if (condition.level != Level::Danger || row >= 3) continue;
        text(3, 16 + row * 13, condition.text());
        ++row;
    }
    canvas_->setFont(Font::Small);
    footerText("ENTER: silenciar");
}

std::string Renderer::footer(const Menu& menu) const {
    if (!menu.page) return std::to_string(menu.selected + 1) + "/" + std::to_string(kPageCount) + "   ENTER: abrir";
    if (*menu.page == kMessagesPage) {
        if (menu.messageMode == MessageMode::Choose) return "ENTER: seleccionar";
        if (menu.messageMode == MessageMode::Confirm) return "ENTER: confirmar";
        return "ENTER: volver";
    }
    if (*menu.page == kVoicePage) {
        if (menu.voiceMode == VoiceMode::Recording) return "ENTER: detener";
        if (menu.voiceMode == VoiceMode::Result) return "ENTER: volver";
        return "ENTER: seleccionar";
    }
    return "ENTER: volver";
}

// --- page content -----------------------------------------------------------

std::vector<std::string> Renderer::detail(const Menu& menu) const {
    std::string title = kPages[*menu.page];
    const SensorSnapshot& snapshot = menu.snapshot;
    std::string level = std::string("Nivel: ") + levelLabel(menu.assessment.level);
    if (title == "Estado") {
        std::string status = menu.link.blocked.empty() ? level : "Bloqueo: " + utf8Prefix(menu.link.blocked, 14);
        return {linkText(menu), status,
                "Cola: " + std::to_string(menu.pendingMessages) + " msg, " + std::to_string(menu.pendingVoices) + " voz"};
    }
    if (title == "Gases") {
        std::string value = snapshot.coPpm ? format("CO: %.0f ppm", *snapshot.coPpm)
                            : snapshot.coVolts ? format("CO: %.3f V", *snapshot.coVolts)
                                               : "CO: sin lectura";
        std::string state;
        switch (snapshot.coState) {
            case CoState::Warming: state = "Calentando " + clockText(snapshot.warmupRemaining); break;
            case CoState::Uncalibrated: state = "Sin calibrar (V)"; break;
            case CoState::Error: state = "Sensor con error"; break;
            case CoState::Disabled: state = "Sensor desactivado"; break;
            case CoState::Ok: state = format("%.3f V calibrado", snapshot.coVolts.value_or(0)); break;
        }
        return {value, state, level};
    }
    if (title == "Temperatura") {
        if (snapshot.thermometerState == ThermometerState::Error) return {"Sensor MLX90614", "Sensor con error", level};
        if (snapshot.thermometerState == ThermometerState::Disabled) return {"Sensor MLX90614", "Sensor desactivado", ""};
        return {"Ambiente: " + celsius(snapshot.ambientC), "Objeto: " + celsius(snapshot.objectC), level};
    }
    if (!menu.link.identity) return {"Manilla sin identificar", "Conecta con la central", ""};
    const Identity& identity = *menu.link.identity;
    return {identity.name, identity.minerName.value_or("Sin minero asignado"), identity.zone};
}

// --- drawing helpers --------------------------------------------------------

void Renderer::text(int x, int y, const std::string& value, bool on) { canvas_->text(x, y, oledText(value), on); }

void Renderer::footerText(const std::string& value) {
    canvas_->line(0, kFooterLine, 127, kFooterLine, true);
    text(3, kFooterText, value);
}

void Renderer::lines(const std::vector<std::string>& values) {
    for (size_t index = 0; index < values.size() && index < 3; ++index) text(3, kLines[index], values[index]);
}

void Renderer::options(const std::vector<std::string>& items, int selected, int offset, int rows, int top) {
    int last = std::min(offset + rows, static_cast<int>(items.size()));
    for (int index = offset, row = 0; index < last; ++index, ++row) {
        int y = top + row * 13;
        if (index == selected) canvas_->box(2, y, 119, y + 11, true);
        text(5, y, items[index], index != selected);
    }
}

void Renderer::banner(const std::string& value) {
    canvas_->box(0, 0, 127, 12, true);
    text(3, 0, value, false);
}

void Renderer::wrapped(const std::string& value, int top) {
    canvas_->setFont(Font::Large);
    std::vector<std::string> result;
    std::string current;
    for (const std::string& word : splitWords(oledText(value))) {
        std::string candidate = current.empty() ? word : current + " " + word;
        if (current.empty() || canvas_->textWidth(candidate) <= 122) {
            current = candidate;
        } else {
            result.push_back(current);
            current = word;
        }
    }
    result.push_back(current);
    for (size_t index = 0; index < result.size() && index < 2; ++index) text(3, top + static_cast<int>(index) * 13, result[index]);
    canvas_->setFont(Font::Small);
}

void Renderer::scrollbar(int selected, int count) {
    canvas_->line(124, 16, 124, 51, true);
    int top = 16 + static_cast<int>(std::lround(selected * 28.0 / std::max(1, count - 1)));
    canvas_->box(123, top, 125, top + 7, true);
}

void Renderer::icon(int index, int x, int y, bool on) {
    switch (index) {
        case 0:  // Estado: monitor
            canvas_->frame(x, y, x + 8, y + 6, on);
            canvas_->line(x + 2, y + 8, x + 6, y + 8, on);
            break;
        case 1:  // Gases: bubbles
            canvas_->ellipse(x, y + 3, x + 5, y + 8, false, on);
            canvas_->ellipse(x + 3, y, x + 8, y + 5, false, on);
            break;
        case 2:  // Temperatura: thermometer
            canvas_->frame(x + 3, y, x + 5, y + 5, on);
            canvas_->ellipse(x + 2, y + 4, x + 6, y + 8, false, on);
            break;
        case 3:  // Mensajes: speech bubble
            canvas_->frame(x, y, x + 8, y + 6, on);
            canvas_->line(x + 2, y + 6, x + 2, y + 8, on);
            break;
        case 4:  // Voz: microphone
            canvas_->roundedFrame(x + 2, y, x + 6, y + 5, 2, on);
            canvas_->line(x, y + 3, x, y + 4, on);
            canvas_->line(x + 8, y + 3, x + 8, y + 4, on);
            canvas_->line(x + 1, y + 5, x + 1, y + 5, on);
            canvas_->line(x + 7, y + 5, x + 7, y + 5, on);
            canvas_->line(x + 2, y + 6, x + 6, y + 6, on);
            canvas_->line(x + 4, y + 7, x + 4, y + 8, on);
            break;
        default:  // Ajustes
            canvas_->ellipse(x, y, x + 8, y + 8, false, on);
            canvas_->box(x + 3, y + 3, x + 5, y + 5, on);
            break;
    }
}

}  // namespace mining
