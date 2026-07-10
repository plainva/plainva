package com.plainva.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

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
}
