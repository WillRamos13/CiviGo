package com.civigo.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

/** Delegates capture to the device's speech Activity. CiviGo never records audio itself. */
@CapacitorPlugin(name = "SpeechSearch")
public class SpeechSearchPlugin extends Plugin {
    private PluginCall pending;
    private String activeRequest;
    private String activeCallback;
    private boolean destroyed;

    private Intent speechIntent() {
        return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-PE")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "¿A dónde vamos?")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean available = false;
            try { available = speechIntent().resolveActivity(getContext().getPackageManager()) != null; }
            catch (RuntimeException ignored) { /* An unavailable recognizer is a supported state. */ }
            JSObject result = new JSObject();
            result.put("available", available);
            result.put("externalActivity", true);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String requestId = call.getString("requestId", "");
            if (destroyed || requestId.isEmpty() || requestId.length() > 100) {
                call.reject("Solicitud de voz no válida.", "SPEECH_INVALID"); return;
            }
            // Keep the slot until the Activity result, including after JS cancellation.
            // Capacitor saves the last callback ID, so overlapping Activities must never be launched.
            if (activeRequest != null) { call.reject("El reconocedor ya está abierto.", "SPEECH_BUSY"); return; }
            try {
                Intent intent = speechIntent();
                if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                    call.reject("No hay reconocedor de voz disponible.", "SPEECH_UNAVAILABLE"); return;
                }
                pending = call; activeRequest = requestId; activeCallback = call.getCallbackId();
                startActivityForResult(call, intent, "speechResult");
            } catch (ActivityNotFoundException error) {
                clearRequest(); call.reject("No hay reconocedor de voz disponible.", "SPEECH_UNAVAILABLE");
            } catch (SecurityException error) {
                clearRequest(); call.reject("El reconocedor no permite esta solicitud.", "SPEECH_DENIED");
            } catch (RuntimeException error) {
                clearRequest(); call.reject("No se pudo abrir el reconocedor.", "SPEECH_FAILED");
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (activeRequest != null && activeRequest.equals(call.getString("requestId"))) {
                PluginCall prior = pending;
                pending = null;
                if (prior != null) prior.resolve(cancelled());
                // The system owns its Activity; don't finish CiviGo or interfere with another app.
                // Its eventual result will release this slot without sending transcript to the closed search.
            }
            call.resolve();
        });
    }

    @ActivityCallback
    private void speechResult(PluginCall call, ActivityResult result) {
        if (destroyed || activeCallback == null) return;
        if (call != null && !activeCallback.equals(call.getCallbackId())) return;
        PluginCall target = pending;
        clearRequest();
        if (target == null) return;
        try {
            if (result.getResultCode() == Activity.RESULT_CANCELED) { target.resolve(cancelled()); return; }
            if (result.getResultCode() != Activity.RESULT_OK) {
                target.reject("El reconocedor no pudo completar la solicitud.", "SPEECH_FAILED"); return;
            }
            Intent data = result.getData();
            ArrayList<String> matches = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            String transcript = "";
            if (matches != null && !matches.isEmpty() && matches.get(0) != null) {
                transcript = matches.get(0).replaceAll("[\\p{Cntrl}\\s]+", " ").trim();
                if (transcript.length() > 160) transcript = transcript.substring(0, 160);
            }
            JSObject value = new JSObject(); value.put("transcript", transcript); target.resolve(value);
        } catch (RuntimeException error) {
            // A recognizer is another app: malformed parcelables or list entries must not
            // crash CiviGo or leave its already-cleared request unresolved. Never log audio/text.
            target.reject("El reconocedor devolvió una respuesta no válida.", "SPEECH_FAILED");
        }
    }

    private JSObject cancelled() { JSObject value = new JSObject(); value.put("cancelled", true); return value; }
    private void clearRequest() { pending = null; activeRequest = null; activeCallback = null; }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        PluginCall prior = pending;
        clearRequest();
        if (prior != null) prior.resolve(cancelled());
        super.handleOnDestroy();
    }
}
