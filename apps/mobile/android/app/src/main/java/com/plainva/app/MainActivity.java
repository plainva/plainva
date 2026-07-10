package com.plainva.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin (not an npm package): the OkHttp bridge that gives the
        // shared WebDAV sync target its PROPFIND/MKCOL/MOVE/COPY methods.
        registerPlugin(WebDavHttpPlugin.class);
        registerPlugin(SecureStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
