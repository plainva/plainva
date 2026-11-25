package com.plainva.app;

import static org.junit.Assert.assertEquals;
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

    @Test
    public void onlyThisDevicesOwnAddressIsThisDevice() {
        assertTrue(AiNetRules.onThisDevice("localhost"));
        assertTrue(AiNetRules.onThisDevice("127.0.0.1"));
        assertTrue(AiNetRules.onThisDevice("::1"));
        // A server in the home network is not this device, however near it stands.
        assertFalse(AiNetRules.onThisDevice("192.168.1.20"));
        assertFalse(AiNetRules.onThisDevice("nas.example"));
        assertFalse(AiNetRules.onThisDevice("api.anthropic.com"));
        assertFalse(AiNetRules.onThisDevice("localhost.example.org"));
        assertFalse(AiNetRules.onThisDevice(""));
        assertFalse(AiNetRules.onThisDevice(null));
    }

    @Test
    public void aModelOnThisDeviceMayBeSilentLonger() {
        assertEquals(AiNetRules.LOCAL_SILENCE_SECONDS, AiNetRules.silenceSeconds("localhost"));
        assertEquals(AiNetRules.LOCAL_SILENCE_SECONDS, AiNetRules.silenceSeconds("127.0.0.1"));
        assertEquals(AiNetRules.SILENCE_SECONDS, AiNetRules.silenceSeconds("api.example.org"));
        assertEquals(AiNetRules.SILENCE_SECONDS, AiNetRules.silenceSeconds("192.168.1.20"));
        assertEquals(AiNetRules.SILENCE_SECONDS, AiNetRules.silenceSeconds(null));
        assertTrue(AiNetRules.LOCAL_SILENCE_SECONDS > AiNetRules.SILENCE_SECONDS);
    }

    @Test
    public void fullyLocalIsOffUntilTold() {
        assertFalse(AiLocalOnly.on());
        AiLocalOnly.set(true);
        assertTrue(AiLocalOnly.on());
        AiLocalOnly.set(false);
        assertFalse(AiLocalOnly.on());
    }

    /** B7: only a connection that provably never stood, before any byte of the request, is "unreachable". */
    @Test
    public void aConnectionThatNeverStoodIsUnreachable() {
        assertEquals("unreachable", AiNetRules.failureCode(new java.net.UnknownHostException("api.example.com"), false));
        assertEquals("unreachable", AiNetRules.failureCode(new java.net.ConnectException("Failed to connect"), false));
        assertEquals("unreachable", AiNetRules.failureCode(new java.io.IOException("wrapped", new java.net.NoRouteToHostException("no route")), false));
    }

    @Test
    public void whatWasWrittenMayHaveArrived() {
        assertEquals("HTTP_NETWORK_ERROR", AiNetRules.failureCode(new java.net.ConnectException("Failed to connect"), true));
        assertEquals("HTTP_TIMEOUT", AiNetRules.failureCode(new java.net.SocketTimeoutException("timeout"), false));
        assertEquals("HTTP_NETWORK_ERROR", AiNetRules.failureCode(new java.io.IOException("unexpected end of stream"), false));
    }

    @Test
    public void aCertificateIsNamedNotUnreachable() {
        assertEquals("TLS_HANDSHAKE_FAILED", AiNetRules.failureCode(new javax.net.ssl.SSLHandshakeException("handshake"), false));
    }
}
