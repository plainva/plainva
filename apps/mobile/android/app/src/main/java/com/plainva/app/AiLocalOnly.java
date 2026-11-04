package com.plainva.app;

/**
 * "Fully local" as the native side holds it (plan KI-Harness P7, ADR 0030).
 *
 * While the switch is on, nothing the assistant handles goes anywhere but
 * this device. The web view holds that promise first: its one egress answers
 * every request for anyone else itself. This flag is the same rule once
 * more, behind it — against a mistake in the web view's own code, not
 * against a web view that was taken over, which could switch it off the way
 * it is switched on.
 *
 * The web view tells it through {@code AiNet.setLocalOnly} when the settings
 * are read and whenever the switch changes; until then it is off, like the
 * switch itself. Every plugin that sends something for the assistant reads
 * it before it does.
 */
final class AiLocalOnly {
    private static volatile boolean on = false;

    private AiLocalOnly() {}

    static void set(boolean value) {
        on = value;
    }

    static boolean on() {
        return on;
    }
}
