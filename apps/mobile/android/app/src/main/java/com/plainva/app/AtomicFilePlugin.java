package com.plainva.app;

import android.os.Environment;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
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
 *
 * Large files never cross the bridge in one message (release list: the
 * phone froze after start, 17.11.): every call's text is parsed on the UI
 * thread before the plugin runs (`MessageHandler.onPostMessage`), and a
 * 3 MB picture was a 4 MB string there, four at once during a sync pull.
 * So a file is written in parts - `begin` makes the temp file, `append`
 * adds one part, `commit` fsyncs and renames it into place, `abort` drops
 * it - and read in parts (`read` with an offset). The contract stays the
 * one of `write`: the target holds the old bytes or all of the new ones,
 * never part of them. A temp file a killed process left is removed by
 * `sweep` at the next start.
 */
@CapacitorPlugin(name = "AtomicFile")
public class AtomicFilePlugin extends Plugin {

    /** A write in parts: its temp file, its target and the open stream. */
    private static final class Open {
        final File temp;
        final File target;
        final FileOutputStream out;
        Open(File temp, File target, FileOutputStream out) {
            this.temp = temp;
            this.target = target;
            this.out = out;
        }
    }

    private final Map<String, Open> open = new ConcurrentHashMap<>();
    /** A temp file older than this is no write of this process: removed by `sweep`. */
    private static final long ORPHAN_AGE_MS = 10L * 60L * 1000L;
    /** The most a single `read` hands back, in bytes (before base64). */
    private static final int MAX_READ = 256 * 1024;

    /** The file below the app's files dir that `rel` names; null when it would leave it. */
    private File inSandbox(String rel) throws java.io.IOException {
        File root = getContext().getFilesDir().getCanonicalFile();
        File file = new File(root, rel).getCanonicalFile();
        return file.getPath().startsWith(root.getPath() + File.separator) ? file : null;
    }

    private static void moveIntoPlace(File temp, File target) throws Exception {
        try {
            Files.move(temp.toPath(), target.toPath(),
                StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception atomicErr) {
            try {
                Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
            } catch (Exception second) {
                //noinspection ResultOfMethodCallIgnored
                temp.delete();
                throw second;
            }
        }
    }

    @PluginMethod
    public void begin(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null) {
            call.reject("path required");
            return;
        }
        try {
            File target = inSandbox(rel);
            if (target == null) {
                call.reject("path escapes the sandbox");
                return;
            }
            File parent = target.getParentFile();
            if (parent == null || (!parent.exists() && !parent.mkdirs() && !parent.exists())) {
                call.reject("mkdir failed");
                return;
            }
            File temp = File.createTempFile(".plainva-tmp-", null, parent);
            FileOutputStream out = new FileOutputStream(temp);
            String id = UUID.randomUUID().toString();
            open.put(id, new Open(temp, target, out));
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("atomic write failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        Open write = id == null ? null : open.get(id);
        if (write == null || data == null) {
            call.reject("no such write");
            return;
        }
        try {
            write.out.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve(new JSObject());
        } catch (Exception e) {
            dropWrite(id);
            call.reject("atomic write failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void commit(PluginCall call) {
        String id = call.getString("id");
        Open write = id == null ? null : open.remove(id);
        if (write == null) {
            call.reject("no such write");
            return;
        }
        try {
            write.out.flush();
            write.out.getFD().sync();
            write.out.close();
            moveIntoPlace(write.temp, write.target);
            call.resolve(new JSObject());
        } catch (Exception e) {
            try { write.out.close(); } catch (Exception ignored) { /* already failing */ }
            //noinspection ResultOfMethodCallIgnored
            write.temp.delete();
            call.reject("atomic write failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String id = call.getString("id");
        if (id != null) dropWrite(id);
        call.resolve(new JSObject());
    }

    private void dropWrite(String id) {
        Open write = open.remove(id);
        if (write == null) return;
        try { write.out.close(); } catch (Exception ignored) { /* the temp goes either way */ }
        //noinspection ResultOfMethodCallIgnored
        write.temp.delete();
    }

    /** A read in parts: one open file, so every part comes from the same version of it. */
    private static final class OpenRead {
        final RandomAccessFile file;
        final long size;
        volatile long lastUsed = System.currentTimeMillis();
        OpenRead(RandomAccessFile file, long size) {
            this.file = file;
            this.size = size;
        }
    }

    private final Map<String, OpenRead> reads = new ConcurrentHashMap<>();
    /** A read nobody closed (its page went away) is closed after this long without a part. */
    private static final long READ_IDLE_MS = 2L * 60L * 1000L;

    private void closeIdleReads() {
        long cutoff = System.currentTimeMillis() - READ_IDLE_MS;
        for (Map.Entry<String, OpenRead> entry : reads.entrySet()) {
            if (entry.getValue().lastUsed < cutoff && reads.remove(entry.getKey()) != null) {
                try { entry.getValue().file.close(); } catch (Exception ignored) { /* closing is all that is left to do */ }
            }
        }
    }

    /**
     * Opens a file for a read in parts and answers its size. Every part
     * (`readPart`) comes through this one open file: a file that is replaced
     * by a rename meanwhile - a sync pull, a save, the Files app - is read as
     * the version that was opened, never the front of one and the end of
     * another (release list F51, second review).
     */
    @PluginMethod
    public void openRead(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null) {
            call.reject("path required");
            return;
        }
        closeIdleReads();
        try {
            File source = inSandbox(rel);
            if (source == null) {
                call.reject("path escapes the sandbox");
                return;
            }
            if (!source.isFile()) {
                call.reject("File does not exist", "OS-PLUG-FILE-0008");
                return;
            }
            RandomAccessFile file = new RandomAccessFile(source, "r");
            String id = UUID.randomUUID().toString();
            reads.put(id, new OpenRead(file, file.length()));
            JSObject ret = new JSObject();
            ret.put("id", id);
            ret.put("size", reads.get(id).size);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage(), e);
        }
    }

    /** At most `length` bytes (and never more than 256 KB) from `offset` of an open read, as base64. */
    @PluginMethod
    public void readPart(PluginCall call) {
        String id = call.getString("id");
        OpenRead read = id == null ? null : reads.get(id);
        Long offset = JsNumbers.whole(call, "offset");
        Long length = JsNumbers.whole(call, "length");
        if (read == null || offset == null || length == null || offset < 0 || length < 0) {
            call.reject("no such read, or no offset and length");
            return;
        }
        try {
            read.lastUsed = System.currentTimeMillis();
            int want = (int) Math.max(0, Math.min(Math.min(length, MAX_READ), read.size - offset));
            byte[] bytes = new byte[want];
            synchronized (read) {
                read.file.seek(offset);
                read.file.readFully(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            // The length behind the handle now: a file written in place (not renamed) can have grown
            // or shrunk since it was opened, and the reader starts again rather than return part of it.
            ret.put("size", read.file.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void closeRead(PluginCall call) {
        String id = call.getString("id");
        OpenRead read = id == null ? null : reads.remove(id);
        if (read != null) {
            try { read.file.close(); } catch (Exception ignored) { /* closing is all that is left to do */ }
        }
        call.resolve(new JSObject());
    }

    /**
     * Removes the temp files a killed process left below `path` (older than ten
     * minutes, and none of a write still open in this process). On a thread of
     * its own: a walk over a large vault must not hold up the plugin thread every
     * other plugin call waits on.
     */
    @PluginMethod
    public void sweep(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null) {
            call.reject("path required");
            return;
        }
        final File folder;
        try {
            folder = inSandbox(rel);
        } catch (Exception e) {
            call.reject("sweep failed: " + e.getMessage(), e);
            return;
        }
        if (folder == null) {
            call.reject("path escapes the sandbox");
            return;
        }
        final java.util.Set<String> inUse = new java.util.HashSet<>();
        for (Open write : open.values()) inUse.add(write.temp.getAbsolutePath());
        new Thread(() -> {
            try {
                JSObject ret = new JSObject();
                ret.put("removed", sweepBelow(folder, System.currentTimeMillis() - ORPHAN_AGE_MS, inUse));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("sweep failed: " + e.getMessage(), e);
            }
        }, "plainva-sweep").start();
    }

    private static int sweepBelow(File folder, long olderThan, java.util.Set<String> inUse) {
        File[] entries = folder.listFiles();
        if (entries == null) return 0;
        int removed = 0;
        for (File entry : entries) {
            if (entry.isDirectory()) {
                removed += sweepBelow(entry, olderThan, inUse);
            } else if (entry.getName().startsWith(".plainva-tmp-") && entry.lastModified() < olderThan
                    && !inUse.contains(entry.getAbsolutePath()) && entry.delete()) {
                removed += 1;
            }
        }
        return removed;
    }

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
            // "DOCUMENTS": the public Documents folder, where the vault archive lies - resolved as
            // the Filesystem plugin resolves Directory.Documents. Otherwise the app's files dir.
            String directory = call.getString("directory", "DATA");
            File base;
            if ("DOCUMENTS".equals(directory)) base = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
            else if ("DATA".equals(directory)) base = getContext().getFilesDir();
            else if ("CACHE".equals(directory)) base = getContext().getCacheDir();
            else {
                call.reject("unknown directory " + directory);
                return;
            }
            File root = base.getCanonicalFile();
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
