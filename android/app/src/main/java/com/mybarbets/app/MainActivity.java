package com.mybarbets.app;

import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins have to be registered before the bridge is built in super.onCreate,
        // or the web layer's registerPlugin('DeferredInvite') resolves to UNIMPLEMENTED.
        registerPlugin(DeferredInvitePlugin.class);
        super.onCreate(savedInstanceState);
        // server.errorPath (capacitor.config.ts) only fires on an explicit WebView load failure
        // (onReceivedError/onReceivedHttpError) - it has nothing for a request that just hangs
        // without ever failing or finishing, which is what a stalling/filtering cellular
        // connection looks like. Without this, BootSplash's native splash (launchAutoHide: false)
        // never gets released, because nothing releases it until the page's own JS runs, and that
        // JS never arrives. This swaps in a watchdog that forces the same offline.html fallback
        // after a timeout, so a hung load fails open into a real, retryable screen instead of an
        // indefinite splash. Reported 2026-09-10: UK Android users stuck on the boot splash on
        // cellular only, wifi unaffected.
        this.bridge.setWebViewClient(new WatchdogWebViewClient(this.bridge));
    }

    private static class WatchdogWebViewClient extends BridgeWebViewClient {
        private static final long LOAD_TIMEOUT_MS = 10000;

        private final Bridge bridge;
        private final Handler handler = new Handler(Looper.getMainLooper());
        private Runnable watchdog;

        WatchdogWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        private void cancelWatchdog() {
            if (watchdog != null) {
                handler.removeCallbacks(watchdog);
                watchdog = null;
            }
        }

        private void scheduleWatchdog(WebView view, String startedUrl) {
            cancelWatchdog();
            String errorUrl = bridge.getErrorUrl();
            // Nothing to fail over to, or this navigation IS the fallback page loading - don't
            // watch that or a timed-out load would just reload itself forever.
            if (errorUrl == null || startedUrl == null || startedUrl.equals(errorUrl)) return;
            watchdog = () -> {
                watchdog = null;
                view.loadUrl(errorUrl);
            };
            handler.postDelayed(watchdog, LOAD_TIMEOUT_MS);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            scheduleWatchdog(view, url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            cancelWatchdog();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) cancelWatchdog();
            super.onReceivedError(view, request, error);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (request.isForMainFrame()) cancelWatchdog();
            super.onReceivedHttpError(view, request, errorResponse);
        }
    }
}
