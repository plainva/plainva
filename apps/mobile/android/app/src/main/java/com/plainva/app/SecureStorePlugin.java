package com.plainva.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keystore-backed secret storage (M3 hardening). Values are AES/GCM
 * encrypted with a non-exportable key in the AndroidKeyStore and stored as
 * base64(iv || ciphertext) in a private SharedPreferences file — plaintext
 * secrets never touch disk (unlike @capacitor/preferences).
 *
 * The box itself is {@link KeystoreBox}; this plugin keeps its own alias and
 * file, so AI provider keys (the {@link AiNetPlugin} box) are out of its reach.
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    private static final Object STORE_LOCK = new Object();
    private static final String KEY_ALIAS = "plainva_secrets";
    private static final String PREFS = "plainva_secure";

    private KeystoreBox box;

    private KeystoreBox box() {
        if (box == null) box = new KeystoreBox(getContext(), KEY_ALIAS, PREFS);
        return box;
    }

    @PluginMethod
    public void get(PluginCall call) {
        String k = call.getString("key");
        if (k == null) { call.reject("key required"); return; }
        synchronized (STORE_LOCK) {
            try {
                String value = box().read(k);
                JSObject ret = new JSObject();
                ret.put("value", value == null ? JSObject.NULL : value);
                call.resolve(ret);
            } catch (Exception e) { call.reject("secure store read failed"); }
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String k = call.getString("key"), value = call.getString("value");
        if (k == null || value == null) { call.reject("key and value required"); return; }
        synchronized (STORE_LOCK) {
            try { box().write(k, value); call.resolve(); }
            catch (Exception e) { call.reject("secure store write failed"); }
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String k = call.getString("key");
        if (k == null) { call.reject("key required"); return; }
        synchronized (STORE_LOCK) {
            try { box().write(k, null); call.resolve(); }
            catch (Exception e) { call.reject("secure store remove failed"); }
        }
    }

    /** Compare and persist inside the same native lane as ordinary writers. */
    @PluginMethod
    public void compareAndSet(PluginCall call) {
        String k = call.getString("key");
        if (k == null || !call.getData().has("expected") || !call.getData().has("value")) {
            call.reject("key, expected and value required"); return;
        }
        synchronized (STORE_LOCK) {
            try {
                boolean changed = java.util.Objects.equals(box().read(k), call.getString("expected"));
                if (changed) box().write(k, call.getString("value"));
                JSObject result = new JSObject();
                result.put("changed", changed);
                call.resolve(result);
            } catch (Exception e) { call.reject("secure store conditional write failed"); }
        }
    }
}
