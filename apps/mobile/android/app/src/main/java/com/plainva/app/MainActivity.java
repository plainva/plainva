package com.plainva.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import java.util.UUID;

public class MainActivity extends BridgeActivity {
    private String shareIntentId;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WebDavHttpPlugin.class);
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(AtomicFilePlugin.class);
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(MailNetPlugin.class);
        registerPlugin(GoogleAuthorizationPlugin.class);
        registerPlugin(VaultFolderPlugin.class);
        registerPlugin(DevicePimPlugin.class);
        registerPlugin(ProcessExitPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        shareIntentId = savedInstanceState == null ? null : savedInstanceState.getString("plainva.shareIntentId");
        stashShare(getIntent());
    }

    @Override
    public void onSaveInstanceState(Bundle state) {
        if (shareIntentId != null) state.putString("plainva.shareIntentId", shareIntentId);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // An intentional second share is a new transfer, even for equal text.
        shareIntentId = null;
        stashShare(intent);
    }

    private void stashShare(Intent intent) {
        if (intent == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction()) && !Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) return;
        // Never trust an incoming application's extra as our receipt identity.
        if (shareIntentId == null) shareIntentId = UUID.randomUUID().toString();
        ShareTargetPlugin.stage(this, new Intent(intent), shareIntentId);
    }
}
