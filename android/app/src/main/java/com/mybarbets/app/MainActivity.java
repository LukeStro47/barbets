package com.mybarbets.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins have to be registered before the bridge is built in super.onCreate,
        // or the web layer's registerPlugin('DeferredInvite') resolves to UNIMPLEMENTED.
        registerPlugin(DeferredInvitePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
