package com.plainva.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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

    /** ACTION_SEND text lands in the ShareTarget slot (package J). */
    private void stashShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        if (!"text/plain".equals(intent.getType())) return;
        ShareTargetPlugin.pendingText = intent.getStringExtra(Intent.EXTRA_TEXT);
        ShareTargetPlugin.pendingSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
    }
}
