package com.plainva.app;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.UnknownHostException;
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

    /**
     * A host on this device: the names plain http is accepted for. While the
     * device is fully local (ADR 0030) a request goes to such a host or
     * nowhere — a server in the home network is not this device, however
     * near it stands.
     */
    static boolean onThisDevice(String host) {
        if (host == null) return false;
        return host.equals("localhost") || host.equals("127.0.0.1") || host.equals("::1");
    }

    /** Seconds a recipient may be silent before its request counts as dead. */
    static final int SILENCE_SECONDS = 180;

    /**
     * A model on this device may read for minutes before it says a word: it
     * gets this long instead (ADR 0030).
     */
    static final int LOCAL_SILENCE_SECONDS = 900;

    static int silenceSeconds(String host) {
        return onThisDevice(host) ? LOCAL_SILENCE_SECONDS : SILENCE_SECONDS;
    }

    /**
     * What a failed request is called (plan Umsetzung 0.9.x, B7; F72). "unreachable" only where the connection
     * provably never stood — the name did not resolve, the connection was refused or found no route — and not a
     * byte of the request was written ({@code written}: the call began its headers). Otherwise the sync's own codes
     * say what it was: a certificate the device did not accept, the time running out, a network failure; those may
     * have arrived.
     */
    static String failureCode(Throwable error, boolean written) {
        if (!written) {
            Throwable cause = error;
            for (int depth = 0; cause != null && depth < 16; depth++, cause = cause.getCause()) {
                if (cause instanceof UnknownHostException || cause instanceof ConnectException || cause instanceof NoRouteToHostException) return "unreachable";
            }
        }
        return HttpFailure.code(error);
    }
}
