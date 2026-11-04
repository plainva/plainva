package com.plainva.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** The system model's rules on Android (plan KI-Harness P2c). */
public class PlatformModelRulesTest {

    @Test
    public void failuresMeanWhatTheCoreShowsTheReader() {
        assertEquals("context_too_long", PlatformModelRules.failure(12, "too large").code);
        assertEquals("rate_limited", PlatformModelRules.failure(27, "quota").code);
        assertEquals("rate_limited", PlatformModelRules.failure(9, "busy").code);
        PlatformModelRules.Failure background = PlatformModelRules.failure(30, "blocked");
        assertEquals("platform_unavailable", background.code);
        assertEquals("background", background.message);
        assertEquals("osTooOld", PlatformModelRules.failure(604, "update").message);
        assertEquals("notSupported", PlatformModelRules.failure(-101, "aicore").message);
        PlatformModelRules.Failure other = PlatformModelRules.failure(15, "the model failed");
        assertEquals("platform_error", other.code);
        assertEquals("the model failed", other.message);
        assertTrue(PlatformModelRules.cancelled(7));
        assertFalse(PlatformModelRules.cancelled(8));
    }

    @Test
    public void aStatusOtherThanAvailableNamesWhatCanBeDone() {
        assertEquals("downloading", PlatformModelRules.reason(true, true));
        assertEquals("downloadable", PlatformModelRules.reason(true, false));
        assertEquals("notSupported", PlatformModelRules.reason(false, false));
    }

    @Test
    public void answersAreFramedAsTheCoreReadsThem() throws Exception {
        String text = PlatformModelRules.event("text", "Hello \"world\"\n");
        assertTrue(text.startsWith("data: ") && text.endsWith("\n\n"));
        assertEquals("Hello \"world\"\n", new JSONObject(text.substring(6).trim()).getString("text"));
        assertEquals("data: {\"stop\":\"end\"}\n\n", PlatformModelRules.event("stop", "end"));
    }

    @Test
    public void theConnectionTestReportsTheModelAndItsWindow() throws Exception {
        JSONObject list = new JSONObject(PlatformModelRules.modelList("Gemini Nano", 0));
        JSONObject model = list.getJSONArray("data").getJSONObject(0);
        assertEquals("on-device", model.getString("id"));
        assertEquals(4000, model.getInt("context_length"));
        assertEquals(1024, new JSONObject(PlatformModelRules.modelList("x", 1024)).getJSONArray("data").getJSONObject(0).getInt("context_length"));
    }

    @Test
    public void theInstructionsGoInFrontAndTheAnswerStaysInBounds() {
        assertEquals("Be brief.\n\nWhat is due?", PlatformModelRules.prompt("Be brief.", "What is due?"));
        assertEquals("What is due?", PlatformModelRules.prompt("", "What is due?"));
        assertEquals(700, PlatformModelRules.answerTokens(null));
        assertEquals(64, PlatformModelRules.answerTokens(1));
        assertEquals(4000, PlatformModelRules.answerTokens(32000));
    }
}
