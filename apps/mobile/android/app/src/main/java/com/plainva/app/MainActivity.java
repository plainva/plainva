package com.plainva.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    /** Skip shared files above this size (base64 in memory would risk OOM). */
    private static final long MAX_SHARE_BYTES = 25L * 1024 * 1024;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin (not an npm package): the OkHttp bridge that gives the
        // shared WebDAV sync target its PROPFIND/MKCOL/MOVE/COPY methods.
        registerPlugin(WebDavHttpPlugin.class);
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(AtomicFilePlugin.class);
        registerPlugin(ShareTargetPlugin.class);
        super.onCreate(savedInstanceState);
        stashShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        stashShare(intent);
    }

    /**
     * ACTION_SEND / ACTION_SEND_MULTIPLE land in the ShareTarget slot (package J):
     * plain text as text+subject, everything else (images and arbitrary files)
     * read into base64 file payloads. The JS shell polls on boot and resume.
     */
    private void stashShare(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            String type = intent.getType();
            if ("text/plain".equals(type)) {
                ShareTargetPlugin.pendingText = intent.getStringExtra(Intent.EXTRA_TEXT);
                ShareTargetPlugin.pendingSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                return;
            }
            // A file share may carry an accompanying subject/text too.
            String txt = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (txt != null) ShareTargetPlugin.pendingText = txt;
            if (intent.hasExtra(Intent.EXTRA_SUBJECT)) ShareTargetPlugin.pendingSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) stashUri(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            if (intent.hasExtra(Intent.EXTRA_SUBJECT)) ShareTargetPlugin.pendingSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (uris != null) {
                for (Uri u : uris) if (u != null) stashUri(u);
            }
        }
    }

    /** Read one shared content:// uri into a base64 file payload (name+mime+data). */
    private void stashUri(Uri uri) {
        try {
            ContentResolver cr = getContentResolver();
            String mime = cr.getType(uri);
            String name = queryDisplayName(cr, uri);
            InputStream in = cr.openInputStream(uri);
            if (in == null) return;
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            long total = 0;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > MAX_SHARE_BYTES) { in.close(); return; } // skip oversize
                bos.write(buf, 0, n);
            }
            in.close();
            JSONObject o = new JSONObject();
            o.put("name", name != null ? name : "shared");
            o.put("mime", mime != null ? mime : "application/octet-stream");
            o.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
            ShareTargetPlugin.pendingFiles.put(o);
        } catch (Exception e) {
            /* skip this uri — a bad share must not crash the launch */
        }
    }

    private String queryDisplayName(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String v = c.getString(idx);
                    if (v != null && !v.isEmpty()) return v;
                }
            }
        } catch (Exception e) {
            /* fall through to the last path segment */
        }
        return uri.getLastPathSegment();
    }
}
