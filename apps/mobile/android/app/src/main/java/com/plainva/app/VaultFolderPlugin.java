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
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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
            if (dirId == null) { call.reject("not found: " + path); return; }
            JSArray entries = new JSArray();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
            try (Cursor c = getContext().getContentResolver().query(children, CHILD_PROJECTION, null, null, null)) {
                if (c != null) {
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

    @PluginMethod
    public void read(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path");
        if (handle == null || path == null) { call.reject("handle and path required"); return; }
        try {
            Uri tree = Uri.parse(handle);
            String id = docIdFor(tree, handle, path);
            if (id == null) { call.reject("not found: " + path); return; }
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            try (InputStream in = getContext().getContentResolver().openInputStream(doc)) {
                if (in == null) { call.reject("not readable: " + path); return; }
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[64 * 1024];
                int n;
                while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
                JSObject out = new JSObject();
                out.put("dataBase64", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
                call.resolve(out);
            }
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String handle = call.getString("handle");
        String path = call.getString("path");
        String data = call.getString("dataBase64");
        if (handle == null || path == null || data == null) { call.reject("handle, path and dataBase64 required"); return; }
        try {
            Uri tree = Uri.parse(handle);
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            String existing = docIdFor(tree, handle, path);
            Uri doc;
            boolean created = false;
            if (existing != null) {
                doc = DocumentsContract.buildDocumentUriUsingTree(tree, existing);
            } else {
                String parentId = ensureDir(tree, handle, parentOf(path));
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, parentId);
                doc = DocumentsContract.createDocument(getContext().getContentResolver(), parent, mimeFor(path), lastSegment(path));
                if (doc == null) { call.reject("create failed: " + path); return; }
                created = true;
                invalidate(handle);
            }
            try (OutputStream out = getContext().getContentResolver().openOutputStream(doc, "wt")) {
                if (out == null) throw new IllegalStateException("not writable");
                out.write(bytes);
                out.flush();
            } catch (Exception e) {
                // A document that was created for this write and could not be
                // filled must not survive as an empty file the tree then shows.
                if (created) {
                    try { DocumentsContract.deleteDocument(getContext().getContentResolver(), doc); } catch (Exception ignored) { /* best effort */ }
                    invalidate(handle);
                }
                throw e;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
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
            if (id == null) { call.reject("not found: " + path); return; }
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
            if (id == null) { call.reject("not found: " + from); return; }
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
            if (c != null) {
                while (c.moveToNext()) {
                    String id = c.getString(0);
                    String childName = c.getString(1);
                    cache.put(join(parentPath, childName), id);
                    if (name.equals(childName)) found = id;
                }
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
            if (c == null || !c.moveToFirst()) return null;
            JSObject e = new JSObject();
            String displayName = c.getString(1);
            e.put("name", displayName != null ? displayName : name);
            e.put("isDirectory", DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2)));
            e.put("size", c.isNull(3) ? 0 : c.getLong(3));
            e.put("mtime", c.isNull(4) ? 0 : c.getLong(4));
            return e;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean hasChildren(Uri tree, String id) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
        try (Cursor c = getContext().getContentResolver().query(children, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
            return c != null && c.moveToFirst();
        } catch (Exception e) {
            return false;
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
