package com.plainva.app;

import android.accounts.Account;
import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.List;

/** Google's system sign-in. Play services owns access-token renewal; no web
 * client secret or refresh-token exchange is embedded in the Android
 * application.
 *
 * It recognises the app by package name and signing certificate, and Google
 * lets that pair be registered in exactly one Cloud project. So this is NOT
 * the way a user's own Google project signs in - that is the browser flow
 * (pimOAuth.ts, oauthService.ts). The JS side calls this plugin only for the
 * client the build ships and to renew accounts that already hold such a grant.
 *
 * Every failure names its class. "Cancelled" used to cover a refused
 * registration, a network error and a closed sheet alike, and the reason Play
 * services gave was thrown away. A rejection now carries a stable code and, as
 * data, where it happened and what Play services answered - never a token, an
 * address or a scope. */
@CapacitorPlugin(name = "GoogleAuthorization")
public class GoogleAuthorizationPlugin extends Plugin {
    /** Activity result codes are 0 and -1; this marks "no activity result". */
    private static final int NO_RESULT = -2;
    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall active;
    /** The last activity result that found no waiting call, for diagnostics. */
    private JSObject orphan;

    @Override public void load() {
        launcher = getActivity().getActivityResultRegistry().register(
            "plainva.google.authorization", new ActivityResultContracts.StartIntentSenderForResult(), result -> {
                PluginCall call = active;
                active = null;
                int resultCode = result.getResultCode();
                Intent data = result.getData();
                if (call == null) { orphan = describe("result", resultCode, data != null, null); return; }
                // Back, or a tap beside the sheet, is the one result that carries nothing.
                if (data == null) {
                    fail(call, resultCode == Activity.RESULT_CANCELED ? "CANCELLED" : "AUTH_FAILED", "result", resultCode, false, null);
                    return;
                }
                try {
                    // Read the intent whatever the result code is: a refused
                    // request ends "cancelled" WITH a status that says why.
                    AuthorizationResult authorization = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data);
                    if (resultCode != Activity.RESULT_OK) { fail(call, "AUTH_FAILED", "result", resultCode, true, null); return; }
                    finish(call, authorization);
                } catch (Exception error) { fail(call, codeOf(error), "result", resultCode, true, error); }
            });
    }

    @PluginMethod public void authorize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (active != null) { call.reject("Google authorization is already running", "BUSY"); return; }
            try {
                JSArray values = call.getArray("scopes");
                if (values == null || values.length() == 0 || values.length() > 32) { call.reject("Invalid Google scopes"); return; }
                List<Scope> scopes = new ArrayList<>();
                for (int i = 0; i < values.length(); i++) {
                    String scope = values.getString(i);
                    if (scope.isEmpty() || scope.length() > 1024 || scope.chars().anyMatch(Character::isWhitespace)) { call.reject("Invalid Google scopes"); return; }
                    scopes.add(new Scope(scope));
                }
                boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
                String email = call.getString("email", "").trim();
                if (!interactive && email.isEmpty()) { call.reject("Google account needs sign-in", "CONSENT_REQUIRED"); return; }
                AuthorizationRequest.Builder request = AuthorizationRequest.builder().setRequestedScopes(scopes).setOptOutIncludingGrantedScopes(true);
                if (!email.isEmpty()) request.setAccount(new Account(email, "com.google"));
                else request.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
                active = call;
                Identity.getAuthorizationClient(getActivity()).authorize(request.build())
                    .addOnSuccessListener(result -> {
                        if (active != call) return;
                        if (result.hasResolution()) {
                            if (!interactive) { active = null; call.reject("Google account needs sign-in", "CONSENT_REQUIRED"); return; }
                            try { launcher.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build()); }
                            catch (Exception error) { active = null; fail(call, "AUTH_FAILED", "launch", NO_RESULT, false, error); }
                        } else { active = null; finish(call, result); }
                    }).addOnFailureListener(error -> { if (active == call) active = null; fail(call, codeOf(error), "request", NO_RESULT, false, error); });
            } catch (Exception error) { active = null; fail(call, "AUTH_FAILED", "request", NO_RESULT, false, error); }
        });
    }

    private void finish(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) { fail(call, "AUTH_FAILED", "token", NO_RESULT, false, null); return; }
        JSObject value = new JSObject();
        value.put("accessToken", token);
        value.put("scopes", new JSArray(result.getGrantedScopes()));
        call.resolve(value);
    }

    /** One stable code per class of failure; the number travels beside it. */
    private static String codeOf(Exception error) {
        if (!(error instanceof ApiException)) return "AUTH_FAILED";
        switch (((ApiException) error).getStatusCode()) {
            case CommonStatusCodes.CANCELED:
            case 12501: // GoogleSignInStatusCodes.SIGN_IN_CANCELLED
                return "CANCELLED";
            case CommonStatusCodes.DEVELOPER_ERROR: return "DEVELOPER_ERROR";
            case CommonStatusCodes.NETWORK_ERROR: return "NETWORK_ERROR";
            case CommonStatusCodes.TIMEOUT: return "TIMEOUT";
            case CommonStatusCodes.SIGN_IN_REQUIRED:
            case CommonStatusCodes.RESOLUTION_REQUIRED:
                return "SIGN_IN_REQUIRED";
            case CommonStatusCodes.INVALID_ACCOUNT: return "INVALID_ACCOUNT";
            case CommonStatusCodes.INTERNAL_ERROR: return "INTERNAL_ERROR";
            case 2: // SERVICE_VERSION_UPDATE_REQUIRED
            case 3: // SERVICE_DISABLED
            case CommonStatusCodes.API_NOT_CONNECTED:
                return "PLAY_SERVICES_UNAVAILABLE";
            default: return "AUTH_FAILED";
        }
    }

    /** Where it failed and what Play services said. Nothing personal: the
     * status text is cut short and loses anything shaped like an address or a
     * link (a scope is a link). */
    private static JSObject describe(String stage, int resultCode, boolean hadIntent, Exception error) {
        JSObject data = new JSObject();
        data.put("stage", stage);
        if (resultCode != NO_RESULT) { data.put("resultCode", resultCode); data.put("hadIntent", hadIntent); }
        if (error instanceof ApiException) {
            int status = ((ApiException) error).getStatusCode();
            data.put("status", status);
            data.put("statusName", CommonStatusCodes.getStatusCodeString(status));
            String text = ((ApiException) error).getStatus().getStatusMessage();
            if (text != null && !text.isEmpty()) {
                text = text.replaceAll("\\S+@\\S+", "<address>").replaceAll("[a-zA-Z][a-zA-Z0-9+.-]*://\\S+", "<link>");
                data.put("detail", text.length() > 160 ? text.substring(0, 160) : text);
            }
        } else if (error != null) data.put("exception", error.getClass().getSimpleName());
        return data;
    }

    private static void fail(PluginCall call, String code, String stage, int resultCode, boolean hadIntent, Exception error) {
        call.reject("CANCELLED".equals(code) ? "Google authorization cancelled" : "Google authorization failed", code, describe(stage, resultCode, hadIntent, error));
    }

    /** Reports, once, a result that arrived while no call was waiting. */
    @PluginMethod public void takeOrphanResult(PluginCall call) {
        JSObject value = new JSObject();
        if (orphan != null) value.put("orphan", orphan);
        orphan = null;
        call.resolve(value);
    }

    @PluginMethod public void clearToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token.isEmpty()) { call.resolve(); return; }
        Identity.getAuthorizationClient(getActivity()).clearToken(ClearTokenRequest.builder().setToken(token).build())
            .addOnSuccessListener(ignored -> call.resolve())
            .addOnFailureListener(ignored -> call.reject("Google token cache could not be cleared", "CACHE_FAILED"));
    }

    @Override protected void handleOnDestroy() {
        if (launcher != null) launcher.unregister();
        if (active != null) { active.reject("Google authorization interrupted", "INTERRUPTED"); active = null; }
    }
}
