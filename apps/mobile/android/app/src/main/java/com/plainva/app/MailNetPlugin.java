package com.plainva.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Raw TCP/TLS sockets for the mail client (mail feinplan G2).
 *
 * Deliberately dumb: open, upgrade to TLS, write bytes, read bytes, close.
 * The IMAP and SMTP protocols live in shared TypeScript, so this file — and
 * its Swift twin — stay small enough to audit, and the two platforms cannot
 * drift apart on protocol behaviour.
 *
 * Certificates are validated by the platform default. There is exactly one
 * exception, mirroring the desktop: a LOOPBACK address may present a
 * self-signed certificate, because that is how the Proton Mail Bridge works
 * and a loopback socket cannot be intercepted.
 */
@CapacitorPlugin(name = "MailNet")
public class MailNetPlugin extends Plugin {

    private static final int MAX_READ = 1 << 16;

    private final Map<String, Conn> conns = new ConcurrentHashMap<>();
    private final AtomicLong ids = new AtomicLong(1);

    private static final class Conn {
        Socket socket;
        InputStream in;
        OutputStream out;
        final String host;
        final int port;

        Conn(Socket socket, String host, int port) throws IOException {
            this.socket = socket;
            this.host = host;
            this.port = port;
            this.in = socket.getInputStream();
            this.out = socket.getOutputStream();
        }
    }

    private static boolean isLoopback(String host) {
        return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "::1".equals(host);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        boolean tls = Boolean.TRUE.equals(call.getBoolean("tls", false));
        if (host == null || port == null) {
            call.reject("host and port are required");
            return;
        }
        try {
            Socket raw = new Socket();
            raw.connect(new InetSocketAddress(host, port), 20000);
            raw.setSoTimeout(30000);
            Socket socket = raw;
            if (tls) socket = upgrade(raw, host, port);
            String id = "c" + ids.getAndIncrement();
            conns.put(id, new Conn(socket, host, port));
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("could not reach the mail server: " + e.getMessage());
        }
    }

    private Socket upgrade(Socket plain, String host, int port) throws IOException {
        SSLSocketFactory factory = isLoopback(host)
                ? LoopbackTls.factory()
                : (SSLSocketFactory) SSLSocketFactory.getDefault();
        SSLSocket tls = (SSLSocket) factory.createSocket(plain, host, port, true);
        tls.setUseClientMode(true);
        if (!isLoopback(host)) {
            // Hostname verification is NOT automatic on a wrapped socket.
            javax.net.ssl.SSLParameters params = tls.getSSLParameters();
            params.setEndpointIdentificationAlgorithm("HTTPS");
            tls.setSSLParameters(params);
        }
        tls.startHandshake();
        tls.setSoTimeout(30000);
        return tls;
    }

    @PluginMethod
    public void startTls(PluginCall call) {
        Conn c = conns.get(call.getString("id", ""));
        if (c == null) {
            call.reject("unknown connection");
            return;
        }
        try {
            Socket tls = upgrade(c.socket, c.host, c.port);
            c.socket = tls;
            c.in = tls.getInputStream();
            c.out = tls.getOutputStream();
            call.resolve();
        } catch (Exception e) {
            call.reject("TLS handshake failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        Conn c = conns.get(call.getString("id", ""));
        String data = call.getString("data");
        if (c == null || data == null) {
            call.reject("unknown connection");
            return;
        }
        try {
            c.out.write(Base64.decode(data, Base64.DEFAULT));
            c.out.flush();
            call.resolve();
        } catch (IOException e) {
            call.reject("could not send to the mail server: " + e.getMessage());
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        Conn c = conns.get(call.getString("id", ""));
        if (c == null) {
            call.reject("unknown connection");
            return;
        }
        Integer timeout = call.getInt("timeoutMs", 30000);
        try {
            c.socket.setSoTimeout(timeout == null ? 30000 : timeout);
            byte[] buf = new byte[MAX_READ];
            int n = c.in.read(buf);
            JSObject ret = new JSObject();
            // n < 0 means the peer closed — an empty payload says so upstream.
            ret.put("data", n <= 0 ? "" : Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (SocketTimeoutException e) {
            call.reject("the mail server did not answer in time");
        } catch (IOException e) {
            call.reject("lost the connection to the mail server: " + e.getMessage());
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        Conn c = conns.remove(call.getString("id", ""));
        if (c != null) {
            try {
                c.socket.close();
            } catch (IOException ignored) {
                // Closing a already-dead socket is not an error worth surfacing.
            }
        }
        call.resolve();
    }
}
