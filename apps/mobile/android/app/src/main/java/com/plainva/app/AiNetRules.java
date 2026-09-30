package com.plainva.app;

import java.util.Locale;

/**
 * The AI egress's rules that are plain functions (plan KI-Harness P1.5), kept
 * apart from the plugin so a JUnit test holds them without a device.
 */
final class AiNetRules {
    private AiNetRules() {}

    /**
     * A body of raw bytes — a recording to transcribe — is accepted only as
     * multipart form data and only for a transcription endpoint: a raw JSON
     * body anywhere else would slip past the rule that keeps OpenAI from
     * storing requests.
     */
    static boolean rawBodyAllowed(String path, String contentType) {
        if (path == null || contentType == null) return false;
        if (contentType.contains("\r") || contentType.contains("\n")) return false;
        return contentType.toLowerCase(Locale.ROOT).startsWith("multipart/form-data; boundary=")
                && path.endsWith("/audio/transcriptions");
    }
}
