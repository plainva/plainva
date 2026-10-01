package com.plainva.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The rules of the system's own model on Android (plan KI-Harness P2c),
 * free of ML Kit so they can be tested on their own: what a failure means
 * for the core, how an answer is framed for the egress protocol, and what
 * the connection test reports.
 */
final class PlatformModelRules {
    private PlatformModelRules() {}

    /** The model's id in Plainva: one model per system. */
    static final String MODEL_ID = "on-device";
    /** The documented input limit when the system names none. */
    static final int FALLBACK_WINDOW = 4000;
    /** ML Kit's Prompt API needs Android 8. */
    static final int MIN_SDK = 26;

    // GenAiException.ErrorCode values (ML Kit GenAI, read 2026-10-01).
    static final int CANCELLED = 7;
    static final int NOT_AVAILABLE = 8;
    static final int BUSY = 9;
    static final int REQUEST_TOO_LARGE = 12;
    static final int NOT_SUPPORTED = 16;
    static final int PER_APP_BATTERY_USE_QUOTA_EXCEEDED = 27;
    static final int BACKGROUND_USE_BLOCKED = 30;
    static final int NOT_ENOUGH_DISK_SPACE = 501;
    static final int NEEDS_SYSTEM_UPDATE = 604;
    static final int AICORE_INCOMPATIBLE = -101;

    /** An egress failure: the code the core maps, and its message (for `platform_unavailable`: the reason). */
    static final class Failure {
        final String code;
        final String message;

        Failure(String code, String message) {
            this.code = code;
            this.message = message;
        }
    }

    /** What an ML Kit error code means for the reader. */
    static Failure failure(int errorCode, String message) {
        switch (errorCode) {
            case REQUEST_TOO_LARGE:
                return new Failure("context_too_long", "the request is larger than the model's window");
            case BUSY:
            case PER_APP_BATTERY_USE_QUOTA_EXCEEDED:
                return new Failure("rate_limited", "the system asks to wait");
            case BACKGROUND_USE_BLOCKED:
                return new Failure("platform_unavailable", "background");
            case NOT_AVAILABLE:
            case NOT_SUPPORTED:
            case AICORE_INCOMPATIBLE:
                return new Failure("platform_unavailable", "notSupported");
            case NEEDS_SYSTEM_UPDATE:
                return new Failure("platform_unavailable", "osTooOld");
            case NOT_ENOUGH_DISK_SPACE:
                return new Failure("platform_unavailable", "modelNotReady");
            default:
                return new Failure("platform_error", message == null ? "error " + errorCode : clip(message));
        }
    }

    /** Whether the error code means the request was cancelled. */
    static boolean cancelled(int errorCode) {
        return errorCode == CANCELLED;
    }

    /** A status that is not "available", named as the settings know it. */
    static String reason(boolean downloadable, boolean downloading) {
        if (downloading) return "downloading";
        if (downloadable) return "downloadable";
        return "notSupported";
    }

    /** One server-sent event of Plainva's small dialect. */
    static String event(String key, Object value) {
        try {
            JSONObject o = new JSONObject();
            o.put(key, value);
            return "data: " + o.toString() + "\n\n";
        } catch (JSONException e) {
            return "";
        }
    }

    /** The connection test's answer: the model and its window, in the list shape the core reads. */
    static String modelList(String name, int window) {
        try {
            JSONObject model = new JSONObject();
            model.put("id", MODEL_ID);
            model.put("name", name);
            model.put("context_length", window > 0 ? window : FALLBACK_WINDOW);
            return new JSONObject().put("data", new JSONArray().put(model)).toString();
        } catch (JSONException e) {
            return "{\"data\":[]}";
        }
    }

    /** The prompt with the instructions in front: not every device takes a system instruction. */
    static String prompt(String instructions, String prompt) {
        return instructions == null || instructions.isEmpty() ? prompt : instructions + "\n\n" + prompt;
    }

    /** The answer's length, inside what the core asked and what the model can give. */
    static int answerTokens(Integer asked) {
        int n = asked == null ? 700 : asked;
        return Math.max(64, Math.min(n, 4000));
    }

    static String clip(String text) {
        return text.length() > 300 ? text.substring(0, 300) : text;
    }
}
