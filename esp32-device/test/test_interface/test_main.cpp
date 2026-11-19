// Menú y pantalla (equivalente a tests/test_interface.py y la parte de menú de test_messages.py).
#include <unity.h>

#include "../fakes.h"
#include "mining/catalog.h"
#include "mining/menu.h"
#include "mining/renderer.h"

using namespace mining;

void setUp() {}
void tearDown() {}

static void press(Menu& menu, Action action, int times = 1) {
    for (int i = 0; i < times; ++i) menu.handle(action);
}

static FakeCanvas draw(const Menu& menu) {
    FakeCanvas canvas;
    Renderer renderer;
    renderer.render(menu, canvas);
    return canvas;
}

void test_wrap_and_scroll_keep_selection_visible() {
    Menu menu;
    press(menu, Action::Up);
    TEST_ASSERT_EQUAL(kPageCount - 1, menu.selected);
    TEST_ASSERT_EQUAL(kPageCount - Menu::kVisibleRows, menu.offset);
    press(menu, Action::Down);
    TEST_ASSERT_EQUAL(0, menu.selected);
    TEST_ASSERT_EQUAL(0, menu.offset);
    press(menu, Action::Down, 3);
    TEST_ASSERT_EQUAL(3, menu.selected);
    TEST_ASSERT_EQUAL(1, menu.offset);
}

void test_every_page_returns_to_same_selection() {
    for (int index = 0; index < kPageCount; ++index) {
        if (index == kMessagesPage || index == kVoicePage) continue;
        Menu menu;
        press(menu, Action::Down, index);
        press(menu, Action::Enter);
        TEST_ASSERT_TRUE(menu.page.has_value());
        TEST_ASSERT_EQUAL(index, *menu.page);
        // Up/Down do nothing inside a detail page.
        press(menu, Action::Down);
        press(menu, Action::Enter);
        TEST_ASSERT_FALSE(menu.page.has_value());
        TEST_ASSERT_EQUAL(index, menu.selected);
    }
}

void test_selection_does_not_send_until_confirmed() {
    Menu menu;
    press(menu, Action::Down, kMessagesPage);
    press(menu, Action::Enter);
    TEST_ASSERT_EQUAL(MessageMode::Choose, menu.messageMode);
    press(menu, Action::Down, 2);
    TEST_ASSERT_EQUAL(0u, menu.handle(Action::Enter).size());
    TEST_ASSERT_EQUAL(MessageMode::Confirm, menu.messageMode);
    std::vector<Intent> intents = menu.handle(Action::Enter);
    TEST_ASSERT_EQUAL(1u, intents.size());
    TEST_ASSERT_EQUAL(IntentType::SendMessage, intents[0].type);
    TEST_ASSERT_EQUAL_STRING("COLLAPSE", intents[0].code.c_str());
    TEST_ASSERT_EQUAL(MessageMode::Result, menu.messageMode);
    press(menu, Action::Enter);
    TEST_ASSERT_EQUAL(MessageMode::Choose, menu.messageMode);
}

void test_cancel_never_sends() {
    Menu menu;
    press(menu, Action::Down, kMessagesPage);
    press(menu, Action::Enter);
    press(menu, Action::Enter);
    press(menu, Action::Down);
    TEST_ASSERT_EQUAL(0u, menu.handle(Action::Enter).size());
    TEST_ASSERT_EQUAL(MessageMode::Choose, menu.messageMode);
}

void test_every_code_can_be_selected_and_returned() {
    for (size_t index = 0; index < kMessageCount; ++index) {
        Menu menu;
        press(menu, Action::Down, kMessagesPage);
        press(menu, Action::Enter);
        press(menu, Action::Down, static_cast<int>(index));
        press(menu, Action::Enter);
        std::vector<Intent> intents = menu.handle(Action::Enter);
        TEST_ASSERT_EQUAL_STRING(kMessages[index].code, intents.at(0).code.c_str());
    }
    // The last row returns to the main menu.
    Menu menu;
    press(menu, Action::Down, kMessagesPage);
    press(menu, Action::Enter);
    press(menu, Action::Up);
    press(menu, Action::Enter);
    TEST_ASSERT_FALSE(menu.page.has_value());
}

void test_failure_never_claims_delivery() {
    Menu menu;
    menu.link.configured = true;
    menu.messageFailed("Sin configurar");
    TransportEvent delivered{TransportKind::Delivered, "", "", {}};
    menu.transport(delivered);
    TEST_ASSERT_EQUAL_STRING("Sin configurar", menu.deliveryStatus.c_str());
    menu.messageQueued("abc");
    delivered.messageId = "other";
    menu.transport(delivered);
    TEST_ASSERT_EQUAL_STRING("Guardado en cola", menu.deliveryStatus.c_str());
    delivered.messageId = "abc";
    menu.transport(delivered);
    TEST_ASSERT_EQUAL_STRING("Enviado a central", menu.deliveryStatus.c_str());
}

void test_voice_page_flow() {
    Menu menu;
    press(menu, Action::Down, kVoicePage);
    press(menu, Action::Enter);
    TEST_ASSERT_EQUAL(VoiceMode::Idle, menu.voiceMode);
    std::vector<Intent> intents = menu.handle(Action::Enter);
    TEST_ASSERT_EQUAL(IntentType::StartRecording, intents.at(0).type);
    menu.recordingStarted();
    TEST_ASSERT_EQUAL(0u, menu.handle(Action::Down).size());
    TEST_ASSERT_EQUAL(IntentType::StopRecording, menu.handle(Action::Enter).at(0).type);
    menu.recordingFinished(4200);
    press(menu, Action::Down);
    TEST_ASSERT_EQUAL(IntentType::DiscardVoice, menu.handle(Action::Enter).at(0).type);
    TEST_ASSERT_EQUAL(VoiceMode::Idle, menu.voiceMode);
    press(menu, Action::Down);
    press(menu, Action::Enter);
    TEST_ASSERT_FALSE(menu.page.has_value());
}

void test_frames_change_on_navigation() {
    Menu menu;
    FakeCanvas first = draw(menu);
    TEST_ASSERT_TRUE(first.hasText("MINING SYSTEM"));
    TEST_ASSERT_TRUE(first.hasText("1/6   ENTER: abrir"));
    press(menu, Action::Down);
    FakeCanvas second = draw(menu);
    TEST_ASSERT_TRUE(first.ops != second.ops);
    TEST_ASSERT_TRUE(second.hasText("2/6"));
    // The selected row is drawn inverted.
    TEST_ASSERT_TRUE(second.hasText("inv Gases"));
}

void test_live_readings_change_the_frames() {
    Menu menu;
    press(menu, Action::Down);
    press(menu, Action::Enter);
    SensorSnapshot snapshot;
    snapshot.coVolts = 0.412;
    snapshot.coState = CoState::Uncalibrated;
    menu.monitor(snapshot, Assessment{});
    FakeCanvas canvas = draw(menu);
    TEST_ASSERT_TRUE(canvas.hasText("CO: 0.412 V"));
    TEST_ASSERT_TRUE(canvas.hasText("Sin calibrar (V)"));
    snapshot.coPpm = 42;
    snapshot.coState = CoState::Ok;
    menu.monitor(snapshot, Assessment{});
    canvas = draw(menu);
    TEST_ASSERT_TRUE(canvas.hasText("CO: 42 ppm"));
    snapshot.warmupRemaining = 95;
    snapshot.coState = CoState::Warming;
    menu.monitor(snapshot, Assessment{});
    TEST_ASSERT_TRUE(draw(menu).hasText("Calentando 1:35"));
}

void test_notice_and_alarm_overlays_take_priority() {
    Menu menu;
    AlertsConfig config;
    config.confirmSamples = 1;
    ThresholdEvaluator evaluator(config);
    SensorSnapshot snapshot;
    snapshot.coPpm = 260;
    menu.monitor(snapshot, evaluator.update(snapshot));
    TEST_ASSERT_TRUE(menu.alarmVisible);
    NoticeReceived notice;
    notice.noticeId = 7;
    notice.text = "Evacuar ahora por la galería norte";
    notice.severity = "critical";
    TEST_ASSERT_TRUE(menu.receiveNotice(notice));
    TEST_ASSERT_FALSE(menu.receiveNotice(notice));
    FakeCanvas canvas = draw(menu);
    TEST_ASSERT_TRUE(canvas.hasText("AVISO URGENTE"));
    TEST_ASSERT_TRUE(canvas.hasText("galería"));
    TEST_ASSERT_EQUAL(0u, menu.handle(Action::Down).size());
    std::vector<Intent> intents = menu.handle(Action::Enter);
    TEST_ASSERT_EQUAL(IntentType::AcknowledgeNotice, intents.at(0).type);
    TEST_ASSERT_EQUAL(7, intents.at(0).noticeId);
    canvas = draw(menu);
    TEST_ASSERT_TRUE(canvas.hasText("PELIGRO"));
    TEST_ASSERT_TRUE(canvas.hasText("CO 260 ppm"));
    TEST_ASSERT_EQUAL(IntentType::SilenceAlarm, menu.handle(Action::Enter).at(0).type);
    TEST_ASSERT_FALSE(menu.alarmVisible);
    TEST_ASSERT_TRUE(draw(menu).hasText("MINING SYSTEM"));
}

void test_identity_and_link_state() {
    Menu menu;
    menu.link.configured = true;
    press(menu, Action::Up);
    press(menu, Action::Enter);
    FakeCanvas canvas = draw(menu);
    TEST_ASSERT_TRUE(canvas.hasText("AJUSTES"));
    TEST_ASSERT_TRUE(canvas.hasText("Manilla sin identificar"));
    TEST_ASSERT_TRUE(std::find(canvas.ops.begin(), canvas.ops.end(), "ellipse 120,3,126,9") != canvas.ops.end());
    TransportEvent identity{TransportKind::Identity, "", "", {"Manilla 01", std::string("Javier Mamani"), "Galería norte"}};
    menu.transport(identity);
    menu.transport(TransportEvent{TransportKind::Connected, "", "", {}});
    canvas = draw(menu);
    TEST_ASSERT_TRUE(canvas.hasText("Javier Mamani"));
    TEST_ASSERT_TRUE(canvas.hasText("Galería norte"));
    TEST_ASSERT_TRUE(std::find(canvas.ops.begin(), canvas.ops.end(), "disc 120,3,126,9") != canvas.ops.end());
    menu.link.identity->minerName.reset();
    TEST_ASSERT_TRUE(draw(menu).hasText("Sin minero asignado"));
}

void test_oled_text_keeps_latin1_and_drops_the_rest() {
    TEST_ASSERT_EQUAL_STRING("Compañero 41.0 °C", oledText("Compañero 41.0 °C").c_str());
    TEST_ASSERT_EQUAL_STRING("\"hola\" - ok...", oledText("\xE2\x80\x9Chola\xE2\x80\x9D \xE2\x80\x94 ok\xE2\x80\xA6").c_str());
    TEST_ASSERT_EQUAL_STRING("Mina ", oledText("Mina \xF0\x9F\x98\x80").c_str());
    TEST_ASSERT_EQUAL_STRING("Galer", utf8Prefix("Galería", 5).c_str());
    TEST_ASSERT_EQUAL_STRING("Galerí", utf8Prefix("Galería", 6).c_str());
    TEST_ASSERT_EQUAL(7u, utf8Length("Galería"));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_wrap_and_scroll_keep_selection_visible);
    RUN_TEST(test_every_page_returns_to_same_selection);
    RUN_TEST(test_selection_does_not_send_until_confirmed);
    RUN_TEST(test_cancel_never_sends);
    RUN_TEST(test_every_code_can_be_selected_and_returned);
    RUN_TEST(test_failure_never_claims_delivery);
    RUN_TEST(test_voice_page_flow);
    RUN_TEST(test_frames_change_on_navigation);
    RUN_TEST(test_live_readings_change_the_frames);
    RUN_TEST(test_notice_and_alarm_overlays_take_priority);
    RUN_TEST(test_identity_and_link_state);
    RUN_TEST(test_oled_text_keeps_latin1_and_drops_the_rest);
    return UNITY_END();
}
