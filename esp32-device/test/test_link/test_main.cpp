// Protocolo con la central (equivalente a la parte de cliente de tests/test_messages.py).
#include <unity.h>

#include <ArduinoJson.h>

#include "../fakes.h"
#include "mining/link_session.h"

using namespace mining;

void setUp() {}
void tearDown() {}

namespace {

const char kServerTime[] = "2026-11-16T19:04:05.1234567Z";

struct Harness {
    MemoryStore store;
    Counter random;
    FakeClock clock;
    WallClock wall{1, clock.fn()};
    Outbox outbox{store, "/out", random.fn()};
    EventQueue events{100};
    std::optional<TelemetryReading> reading;
    LinkSession session{LinkTiming{}, outbox, wall, events, [this] { return reading; }};
    std::vector<std::string> sent;
    bool sendFails = false;

    Harness() {
        std::string error;
        outbox.load(error);
    }

    void open() {
        session.opened(clock.now, [this](const std::string& frame) {
            if (sendFails) return false;
            sent.push_back(frame);
            return true;
        });
    }

    JsonDocument last() {
        JsonDocument document;
        deserializeJson(document, sent.back());
        return document;
    }

    void reply(const std::string& json) { session.received(json, clock.now); }

    void ack(const std::string& extra = "") {
        reply(std::string("{\"type\":\"ack\",\"serverTime\":\"") + kServerTime + "\"" + (extra.empty() ? "" : "," + extra) + "}");
    }

    std::vector<Event> drain() {
        std::vector<Event> result;
        while (std::optional<Event> event = events.pop(0)) result.push_back(*event);
        return result;
    }

    std::vector<TransportKind> transportKinds() {
        std::vector<TransportKind> kinds;
        for (const Event& event : drain()) {
            if (const TransportEvent* transport = std::get_if<TransportEvent>(&event)) kinds.push_back(transport->kind);
        }
        return kinds;
    }

    void handshake() {
        open();
        ack("\"device\":{\"name\":\"Manilla 01\",\"minerName\":\"Javier Mamani\",\"zone\":\"Galería norte\"}");
    }
};

}  // namespace

void test_handshake_reports_identity_and_synchronizes_clock() {
    Harness h;
    h.open();
    TEST_ASSERT_EQUAL(1u, h.sent.size());
    TEST_ASSERT_EQUAL_STRING("heartbeat", h.last()["type"]);
    TEST_ASSERT_FALSE(h.session.connected());
    h.ack("\"device\":{\"name\":\"Manilla 01\",\"minerName\":null,\"zone\":\"Galería norte\"}");
    TEST_ASSERT_TRUE(h.session.connected());
    TEST_ASSERT_TRUE(h.wall.synced());
    TEST_ASSERT_EQUAL_STRING("2026-11-16T19:04:05.123Z", formatIso(*h.wall.now()).c_str());
    std::vector<Event> events = h.drain();
    TEST_ASSERT_EQUAL(2u, events.size());
    TEST_ASSERT_EQUAL(TransportKind::Connected, std::get<TransportEvent>(events[0]).kind);
    const TransportEvent& identity = std::get<TransportEvent>(events[1]);
    TEST_ASSERT_EQUAL(TransportKind::Identity, identity.kind);
    TEST_ASSERT_EQUAL_STRING("Manilla 01", identity.identity.name.c_str());
    TEST_ASSERT_FALSE(identity.identity.minerName.has_value());
    TEST_ASSERT_EQUAL_STRING("Galería norte", identity.identity.zone.c_str());
}

void test_delivers_queue_in_order_one_at_a_time() {
    Harness h;
    std::string first, second, error;
    h.outbox.enqueueMessage("HELP", std::nullopt, Stamp{-1, 1, 0}, first, error);
    h.outbox.enqueueMessage("OK", std::nullopt, Stamp{-1, 1, 0}, second, error);
    h.handshake();
    h.drain();
    // Right after the handshake ack, the first entry goes out (dated with the central's time).
    TEST_ASSERT_EQUAL(2u, h.sent.size());
    JsonDocument frame = h.last();
    TEST_ASSERT_EQUAL_STRING(first.c_str(), frame["clientMessageId"]);
    TEST_ASSERT_TRUE(frame["sentAt"].is<const char*>());
    TEST_ASSERT_TRUE(frame["_boot"].isNull());
    // Nothing else is sent while it is in flight.
    h.session.poll(h.clock.now);
    TEST_ASSERT_EQUAL(2u, h.sent.size());
    h.ack("\"clientMessageId\":\"" + first + "\",\"messageId\":41");
    TEST_ASSERT_EQUAL(1u, h.outbox.pending());
    TEST_ASSERT_EQUAL_STRING(second.c_str(), h.last()["clientMessageId"]);
    h.ack("\"clientMessageId\":\"" + second + "\",\"messageId\":42");
    TEST_ASSERT_EQUAL(0u, h.outbox.pending());
    std::vector<TransportKind> kinds = h.transportKinds();
    TEST_ASSERT_EQUAL(2u, kinds.size());
    TEST_ASSERT_EQUAL(TransportKind::Delivered, kinds[0]);
}

void test_mismatched_ack_keeps_message_in_outbox() {
    Harness h;
    std::string id, error;
    h.handshake();
    h.outbox.enqueueMessage("HELP", std::nullopt, h.wall.stamp(), id, error);
    h.session.poll(h.clock.now);
    h.ack("\"clientMessageId\":\"otro\",\"messageId\":41");
    TEST_ASSERT_TRUE(h.session.failed());
    TEST_ASSERT_EQUAL(1u, h.outbox.pending());
    h.session.closed("cerrado");
    TEST_ASSERT_FALSE(h.session.open());
    std::vector<TransportKind> kinds = h.transportKinds();
    TEST_ASSERT_EQUAL(TransportKind::Disconnected, kinds.back());
}

void test_invalid_frame_is_rejected_and_unassigned_is_kept() {
    Harness h;
    std::string bad, kept, error;
    h.handshake();
    h.drain();
    h.outbox.enqueueMessage("HELP", std::nullopt, h.wall.stamp(), bad, error);
    h.outbox.enqueueMessage("OK", std::nullopt, h.wall.stamp(), kept, error);
    h.session.poll(h.clock.now);
    h.reply("{\"type\":\"error\",\"code\":\"invalid\",\"message\":\"Mensaje fuera del catálogo.\"}");
    TEST_ASSERT_EQUAL(1u, h.outbox.pending());
    // The next entry goes out immediately and the central has no miner assigned.
    TEST_ASSERT_EQUAL_STRING(kept.c_str(), h.last()["clientMessageId"]);
    h.reply("{\"type\":\"error\",\"code\":\"unassigned\",\"message\":\"La manilla necesita un minero asignado.\"}");
    TEST_ASSERT_FALSE(h.session.failed());
    TEST_ASSERT_EQUAL(1u, h.outbox.pending());
    std::vector<Event> events = h.drain();
    TEST_ASSERT_EQUAL(TransportKind::Rejected, std::get<TransportEvent>(events[0]).kind);
    TEST_ASSERT_EQUAL_STRING(bad.c_str(), std::get<TransportEvent>(events[0]).messageId.c_str());
    TEST_ASSERT_EQUAL(TransportKind::Blocked, std::get<TransportEvent>(events[1]).kind);
    // While blocked, messages wait...
    size_t sent = h.sent.size();
    h.session.poll(h.clock.now);
    TEST_ASSERT_EQUAL(sent, h.sent.size());
    // ...but notice confirmations still go out.
    h.outbox.enqueueNoticeAck(5, "read", error);
    h.session.poll(h.clock.now);
    TEST_ASSERT_EQUAL(sent + 1, h.sent.size());
    TEST_ASSERT_EQUAL_STRING("notice-ack", h.last()["type"]);
    // As in the Python client, any confirmed delivery lifts the block and the message is retried.
    h.ack();
    TEST_ASSERT_EQUAL_STRING(kept.c_str(), h.last()["clientMessageId"]);
    h.reply("{\"type\":\"error\",\"code\":\"unassigned\",\"message\":\"La manilla necesita un minero asignado.\"}");
    sent = h.sent.size();
    h.clock.now += 9999;
    h.session.poll(h.clock.now);
    TEST_ASSERT_EQUAL(sent, h.sent.size());
    h.clock.now += 1;
    h.session.poll(h.clock.now);
    TEST_ASSERT_EQUAL_STRING(kept.c_str(), h.last()["clientMessageId"]);
}

void test_live_telemetry_is_sent_periodically() {
    Harness h;
    h.reading = TelemetryReading{24.5, 26.123456, std::nullopt, 0.4123, Level::Caution, false};
    h.handshake();
    size_t sent = h.sent.size();
    h.clock.now += 1999;
    h.session.poll(h.clock.now);
    TEST_ASSERT_EQUAL(sent, h.sent.size());
    h.clock.now += 1;
    h.session.poll(h.clock.now);
    JsonDocument frame = h.last();
    TEST_ASSERT_EQUAL_STRING("telemetry", frame["type"]);
    TEST_ASSERT_EQUAL_DOUBLE(24.5, frame["temperatureC"].as<double>());
    TEST_ASSERT_DOUBLE_WITHIN(1e-4, 26.123456, frame["objectTemperatureC"].as<double>());
    TEST_ASSERT_TRUE(frame["gasPpm"].isNull());
    TEST_ASSERT_EQUAL_STRING("caution", frame["level"]);
    TEST_ASSERT_FALSE(frame["simulated"].as<bool>());
    // A rejected reading never blocks the link.
    h.reply("{\"type\":\"error\",\"code\":\"invalid\",\"message\":\"Lectura inválida\"}");
    TEST_ASSERT_FALSE(h.session.failed());
    // Without readings the link falls back to heartbeats.
    h.reading.reset();
    h.clock.now += 20000;
    h.session.poll(h.clock.now);
    TEST_ASSERT_EQUAL_STRING("heartbeat", h.last()["type"]);
}

void test_pushed_notice_is_shown_and_confirmed() {
    Harness h;
    h.handshake();
    h.drain();
    h.reply("{\"type\":\"notice\",\"noticeId\":12,\"code\":\"EVACUATE\",\"text\":\"Evacuar ahora\",\"severity\":\"critical\"}");
    std::vector<Event> events = h.drain();
    TEST_ASSERT_EQUAL(1u, events.size());
    const NoticeReceived& notice = std::get<NoticeReceived>(events[0]);
    TEST_ASSERT_EQUAL(12, notice.noticeId);
    TEST_ASSERT_EQUAL_STRING("Evacuar ahora", notice.text.c_str());
    TEST_ASSERT_EQUAL_STRING("critical", notice.severity.c_str());
    TEST_ASSERT_TRUE(h.outbox.hasNoticeAck(12, "delivered"));
    // Delivered again on reconnection: no duplicate confirmation.
    h.reply("{\"type\":\"notice\",\"noticeId\":12,\"code\":\"EVACUATE\",\"text\":\"Evacuar ahora\"}");
    TEST_ASSERT_EQUAL(1u, h.outbox.pending());
    // Read offline: not shown again.
    std::string error;
    h.outbox.enqueueNoticeAck(13, "read", error);
    h.reply("{\"type\":\"notice\",\"noticeId\":13,\"text\":\"Ya leído\"}");
    h.reply("{\"type\":\"notice\",\"noticeId\":true}");
    events = h.drain();
    TEST_ASSERT_EQUAL(1u, events.size());
    TEST_ASSERT_EQUAL(12, std::get<NoticeReceived>(events[0]).noticeId);
}

void test_timeouts_and_errors_drop_the_session() {
    Harness h;
    h.open();
    h.clock.now += 9999;
    h.session.poll(h.clock.now);
    TEST_ASSERT_FALSE(h.session.failed());
    h.clock.now += 1;
    h.session.poll(h.clock.now);
    TEST_ASSERT_TRUE(h.session.failed());

    Harness unauthorized;
    unauthorized.open();
    unauthorized.reply("{\"type\":\"error\",\"code\":\"unauthorized\",\"message\":\"Credencial inválida\"}");
    TEST_ASSERT_TRUE(unauthorized.session.failed());
    TEST_ASSERT_FALSE(unauthorized.session.connected());

    Harness garbage;
    garbage.open();
    garbage.reply("no es json");
    TEST_ASSERT_FALSE(garbage.session.failed());
    garbage.reply("{\"type\":\"pong\"}");
    TEST_ASSERT_TRUE(garbage.session.failed());

    Harness broken;
    broken.sendFails = true;
    broken.open();
    TEST_ASSERT_TRUE(broken.session.failed());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_handshake_reports_identity_and_synchronizes_clock);
    RUN_TEST(test_delivers_queue_in_order_one_at_a_time);
    RUN_TEST(test_mismatched_ack_keeps_message_in_outbox);
    RUN_TEST(test_invalid_frame_is_rejected_and_unassigned_is_kept);
    RUN_TEST(test_live_telemetry_is_sent_periodically);
    RUN_TEST(test_pushed_notice_is_shown_and_confirmed);
    RUN_TEST(test_timeouts_and_errors_drop_the_session);
    return UNITY_END();
}
