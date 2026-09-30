package com.plainva.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Raw bodies reach a transcription endpoint and nothing else (plan KI-Harness P1.5). */
public class AiNetRulesTest {

    @Test
    public void aRecordingGoesToTheTranscriptionEndpoint() {
        assertTrue(AiNetRules.rawBodyAllowed("/v1/audio/transcriptions", "multipart/form-data; boundary=----plainva123"));
    }

    @Test
    public void rawBytesGoNowhereElse() {
        assertFalse(AiNetRules.rawBodyAllowed("/v1/chat/completions", "multipart/form-data; boundary=x"));
        assertFalse(AiNetRules.rawBodyAllowed("/v1/responses", "multipart/form-data; boundary=x"));
        assertFalse(AiNetRules.rawBodyAllowed("/v1/audio/transcriptions", "application/json"));
        assertFalse(AiNetRules.rawBodyAllowed("/v1/audio/transcriptions", "multipart/form-data; boundary=x\r\nx-api-key: stolen"));
        assertFalse(AiNetRules.rawBodyAllowed(null, "multipart/form-data; boundary=x"));
    }
}
