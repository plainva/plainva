package com.plainva.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;

/**
 * Atomic file writes for the vault sandbox (hardening plan P2, mobile side).
 *
 * Filesystem.writeFile truncates the destination in place — a process kill,
 * full storage or a crash mid-write can leave a torn or zero-byte note. This
 * plugin implements the shared adapter contract instead: write an exclusive
 * temp file in the target directory, flush + fsync it, then atomically
 * rename it over the destination (REPLACE_EXISTING; ATOMIC_MOVE where the
 * filesystem supports the combination).
 *
 * Paths are validated relative to the app's files dir (= Capacitor
 * Directory.Data): canonicalized and required to stay inside it — no `..`,
 * no absolute paths, no sandbox escape. Capacitor runs plugin methods off
 * the UI thread, so the fsync never blocks the interface.
 */
@CapacitorPlugin(name = "AtomicFile")
public class AtomicFilePlugin extends Plugin {

    @PluginMethod
    public void write(PluginCall call) {
        String rel = call.getString("path");
        String data = call.getString("data");
        String encoding = call.getString("encoding", "utf8");
        if (rel == null || data == null) {
            call.reject("path and data required");
            return;
        }
        try {
            File root = getContext().getFilesDir().getCanonicalFile();
            File target = new File(root, rel).getCanonicalFile();
            String rootPrefix = root.getPath() + File.separator;
            if (!target.getPath().startsWith(rootPrefix)) {
                call.reject("path escapes the sandbox");
                return;
            }
            File parent = target.getParentFile();
            if (parent == null) {
                call.reject("no parent directory");
                return;
            }
            if (!parent.exists() && !parent.mkdirs() && !parent.exists()) {
                call.reject("mkdir failed");
                return;
            }

            byte[] bytes = "base64".equals(encoding)
                ? Base64.decode(data, Base64.DEFAULT)
                : data.getBytes(StandardCharsets.UTF_8);

            // Dot-prefixed temp: the JS directory walker skips dot names, so a
            // temp surviving a hard kill never shows up in the tree or sync.
            File temp = File.createTempFile(".plainva-tmp-", null, parent);
            boolean written = false;
            try (FileOutputStream out = new FileOutputStream(temp)) {
                out.write(bytes);
                out.flush();
                out.getFD().sync();
                written = true;
            } finally {
                if (!written) {
                    //noinspection ResultOfMethodCallIgnored
                    temp.delete();
                }
            }

            try {
                Files.move(temp.toPath(), target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (Exception atomicErr) {
                // Some filesystems reject the ATOMIC_MOVE+REPLACE combination —
                // fall back to a plain replacing move (still a rename, not a copy).
                try {
                    Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
                } catch (Exception second) {
                    //noinspection ResultOfMethodCallIgnored
                    temp.delete();
                    throw second;
                }
            }
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject("atomic write failed: " + e.getMessage(), e);
        }
    }

    /**
     * Content hash of a vault file, computed while streaming it (issue #48).
     *
     * The sync needs the hash of every pushed file. Reading a 90 MB attachment
     * into the WebView just to hash it is exactly the memory peak the streamed
     * upload exists to avoid — so the hash is taken here, in one pass, and the
     * bytes never leave the native side.
     */
    @PluginMethod
    public void sha256(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null) {
            call.reject("path required");
            return;
        }
        try {
            File root = getContext().getFilesDir().getCanonicalFile();
            File source = new File(root, rel).getCanonicalFile();
            if (!source.getPath().startsWith(root.getPath() + File.separator)) {
                call.reject("path escapes the sandbox");
                return;
            }
            if (!source.isFile()) {
                call.reject("file not found: " + rel);
                return;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long size = 0;
            try (FileInputStream in = new FileInputStream(source)) {
                byte[] buffer = new byte[256 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    digest.update(buffer, 0, read);
                    size += read;
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) hex.append(String.format("%02x", b));
            JSObject ret = new JSObject();
            ret.put("sha256", hex.toString());
            ret.put("size", size);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("hash failed: " + e.getMessage(), e);
        }
    }
}
