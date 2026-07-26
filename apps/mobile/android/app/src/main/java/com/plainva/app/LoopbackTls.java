package com.plainva.app;

import java.security.SecureRandom;
import java.security.cert.X509Certificate;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * A TLS factory that accepts a self-signed certificate — usable for LOOPBACK
 * addresses ONLY (mail feinplan G2, mirroring the desktop's Proton Bridge
 * exception).
 *
 * The Proton Mail Bridge terminates TLS on 127.0.0.1 with a certificate no
 * public root signs. A loopback socket never leaves the device, so there is no
 * network position from which to intercept it. Every other host keeps the
 * platform default trust store and hostname verification — the caller in
 * {@link MailNetPlugin} is what enforces that, and it is the only caller.
 */
final class LoopbackTls {

    private LoopbackTls() {}

    private static volatile SSLSocketFactory cached;

    static SSLSocketFactory factory() {
        SSLSocketFactory local = cached;
        if (local != null) return local;
        synchronized (LoopbackTls.class) {
            if (cached == null) {
                try {
                    SSLContext ctx = SSLContext.getInstance("TLS");
                    ctx.init(null, new TrustManager[] { ACCEPT_LOOPBACK }, new SecureRandom());
                    cached = ctx.getSocketFactory();
                } catch (Exception e) {
                    throw new IllegalStateException("could not set up the loopback TLS context", e);
                }
            }
            return cached;
        }
    }

    private static final X509TrustManager ACCEPT_LOOPBACK = new X509TrustManager() {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) {
            // Never used: this factory is client-side only.
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) {
            // Intentionally accepts anything — see the class comment. Reached
            // only for 127.0.0.1 / ::1 / localhost.
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    };
}
