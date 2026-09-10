package com.mybarbets.app;

import android.os.RemoteException;
import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands the web layer the raw Play install referrer string, so an invite QR code scanned before
 * the app was installed can finish its join on the first open afterward. The store link that
 * MobileAppGate sends a phone browser to carries `referrer=utm_source=qr&utm_medium=invite&
 * invite_code=XXXX` (see lib/inviteLink.ts), and Google Play keeps that string for the app to
 * read back through the Install Referrer API for 90 days after install. No third-party
 * attribution SDK: this is Google's own client library and nothing else.
 *
 * Deliberately returns the whole referrer rather than a parsed code, so the printed-card
 * referrer (`utm_medium=print&utm_campaign=<batch>`) rides through the same call if the web
 * layer ever wants it. The JS side (lib/deferredInvite.ts, components/pwa/DeferredInviteLink.tsx)
 * owns the parsing and the run-once guard; this class is stateless.
 *
 * Registered in MainActivity. Any install whose shell predates this class rejects the call with
 * UNIMPLEMENTED, which the JS side treats as "no invite," not as an error.
 */
@CapacitorPlugin(name = "DeferredInvite")
public class DeferredInvitePlugin extends Plugin {

    @PluginMethod
    public void read(final PluginCall call) {
        final InstallReferrerClient client = InstallReferrerClient.newBuilder(getContext()).build();
        final boolean[] settled = { false };

        client.startConnection(
            new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    if (settled[0]) return;
                    settled[0] = true;
                    JSObject ret = new JSObject();
                    if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                        try {
                            ReferrerDetails details = client.getInstallReferrer();
                            String referrer = details.getInstallReferrer();
                            if (referrer != null) ret.put("value", referrer);
                        } catch (RemoteException | RuntimeException ignored) {
                            // Play Services flaked or the Play Store app is missing/old: same
                            // answer as "no referrer", and nothing worth surfacing.
                        }
                    }
                    try {
                        client.endConnection();
                    } catch (RuntimeException ignored) {}
                    call.resolve(ret);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    if (settled[0]) return;
                    settled[0] = true;
                    call.resolve(new JSObject());
                }
            }
        );
    }
}
