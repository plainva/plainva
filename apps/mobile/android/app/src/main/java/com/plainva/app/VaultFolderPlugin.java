package com.plainva.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A folder the user picked through the Storage Access Framework, addressed by
 * an opaque handle (external vault folder plan, P3 — the Android half).
 *
 * The handle IS the persisted tree URI as a string; the WebView never parses
 * it. Every file operation resolves a vault-relative path to a document id by
 * walking the tree one child query per segment — with a per-handle cache, so a
 * listing of a deep folder costs one query, not one per ancestor every time.
 * Writes go through the document's own output stream in "wt" mode: SAF has no
 * rename-over, so the atomic temp+rename of the sandbox writer is not
 * available here; what IS kept is that a write never leaves a half-created
 * document behind (create, then write, then close — a failure before the
 * close deletes the fresh document again).
 *
 * Two states are answered, not thrown: a grant that is gone (the user revoked
 * it, the folder moved or was deleted) resolves as `expired`, and a location
 * the platform refuses (Android 11's block list: Downloads, the storage root)
 * arrives from the picker as `notPickable`.
 */
@CapacitorPlugin(name = "VaultFolder")
public class VaultFolderPlugin extends Plugin {

    private static final String[] CHILD_PROJECTION = new String[] {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    };

    /** handle -> (relative path -> document id). Cleared on every mutation of that handle. */
    private final Map<String, Map<String, String>> docIdCache = new HashMap<>();

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
            JSObject out = new JSObject();
            out.put("picked", false);
            out.put("reason", "cancelled");
            call.resolve(out);
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException e) {
            JSObject out = new JSObject();
            out.put("picked", false);
            out.put("reason", "notPickable");
            call.resolve(out);
            return;
        }
        JSObject out = new JSObject();
        out.put("picked", true);
        out.put("handle", tree.toString());
        out.put("label", labelOf(tree));
        call.resolve(out);
    }

    @PluginMethod
    public void resolve(PluginCall call) {
        String handle = call.getString("handle");
        JSObject out = new JSObject();
        if (handle == null || handle.isEmpty()) {
            out.put("state", "invalid");
            call.resolve(out);
            return;
        }
        Uri tree = Uri.parse(handle);
        boolean granted = false;
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission() && p.isWritePermission()) {
                granted = true;
                break;
            }
        }
        String label = labelOf(tree);
        // A grant can survive the folder: the provider then answers the root
        // query with nothing. Both cases are "expired" to the user.
        boolean reachable = granted && rootExists(tree);
        out.put("state", reachable ? "ok" : "expired");
        out.put("label", label);
        call.resolve(out);
    }

    @PluginMethod
    public void release(PluginCall call) {
        String handle = call.getString("handle");
        if (handle != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                    Uri.parse(handle),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
            } catch (SecurityException ignored) {
                // Already gone: the goal is "not held", which is the case.
            }
            docIdCache.remove(handle);
        }
        call.resolve();
    }

    @PluginMethod
    public void list(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path", "");
        if (handle == null) { call.reject("handle required"); return; }
        try {
            Uri tree = Uri.parse(handle);
            String dirId = docIdFor(tree, handle, path);
            if (dirId == null) { call.reject("not found: " + path, "ENOENT"); return; }
            JSArray entries = new JSArray();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
            try (Cursor c = getContext().getContentResolver().query(children, CHILD_PROJECTION, null, null, null)) {
                requireCompleteCursor(c);
                Map<String, String> cache = cacheFor(handle);
                while (c.moveToNext()) {
                    String id = c.getString(0);
                    String name = c.getString(1);
                    String mime = c.getString(2);
                    JSObject e = new JSObject();
                    e.put("name", name);
                    boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                    e.put("isDirectory", isDir);
                    e.put("size", c.isNull(3) ? 0 : c.getLong(3));
                    e.put("mtime", c.isNull(4) ? 0 : c.getLong(4));
                    entries.put(e);
                    cache.put(join(path, name), id);
                }
            }
            JSObject out = new JSObject();
            out.put("entries", entries);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("list failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stat(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path", "");
        if (handle == null) { call.reject("handle required"); return; }
        try {
            Uri tree = Uri.parse(handle);
            JSObject out = new JSObject();
            String id = docIdFor(tree, handle, path);
            if (id == null) { out.put("entry", JSObject.NULL); call.resolve(out); return; }
            JSObject entry = describe(tree, id, lastSegment(path));
            out.put("entry", entry == null ? JSObject.NULL : entry);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("stat failed: " + e.getMessage());
        }
    }

    /** The most one message carries, in bytes before base64 (`BRIDGE_PART_BYTES` in JS). */
    private static final int MAX_PART = 256 * 1024;
    /** A read or a write in parts nobody finished (its page went away) is dropped after this long without a call. */
    private static final long IDLE_MS = 2L * 60L * 1000L;

    /** A read in parts: the copy of the one version that was opened, in the app's cache. */
    private static final class OpenRead {
        final File copy;
        final RandomAccessFile file;
        volatile long lastUsed = System.currentTimeMillis();
        OpenRead(File copy, RandomAccessFile file) { this.copy = copy; this.file = file; }
    }

    /** A write in parts: what was sent so far, in the app's cache, and where it goes. */
    private static final class OpenWrite {
        final File parts;
        final FileOutputStream out;
        final String handle;
        final String path;
        volatile long lastUsed = System.currentTimeMillis();
        OpenWrite(File parts, FileOutputStream out, String handle, String path) {
            this.parts = parts; this.out = out; this.handle = handle; this.path = path;
        }
    }

    private final Map<String, OpenRead> reads = new ConcurrentHashMap<>();
    private final Map<String, OpenWrite> writes = new ConcurrentHashMap<>();

    private File partsFolder() {
        File dir = new File(getContext().getCacheDir(), "vault-folder-parts");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    private void dropIdle() {
        long cutoff = System.currentTimeMillis() - IDLE_MS;
        for (Map.Entry<String, OpenRead> e : reads.entrySet()) {
            if (e.getValue().lastUsed < cutoff) dropRead(e.getKey());
        }
        for (Map.Entry<String, OpenWrite> e : writes.entrySet()) {
            if (e.getValue().lastUsed < cutoff) dropWrite(e.getKey());
        }
    }

    private void dropRead(String id) {
        OpenRead read = reads.remove(id);
        if (read == null) return;
        try { read.file.close(); } catch (Exception ignored) { /* the copy goes either way */ }
        //noinspection ResultOfMethodCallIgnored
        read.copy.delete();
    }

    private void dropWrite(String id) {
        OpenWrite write = writes.remove(id);
        if (write == null) return;
        try { write.out.close(); } catch (Exception ignored) { /* the parts go either way */ }
        //noinspection ResultOfMethodCallIgnored
        write.parts.delete();
    }

    /**
     * A file in one answer, up to `maxBytes` (one part when left out). A larger
     * one answers `tooLarge` with what it read so far as its size, and no data:
     * every call's text is parsed on this app's UI thread, and a whole picture
     * in one answer froze the app (release list F54, the class of F51).
     */
    @PluginMethod
    public void read(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path");
        if (handle == null || path == null) { call.reject("handle and path required"); return; }
        Long asked = JsNumbers.whole(call, "maxBytes");
        long max = asked == null || asked < 0 ? MAX_PART : Math.min(asked, MAX_PART);
        try {
            Uri tree = Uri.parse(handle);
            String id = docIdFor(tree, handle, path);
            if (id == null) { call.reject("not found: " + path, "ENOENT"); return; }
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            try (InputStream in = getContext().getContentResolver().openInputStream(doc)) {
                if (in == null) { call.reject("not readable: " + path); return; }
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[64 * 1024];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > max) {
                        JSObject out = new JSObject();
                        out.put("tooLarge", true);
                        out.put("size", buf.size());
                        call.resolve(out);
                        return;
                    }
                }
                JSObject out = new JSObject();
                out.put("dataBase64", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
                call.resolve(out);
            }
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        }
    }

    /**
     * Opens a file for a read in parts. The document is copied into the app's
     * cache first: a provider hands out a stream, often a pipe that cannot
     * seek, and a sync client may write the file meanwhile - the copy is the
     * one version every part comes from.
     */
    @PluginMethod
    public void openRead(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path");
        if (handle == null || path == null) { call.reject("handle and path required"); return; }
        dropIdle();
        File copy = null;
        try {
            Uri tree = Uri.parse(handle);
            String id = docIdFor(tree, handle, path);
            if (id == null) { call.reject("not found: " + path, "ENOENT"); return; }
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            copy = File.createTempFile("read-", null, partsFolder());
            try (InputStream in = getContext().getContentResolver().openInputStream(doc);
                 FileOutputStream out = new FileOutputStream(copy)) {
                if (in == null) throw new IllegalStateException("not readable: " + path);
                byte[] chunk = new byte[64 * 1024];
                int n;
                while ((n = in.read(chunk)) > 0) out.write(chunk, 0, n);
            }
            RandomAccessFile file = new RandomAccessFile(copy, "r");
            String readId = UUID.randomUUID().toString();
            reads.put(readId, new OpenRead(copy, file));
            JSObject out = new JSObject();
            out.put("id", readId);
            out.put("size", file.length());
            call.resolve(out);
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            if (copy != null) copy.delete();
            call.reject("read failed: " + e.getMessage());
        }
    }

    /** At most `length` bytes (never more than one part) from `offset` of an open read, base64. */
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
            byte[] bytes;
            synchronized (read) {
                int want = (int) Math.max(0, Math.min(Math.min(length, MAX_PART), read.file.length() - offset));
                bytes = new byte[want];
                read.file.seek(offset);
                read.file.readFully(bytes);
            }
            JSObject out = new JSObject();
            out.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void closeRead(PluginCall call) {
        String id = call.getString("id");
        if (id != null) dropRead(id);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void write(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path");
        String data = call.getString("dataBase64");
        if (handle == null || path == null || data == null) { call.reject("handle, path and dataBase64 required"); return; }
        try {
            writeDocument(handle, path, new java.io.ByteArrayInputStream(Base64.decode(data, Base64.DEFAULT)));
            call.resolve();
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
        }
    }

    /** A write in parts: they gather in the app's cache; the folder's file is touched only at `commit`. */
    @PluginMethod
    public void begin(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path");
        if (handle == null || path == null) { call.reject("handle and path required"); return; }
        dropIdle();
        try {
            File parts = File.createTempFile("write-", null, partsFolder());
            String id = UUID.randomUUID().toString();
            writes.put(id, new OpenWrite(parts, new FileOutputStream(parts), handle, path));
            JSObject out = new JSObject();
            out.put("id", id);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void append(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        OpenWrite write = id == null ? null : writes.get(id);
        if (write == null || data == null) { call.reject("no such write"); return; }
        try {
            write.lastUsed = System.currentTimeMillis();
            write.out.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve(new JSObject());
        } catch (Exception e) {
            dropWrite(id);
            call.reject("write failed: " + e.getMessage());
        }
    }

    /** Writes the gathered parts over the folder's file, exactly as `write` does with one message. */
    @PluginMethod
    public void commit(PluginCall call) {
        String id = call.getString("id");
        OpenWrite write = id == null ? null : writes.remove(id);
        if (write == null) { call.reject("no such write"); return; }
        try {
            write.out.close();
            try (InputStream in = new FileInputStream(write.parts)) {
                writeDocument(write.handle, write.path, in);
            }
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
        } finally {
            try { write.out.close(); } catch (Exception ignored) { /* already closed */ }
            //noinspection ResultOfMethodCallIgnored
            write.parts.delete();
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String id = call.getString("id");
        if (id != null) dropWrite(id);
        call.resolve(new JSObject());
    }

    /**
     * The bytes of `in` over the document at `path`. SAF has no rename-over:
     * the document's own stream in "wt" mode; a document created for this
     * write and not filled is deleted again, so the tree never shows an empty file.
     */
    private void writeDocument(String handle, String path, InputStream in) throws Exception {
        Uri tree = Uri.parse(handle);
        String existing = docIdFor(tree, handle, path);
        Uri doc;
        boolean created = false;
        if (existing != null) {
            doc = DocumentsContract.buildDocumentUriUsingTree(tree, existing);
        } else {
            String parentId = ensureDir(tree, handle, parentOf(path));
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, parentId);
            doc = DocumentsContract.createDocument(getContext().getContentResolver(), parent, mimeFor(path), lastSegment(path));
            if (doc == null) throw new IllegalStateException("create failed: " + path);
            created = true;
            invalidate(handle);
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(doc, "wt")) {
            if (out == null) throw new IllegalStateException("not writable");
            byte[] chunk = new byte[64 * 1024];
            int n;
            while ((n = in.read(chunk)) > 0) out.write(chunk, 0, n);
            out.flush();
        } catch (Exception e) {
            if (created) {
                try { DocumentsContract.deleteDocument(getContext().getContentResolver(), doc); } catch (Exception ignored) { /* best effort */ }
                invalidate(handle);
            }
            throw e;
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path");
        boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
        if (handle == null || path == null || path.isEmpty()) { call.reject("handle and path required"); return; }
        try {
            Uri tree = Uri.parse(handle);
            String id = docIdFor(tree, handle, path);
            if (id == null) { call.reject("not found: " + path, "ENOENT"); return; }
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            JSObject entry = describe(tree, id, lastSegment(path));
            if (entry != null && Boolean.TRUE.equals(entry.getBool("isDirectory")) && !recursive && hasChildren(tree, id)) {
                call.reject("directory not empty: " + path);
                return;
            }
            DocumentsContract.deleteDocument(getContext().getContentResolver(), doc);
            invalidate(handle);
            call.resolve();
        } catch (Exception e) {
            call.reject("delete failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String handle = call.getString("handle");
        String from = call.getString("from");
        String to = call.getString("to");
        if (handle == null || from == null || to == null) { call.reject("handle, from and to required"); return; }
        try {
            Uri tree = Uri.parse(handle);
            String id = docIdFor(tree, handle, from);
            if (id == null) { call.reject("not found: " + from, "ENOENT"); return; }
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            String fromParent = parentOf(from);
            String toParent = parentOf(to);
            ContentResolver resolver = getContext().getContentResolver();
            if (!fromParent.equals(toParent)) {
                String sourceParentId = docIdFor(tree, handle, fromParent);
                String targetParentId = ensureDir(tree, handle, toParent);
                Uri moved = DocumentsContract.moveDocument(
                    resolver,
                    doc,
                    DocumentsContract.buildDocumentUriUsingTree(tree, sourceParentId),
                    DocumentsContract.buildDocumentUriUsingTree(tree, targetParentId)
                );
                if (moved == null) { call.reject("move failed: " + from); return; }
                doc = moved;
            }
            String fromName = lastSegment(from);
            String toName = lastSegment(to);
            if (!fromName.equals(toName)) {
                Uri renamed = DocumentsContract.renameDocument(resolver, doc, toName);
                if (renamed == null) { call.reject("rename failed: " + from); return; }
            }
            invalidate(handle);
            call.resolve();
        } catch (Exception e) {
            call.reject("rename failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path", "");
        if (handle == null) { call.reject("handle required"); return; }
        try {
            ensureDir(Uri.parse(handle), handle, path);
            call.resolve();
        } catch (Exception e) {
            call.reject("mkdir failed: " + e.getMessage());
        }
    }

    // ---- helpers ----------------------------------------------------------

    private Map<String, String> cacheFor(String handle) {
        Map<String, String> m = docIdCache.get(handle);
        if (m == null) {
            m = new HashMap<>();
            docIdCache.put(handle, m);
        }
        return m;
    }

    private void invalidate(String handle) {
        docIdCache.remove(handle);
    }

    /** Document id of a vault-relative path, or null when it does not exist. */
    private String docIdFor(Uri tree, String handle, String path) {
        String rel = normalize(path);
        if (rel.isEmpty()) return DocumentsContract.getTreeDocumentId(tree);
        Map<String, String> cache = cacheFor(handle);
        String cached = cache.get(rel);
        if (cached != null) return cached;
        // Walk from the deepest cached ancestor.
        String[] parts = rel.split("/");
        String current = DocumentsContract.getTreeDocumentId(tree);
        StringBuilder walked = new StringBuilder();
        for (String part : parts) {
            String next = walked.length() == 0 ? part : walked + "/" + part;
            String known = cache.get(next);
            if (known == null) {
                known = childId(tree, current, part, cache, walked.toString());
                if (known == null) return null;
            }
            current = known;
            walked.setLength(0);
            walked.append(next);
        }
        return current;
    }

    /** One child query of `parentId`, filling the cache for every sibling on the way. */
    private String childId(Uri tree, String parentId, String name, Map<String, String> cache, String parentPath) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String found = null;
        try (Cursor c = getContext().getContentResolver().query(children, CHILD_PROJECTION, null, null, null)) {
            requireCompleteCursor(c);
            while (c.moveToNext()) {
                String id = c.getString(0);
                String childName = c.getString(1);
                cache.put(join(parentPath, childName), id);
                if (name.equals(childName)) found = id;
            }
        }
        return found;
    }

    private String ensureDir(Uri tree, String handle, String path) throws Exception {
        String rel = normalize(path);
        if (rel.isEmpty()) return DocumentsContract.getTreeDocumentId(tree);
        String existing = docIdFor(tree, handle, rel);
        if (existing != null) return existing;
        String parentId = ensureDir(tree, handle, parentOf(rel));
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, parentId);
        Uri made = DocumentsContract.createDocument(getContext().getContentResolver(), parent, DocumentsContract.Document.MIME_TYPE_DIR, lastSegment(rel));
        if (made == null) throw new IllegalStateException("mkdir failed: " + rel);
        invalidate(handle);
        return DocumentsContract.getDocumentId(made);
    }

    private JSObject describe(Uri tree, String id, String name) {
        Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        try (Cursor c = getContext().getContentResolver().query(doc, CHILD_PROJECTION, null, null, null)) {
            requireCompleteCursor(c);
            if (!c.moveToFirst()) return null;
            JSObject e = new JSObject();
            String displayName = c.getString(1);
            e.put("name", displayName != null ? displayName : name);
            e.put("isDirectory", DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)));
            e.put("size", c.isNull(3) ? 0 : c.getLong(3));
            e.put("mtime", c.isNull(4) ? 0 : c.getLong(4));
            return e;
        }
    }

    private boolean hasChildren(Uri tree, String id) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
        try (Cursor c = getContext().getContentResolver().query(children, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
            requireCompleteCursor(c);
            return c.moveToFirst();
        }
    }

    /** A crashed or still-loading provider did not report an empty folder. */
    private static void requireCompleteCursor(Cursor cursor) {
        if (cursor == null || cursor.getExtras().getBoolean(DocumentsContract.EXTRA_LOADING, false)) {
            throw new IllegalStateException("folder provider did not return a complete result");
        }
    }

    private boolean rootExists(Uri tree) {
        try {
            return describe(tree, DocumentsContract.getTreeDocumentId(tree), "") != null;
        } catch (Exception e) {
            return false;
        }
    }

    private String labelOf(Uri tree) {
        try {
            JSObject root = describe(tree, DocumentsContract.getTreeDocumentId(tree), "");
            String name = root == null ? null : root.getString("name");
            if (name != null && !name.isEmpty()) return name;
        } catch (Exception ignored) {
            // fall through to the id
        }
        String id = DocumentsContract.getTreeDocumentId(tree);
        int colon = id.lastIndexOf(':');
        String tail = colon >= 0 ? id.substring(colon + 1) : id;
        int slash = tail.lastIndexOf('/');
        return slash >= 0 ? tail.substring(slash + 1) : (tail.isEmpty() ? "Storage" : tail);
    }

    private static String normalize(String path) {
        if (path == null) return "";
        String p = path.replace('\\', '/');
        while (p.startsWith("/")) p = p.substring(1);
        while (p.endsWith("/")) p = p.substring(0, p.length() - 1);
        return p;
    }

    private static String parentOf(String path) {
        String p = normalize(path);
        int i = p.lastIndexOf('/');
        return i < 0 ? "" : p.substring(0, i);
    }

    private static String lastSegment(String path) {
        String p = normalize(path);
        int i = p.lastIndexOf('/');
        return i < 0 ? p : p.substring(i + 1);
    }

    private static String join(String dir, String name) {
        String d = normalize(dir);
        return d.isEmpty() ? name : d + "/" + name;
    }

    private static String mimeFor(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".json") || lower.endsWith(".base")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".pdf")) return "application/pdf";
        return "application/octet-stream";
    }

    @SuppressWarnings("unused")
    private static List<String> segments(String path) {
        List<String> out = new ArrayList<>();
        for (String s : normalize(path).split("/")) if (!s.isEmpty()) out.add(s);
        return out;
    }
}
