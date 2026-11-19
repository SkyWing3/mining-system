// Colas durables de mensajes y voz (equivalente a la parte de cola de test_messages.py y test_audio.py).
#include <unity.h>

#include <ArduinoJson.h>

#include "../fakes.h"
#include "mining/outbox.h"
#include "mining/voice_queue.h"

using namespace mining;

void setUp() {}
void tearDown() {}

static const Stamp kSynced{1763320000000, 3, 5000};

void test_outbox_survives_restart_and_only_removes_acknowledged_entry() {
    MemoryStore store;
    Counter random;
    std::string first, second, error;
    {
        Outbox outbox(store, "/out", random.fn());
        TEST_ASSERT_TRUE(outbox.load(error));
        TEST_ASSERT_TRUE(outbox.enqueueMessage("HELP", std::nullopt, kSynced, first, error));
        TEST_ASSERT_TRUE(outbox.enqueueMessage("OK", std::nullopt, kSynced, second, error));
        TEST_ASSERT_EQUAL(2u, outbox.pendingMessages());
    }
    Outbox reloaded(store, "/out", random.fn());
    TEST_ASSERT_TRUE(reloaded.load(error));
    TEST_ASSERT_EQUAL(2u, reloaded.pending());
    std::optional<OutboxEntry> entry = reloaded.first(false);
    TEST_ASSERT_TRUE(entry.has_value());
    TEST_ASSERT_EQUAL_STRING(first.c_str(), entry->id.c_str());
    JsonDocument frame;
    deserializeJson(frame, entry->frame);
    TEST_ASSERT_EQUAL_STRING("message", frame["type"]);
    TEST_ASSERT_EQUAL_STRING(first.c_str(), frame["clientMessageId"]);
    TEST_ASSERT_EQUAL_STRING("2025-11-16T19:06:40.000Z", frame["sentAt"]);
    reloaded.acknowledge(second);
    TEST_ASSERT_EQUAL(1u, reloaded.pending());
    TEST_ASSERT_EQUAL_STRING(first.c_str(), reloaded.first(false)->id.c_str());
    // New entries continue the sequence after a restart, so the order is kept.
    std::string third;
    TEST_ASSERT_TRUE(reloaded.enqueueMessage("EXIT", std::nullopt, kSynced, third, error));
    reloaded.acknowledge(first);
    TEST_ASSERT_EQUAL_STRING(third.c_str(), reloaded.first(false)->id.c_str());
}

void test_catalog_and_detail_rules() {
    MemoryStore store;
    Counter random;
    Outbox outbox(store, "/out", random.fn());
    std::string id, error;
    outbox.load(error);
    TEST_ASSERT_FALSE(outbox.enqueueMessage("PIZZA", std::nullopt, kSynced, id, error));
    TEST_ASSERT_FALSE(outbox.enqueueMessage("HELP", std::string("detalle"), kSynced, id, error));
    TEST_ASSERT_FALSE(outbox.enqueueMessage("CO_ALARM", std::string(""), kSynced, id, error));
    TEST_ASSERT_FALSE(outbox.enqueueMessage("CO_ALARM", std::string(121, 'x'), kSynced, id, error));
    TEST_ASSERT_TRUE(outbox.enqueueMessage("CO_ALARM", std::string("CO 245 ppm"), kSynced, id, error));
    TEST_ASSERT_FALSE(outbox.enqueueNoticeAck(4, "seen", error));
    TEST_ASSERT_EQUAL(1u, outbox.pending());
}

void test_notice_confirmations_can_skip_blocked_messages() {
    MemoryStore store;
    Counter random;
    Outbox outbox(store, "/out", random.fn());
    std::string id, error;
    outbox.load(error);
    outbox.enqueueMessage("HELP", std::nullopt, kSynced, id, error);
    TEST_ASSERT_TRUE(outbox.enqueueNoticeAck(9, "read", error));
    TEST_ASSERT_EQUAL_STRING("message", outbox.first(false)->type.c_str());
    TEST_ASSERT_EQUAL_STRING("notice-ack", outbox.first(true)->type.c_str());
    TEST_ASSERT_TRUE(outbox.hasNoticeAck(9, "read"));
    TEST_ASSERT_FALSE(outbox.hasNoticeAck(9, "delivered"));
    TEST_ASSERT_EQUAL(1u, outbox.pendingMessages());
}

void test_rejected_entries_are_logged_and_removed() {
    MemoryStore store;
    Counter random;
    Outbox outbox(store, "/out", random.fn());
    std::string id, error;
    outbox.load(error);
    outbox.enqueueMessage("HELP", std::nullopt, kSynced, id, error);
    outbox.reject(id, "Mensaje fuera del catálogo.");
    TEST_ASSERT_EQUAL(0u, outbox.pending());
    TEST_ASSERT_TRUE(store.files["/rejected.log"].find("Mensaje fuera del catálogo.") != std::string::npos);
    TEST_ASSERT_TRUE(store.list("/out").empty());
}

void test_failed_storage_and_capacity_never_leave_partial_entries() {
    MemoryStore store;
    Counter random;
    Outbox outbox(store, "/out", random.fn(), "/rejected.log", 2);
    std::string id, error;
    outbox.load(error);
    store.failWrites = true;
    TEST_ASSERT_FALSE(outbox.enqueueMessage("HELP", std::nullopt, kSynced, id, error));
    TEST_ASSERT_EQUAL_STRING("Error al guardar", error.c_str());
    TEST_ASSERT_EQUAL(0u, outbox.pending());
    store.failWrites = false;
    TEST_ASSERT_TRUE(outbox.enqueueMessage("HELP", std::nullopt, kSynced, id, error));
    TEST_ASSERT_TRUE(outbox.enqueueMessage("OK", std::nullopt, kSynced, id, error));
    TEST_ASSERT_FALSE(outbox.enqueueMessage("EXIT", std::nullopt, kSynced, id, error));
    TEST_ASSERT_EQUAL_STRING("Cola llena", error.c_str());
}

void test_corrupt_and_temporary_files_are_cleaned_on_load() {
    MemoryStore store;
    store.files["/out/0000000004-" + std::string(32, 'a') + ".json"] = "{not json";
    store.files["/out/.0000000005.tmp"] = "partial";
    store.files["/out/readme.txt"] = "ignored";
    Counter random;
    Outbox outbox(store, "/out", random.fn());
    std::string id, error;
    TEST_ASSERT_TRUE(outbox.load(error));
    TEST_ASSERT_EQUAL(0u, outbox.pending());
    TEST_ASSERT_EQUAL(1u, store.list("/out").size());
    TEST_ASSERT_TRUE(outbox.enqueueMessage("HELP", std::nullopt, kSynced, id, error));
    // The sequence continues after the highest name seen.
    TEST_ASSERT_TRUE(store.exists("/out/0000000005-" + id + ".json"));
}

void test_unsynchronized_messages_are_dated_when_sent() {
    MemoryStore store;
    Counter random;
    FakeClock uptime;
    WallClock clock(7, uptime.fn());
    Outbox outbox(store, "/out", random.fn());
    std::string id, error, frame;
    outbox.load(error);
    uptime.now = 10000;
    TEST_ASSERT_FALSE(clock.stamp().absolute());
    TEST_ASSERT_TRUE(outbox.enqueueMessage("HELP", std::nullopt, clock.stamp(), id, error));
    // Without the central's time the frame cannot be prepared yet.
    TEST_ASSERT_FALSE(prepareFrame(outbox.first(false)->frame, clock, frame));
    uptime.now = 70000;
    clock.sync(1763320000000);
    TEST_ASSERT_TRUE(prepareFrame(outbox.first(false)->frame, clock, frame));
    JsonDocument document;
    deserializeJson(document, frame);
    // Queued one minute before the synchronization.
    TEST_ASSERT_EQUAL_STRING("2025-11-16T19:05:40.000Z", document["sentAt"]);
    TEST_ASSERT_TRUE(document["_boot"].isNull());
    // An entry from another boot that never synchronized is dated now.
    store.files["/out/0000000009-" + std::string(32, 'b') + ".json"] =
        "{\"type\":\"message\",\"clientMessageId\":\"" + std::string(32, 'b') + "\",\"code\":\"OK\",\"_boot\":6,\"_uptimeMs\":5}";
    std::string stored;
    store.read("/out/0000000009-" + std::string(32, 'b') + ".json", stored);
    TEST_ASSERT_TRUE(prepareFrame(stored, clock, frame));
    deserializeJson(document, frame);
    TEST_ASSERT_EQUAL_STRING("2025-11-16T19:06:40.000Z", document["sentAt"]);
}

void test_voice_queue_limit_restart_and_cleanup() {
    MemoryStore store;
    Counter random;
    std::string error, id;
    store.files["/rec.wav"] = "RIFF....";
    VoiceQueue voices(store, "/voice", 2, random.fn());
    TEST_ASSERT_TRUE(voices.load(error));
    TEST_ASSERT_EQUAL(VoiceQueue::Result::Ok, voices.enqueue("/rec.wav", 4200, 900, kSynced, id));
    TEST_ASSERT_FALSE(store.exists("/rec.wav"));
    TEST_ASSERT_EQUAL(1, voices.pending());
    store.files["/rec.wav"] = "RIFF....";
    std::string second;
    TEST_ASSERT_EQUAL(VoiceQueue::Result::Ok, voices.enqueue("/rec.wav", 1000, 50, Stamp{-1, 3, 800}, second));
    store.files["/rec.wav"] = "RIFF....";
    std::string third;
    TEST_ASSERT_EQUAL(VoiceQueue::Result::Full, voices.enqueue("/rec.wav", 1000, 50, kSynced, third));
    TEST_ASSERT_TRUE(store.exists("/rec.wav"));

    // An interrupted enqueue (audio without metadata) and stray files are removed on load.
    store.files["/voice/0000000007-" + std::string(32, 'c') + ".wav"] = "orphan";
    VoiceQueue reloaded(store, "/voice", 2, random.fn());
    TEST_ASSERT_TRUE(reloaded.load(error));
    TEST_ASSERT_EQUAL(2, reloaded.pending());
    TEST_ASSERT_FALSE(store.exists("/voice/0000000007-" + std::string(32, 'c') + ".wav"));
    std::optional<QueuedVoice> voice = reloaded.first();
    TEST_ASSERT_EQUAL_STRING(id.c_str(), voice->id.c_str());
    TEST_ASSERT_EQUAL(4200, voice->durationMs);
    TEST_ASSERT_EQUAL(900, voice->peak);
    TEST_ASSERT_EQUAL_INT64(kSynced.epochMs, voice->stamp.epochMs);
    reloaded.remove(*voice);
    voice = reloaded.first();
    TEST_ASSERT_EQUAL_STRING(second.c_str(), voice->id.c_str());
    TEST_ASSERT_FALSE(voice->stamp.absolute());
    TEST_ASSERT_EQUAL(3u, voice->stamp.boot);
    reloaded.reject(*voice, "El audio debe ser PCM mono de 16 bits.");
    TEST_ASSERT_EQUAL(0, reloaded.pending());
    TEST_ASSERT_TRUE(store.files["/rejected.log"].find("PCM mono") != std::string::npos);
    TEST_ASSERT_TRUE(store.list("/voice").empty());
}

void test_voice_enqueue_failure_keeps_the_recording() {
    MemoryStore store;
    Counter random;
    std::string error, id;
    VoiceQueue voices(store, "/voice", 5, random.fn());
    voices.load(error);
    store.failWrites = true;
    store.files["/rec.wav"] = "RIFF";
    TEST_ASSERT_EQUAL(VoiceQueue::Result::Error, voices.enqueue("/rec.wav", 1000, 1, kSynced, id));
    TEST_ASSERT_TRUE(store.exists("/rec.wav"));
    TEST_ASSERT_EQUAL(0, voices.pending());
}

void test_queue_names() {
    uint32_t seq;
    std::string id;
    std::string name = queueName(42, std::string(32, 'f'), ".json");
    TEST_ASSERT_EQUAL_STRING(("0000000042-" + std::string(32, 'f') + ".json").c_str(), name.c_str());
    TEST_ASSERT_TRUE(parseQueueName(name, ".json", seq, id));
    TEST_ASSERT_EQUAL(42u, seq);
    TEST_ASSERT_FALSE(parseQueueName(name, ".wav", seq, id));
    TEST_ASSERT_FALSE(parseQueueName("0000000042-" + std::string(32, 'G') + ".json", ".json", seq, id));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_outbox_survives_restart_and_only_removes_acknowledged_entry);
    RUN_TEST(test_catalog_and_detail_rules);
    RUN_TEST(test_notice_confirmations_can_skip_blocked_messages);
    RUN_TEST(test_rejected_entries_are_logged_and_removed);
    RUN_TEST(test_failed_storage_and_capacity_never_leave_partial_entries);
    RUN_TEST(test_corrupt_and_temporary_files_are_cleaned_on_load);
    RUN_TEST(test_unsynchronized_messages_are_dated_when_sent);
    RUN_TEST(test_voice_queue_limit_restart_and_cleanup);
    RUN_TEST(test_voice_enqueue_failure_keeps_the_recording);
    RUN_TEST(test_queue_names);
    return UNITY_END();
}
