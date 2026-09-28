package com.plainva.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secrets encrypted with a non-exportable AndroidKeyStore key (AES/GCM) and
 * stored as base64(iv || ciphertext) in a private SharedPreferences file.
 *
 * One box per purpose: the SecureStore plugin keeps its box, the AI egress
 * ({@link AiNetPlugin}) has its own alias and file, so the generic plugin —
 * which the WebView can call with any key name — cannot read a provider key.
 */
final class KeystoreBox {

    private static final int GCM_TAG_BITS = 128;
    private static final int IV_LENGTH = 12;

    private final Context context;
    private final String alias;
    private final String prefsName;

    KeystoreBox(Context context, String alias, String prefsName) {
        this.context = context.getApplicationContext();
        this.alias = alias;
        this.prefsName = prefsName;
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(prefsName, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(alias, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    String read(String name) throws Exception {
        String stored = prefs().getString(name, null);
        if (stored == null) return null;
        byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
        if (blob.length <= IV_LENGTH) throw new IllegalStateException("invalid encrypted value");
        byte[] iv = new byte[IV_LENGTH];
        byte[] ct = new byte[blob.length - IV_LENGTH];
        System.arraycopy(blob, 0, iv, 0, IV_LENGTH);
        System.arraycopy(blob, IV_LENGTH, ct, 0, ct.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
    }

    void write(String name, String value) throws Exception {
        if (value == null) {
            if (!prefs().edit().remove(name).commit()) throw new IllegalStateException("secure store remove failed");
            return;
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] ct = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] blob = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, blob, 0, iv.length);
        System.arraycopy(ct, 0, blob, iv.length, ct.length);
        // commit reports a persisted result; apply would acknowledge early.
        if (!prefs().edit().putString(name, Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("secure store write failed");
        }
    }
}
