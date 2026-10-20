package com.civigo.app;

import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.Set;

/** Uses Android's speech engine; no microphone permission or external API key. */
@CapacitorPlugin(name = "NavigationVoice")
public class NavigationVoicePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech engine;
    private PluginCall pending;
    private String pendingText;
    private PluginCall speaking;
    private String speakingId;
    private boolean ready;
    private boolean initializing;
    private boolean destroyed;
    private boolean paused;
    private int engineGeneration;
    private long utterance;
    private final Runnable timeout = () -> {
        failPending("El motor de voz tardó demasiado. Revisa la salida de texto a voz de Android.", "VOICE_UNAVAILABLE");
        shutdown();
    };
    private final Runnable playbackTimeout = () -> {
        failSpeaking("No se pudo completar la indicación de voz.", "VOICE_UNAVAILABLE");
        if (engine != null) try { engine.stop(); } catch (Exception ignored) {}
    };

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > 1000) {
            call.reject("La indicación de voz no es válida.", "VOICE_INVALID_TEXT");
            return;
        }
        main.post(() -> {
            if (destroyed || paused) {
                call.reject("La navegación ya no está activa.", "SPEECH_CANCELLED");
                return;
            }
            cancelPending();
            failSpeaking("Indicación de voz reemplazada.", "SPEECH_CANCELLED");
            pending = call;
            pendingText = text;
            if (ready) { speakPending(); return; }
            if (initializing) return;
            initializing = true;
            main.postDelayed(timeout, 12000);
            final int ownedGeneration = ++engineGeneration;
            try {
                engine = new TextToSpeech(getContext().getApplicationContext(), status -> main.post(() -> {
                    if (ownedGeneration == engineGeneration) initialized(status);
                }));
            } catch (Exception error) {
                failPending("No se pudo abrir el motor de voz de Android.", "VOICE_UNAVAILABLE");
                shutdown();
            }
        });
    }

    private void initialized(int status) {
        main.removeCallbacks(timeout);
        initializing = false;
        if (destroyed) { shutdown(); return; }
        if (status != TextToSpeech.SUCCESS || engine == null) {
            failPending("Activa un motor de texto a voz en los ajustes de Android.", "VOICE_UNAVAILABLE");
            shutdown();
            return;
        }
        try {
            int language = engine.setLanguage(Locale.forLanguageTag("es-PE"));
            if (language < TextToSpeech.LANG_AVAILABLE) language = engine.setLanguage(Locale.forLanguageTag("es-ES"));
            if (language < TextToSpeech.LANG_AVAILABLE) {
                failPending("Instala una voz en español en los ajustes de texto a voz de Android.", "VOICE_LANGUAGE_UNAVAILABLE");
                shutdown();
                return;
            }
            // Prefer an installed Spanish voice that can work without a network.
            Set<Voice> voices = engine.getVoices();
            if (voices != null) for (Voice voice : voices) {
                if ("es".equals(voice.getLocale().getLanguage()) && !voice.isNetworkConnectionRequired()) {
                    engine.setVoice(voice);
                    break;
                }
            }
            engine.setSpeechRate(1.0f);
            engine.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) {
                    main.post(() -> {
                        if (speakingId != null && speakingId.equals(id) && speaking != null) {
                            main.removeCallbacks(playbackTimeout);
                            speaking.resolve(); speaking = null; speakingId = null;
                        }
                    });
                }
                @Override public void onError(String id) { speechFailed(id); }
                @Override public void onError(String id, int code) { speechFailed(id); }
                @Override public void onStop(String id, boolean interrupted) {
                    main.post(() -> {
                        if (speakingId != null && speakingId.equals(id)) failSpeaking("Indicación de voz cancelada.", "SPEECH_CANCELLED");
                    });
                }
            });
            ready = true;
            if (paused) cancelPending(); else speakPending();
        } catch (Exception error) {
            failPending("No se pudo preparar la voz en español.", "VOICE_UNAVAILABLE");
            shutdown();
        }
    }

    private void speakPending() {
        if (pending == null || engine == null || !ready) return;
        PluginCall call = pending;
        String text = pendingText;
        pending = null;
        pendingText = null;
        speaking = call;
        speakingId = "civigo-navigation-" + (++utterance);
        try {
            int result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), speakingId);
            if (result == TextToSpeech.SUCCESS)
                main.postDelayed(playbackTimeout, Math.min(120000, Math.max(15000, text.length() * 110L)));
            else failSpeaking("No se pudo reproducir la indicación de voz.", "VOICE_UNAVAILABLE");
        } catch (Exception error) {
            failSpeaking("No se pudo reproducir la indicación de voz.", "VOICE_UNAVAILABLE");
        }
    }

    private void speechFailed(String id) {
        main.post(() -> { if (speakingId != null && speakingId.equals(id)) failSpeaking("El motor de voz no pudo reproducir la indicación.", "VOICE_UNAVAILABLE"); });
    }

    private void failSpeaking(String message, String code) {
        main.removeCallbacks(playbackTimeout);
        if (speaking != null) speaking.reject(message, code);
        speaking = null; speakingId = null;
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> { stopSpeech(); call.resolve(); });
    }

    private void failPending(String message, String code) {
        if (pending != null) pending.reject(message, code);
        pending = null;
        pendingText = null;
    }

    private void cancelPending() { failPending("Indicación de voz cancelada.", "SPEECH_CANCELLED"); }
    private void stopSpeech() {
        cancelPending();
        failSpeaking("Indicación de voz cancelada.", "SPEECH_CANCELLED");
        if (engine != null) try { engine.stop(); } catch (Exception ignored) {}
        if (initializing) shutdown();
    }
    private void shutdown() {
        engineGeneration++;
        main.removeCallbacks(timeout);
        main.removeCallbacks(playbackTimeout);
        ready = false;
        initializing = false;
        if (engine != null) {
            try { engine.shutdown(); } catch (Exception ignored) {}
            engine = null;
        }
    }
    @Override protected void handleOnResume() { main.post(() -> paused = false); }
    @Override protected void handleOnPause() { main.post(() -> { paused = true; stopSpeech(); }); }
    @Override protected void handleOnDestroy() {
        main.post(() -> { destroyed = true; stopSpeech(); shutdown(); });
    }
}
