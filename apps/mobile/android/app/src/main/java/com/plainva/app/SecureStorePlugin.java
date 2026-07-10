package com.plainva.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keystore-backed secret storage (M3 hardening). Values are AES/GCM
 * encrypted with a non-exportable key in the AndroidKeyStore and stored as
 * base64(iv || ciphertext) in a private SharedPreferences file — plaintext
 * secrets never touch disk (unlike @capacitor/preferences).
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    private static final String KEY_ALIAS = "plainva_secrets";
    private static final String PREFS = "plainva_secure";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_LENGTH = 12;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    @PluginMethod
    public void get(PluginCall call) {
        String k = call.getString("key");
        if (k == null) { call.reject("key required"); return; }
        String stored = prefs().getString(k, null);
        JSObject ret = new JSObject();
        if (stored == null) {
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
            return;
        }
        try {
            byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
            byte[] iv = new byte[IV_LENGTH];
            byte[] ct = new byte[blob.length - IV_LENGTH];
            System.arraycopy(blob, 0, iv, 0, IV_LENGTH);
            System.arraycopy(blob, IV_LENGTH, ct, 0, ct.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            ret.put("value", new String(cipher.doFinal(ct), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("decrypt failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String k = call.getString("key");
        String value = call.getString("value");
        if (k == null || value == null) { call.reject("key and value required"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] blob = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, blob, 0, iv.length);
            System.arraycopy(ct, 0, blob, iv.length, ct.length);
            prefs().edit().putString(k, Base64.encodeToString(blob, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("encrypt failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String k = call.getString("key");
        if (k == null) { call.reject("key required"); return; }
        prefs().edit().remove(k).apply();
        call.resolve();
    }
}
