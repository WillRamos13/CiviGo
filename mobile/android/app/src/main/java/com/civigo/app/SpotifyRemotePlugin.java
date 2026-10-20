package com.civigo.app;

import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.spotify.android.appremote.api.ConnectionParams;
import com.spotify.android.appremote.api.Connector;
import com.spotify.android.appremote.api.SpotifyAppRemote;
import com.spotify.protocol.client.CallResult;
import com.spotify.protocol.client.Subscription;
import com.spotify.protocol.types.Empty;
import com.spotify.protocol.types.Image;
import com.spotify.protocol.types.PlayerState;
import com.spotify.protocol.types.Track;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;

/** Official App Remote only. No client secret, token storage or background service. */
@CapacitorPlugin(name = "SpotifyRemote")
public class SpotifyRemotePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<PendingCommand> commands = new HashSet<>();
    private SpotifyAppRemote remote;
    private Subscription<PlayerState> playerSubscription;
    private PlayerState playerState;
    private PluginCall pendingConnection;
    private boolean enabled;
    private boolean destroyed;
    private int generation;
    private long updatedAt;
    private String artwork;
    private String artworkUri;
    private final Runnable connectionTimeout = () -> {
        rejectConnection("La conexión con Spotify tardó demasiado. Inténtalo de nuevo.", "SPOTIFY_TIMEOUT");
        disconnectInternal();
    };

    private String setting(String name) {
        int id = getContext().getResources().getIdentifier(name, "string", getContext().getPackageName());
        return id == 0 ? "" : getContext().getString(id).trim();
    }
    private boolean configured() {
        String clientId = setting("spotify_client_id"), redirect = setting("spotify_redirect_uri");
        if (!clientId.matches("[a-fA-F0-9]{32}") || redirect.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(redirect);
            return ("civigo".equals(uri.getScheme()) || "https".equals(uri.getScheme())) &&
                uri.getHost() != null && !uri.getHost().isEmpty() && uri.getUserInfo() == null && uri.getFragment() == null;
        } catch (Exception ignored) { return false; }
    }
    private boolean connected() { return remote != null && remote.isConnected(); }

    @PluginMethod
    public void capabilities(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("platform", "android"); result.put("sdkVersion", "0.8.0");
            result.put("configured", configured()); result.put("installed", SpotifyAppRemote.isSpotifyInstalled(getContext()));
            result.put("connected", connected()); call.resolve(result);
        });
    }
    @PluginMethod
    public void setEnabled(PluginCall call) {
        final boolean value = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        main.post(() -> {
            enabled = value;
            if (!enabled) disconnectInternal();
            call.resolve();
        });
    }
    @PluginMethod
    public void connect(PluginCall call) {
        main.post(() -> {
            if (destroyed || !enabled || !Boolean.TRUE.equals(call.getBoolean("userInitiated", false))) {
                call.reject("Conecta Spotify desde su botón para autorizarlo.", "SPOTIFY_CONSENT_REQUIRED"); return;
            }
            if (!configured()) { call.reject("La integración de Spotify todavía no está configurada.", "SPOTIFY_NOT_CONFIGURED"); return; }
            if (!SpotifyAppRemote.isSpotifyInstalled(getContext())) { call.reject("Instala e inicia sesión en la aplicación oficial de Spotify.", "SPOTIFY_NOT_INSTALLED"); return; }
            if (connected()) { call.resolve(snapshot()); return; }
            if (pendingConnection != null) { call.reject("Ya hay una conexión con Spotify en curso.", "SPOTIFY_BUSY"); return; }
            pendingConnection = call;
            final int owned = ++generation;
            main.postDelayed(connectionTimeout, 30000);
            try {
                ConnectionParams parameters = new ConnectionParams.Builder(setting("spotify_client_id"))
                    .setRedirectUri(setting("spotify_redirect_uri")).showAuthView(true).build();
                SpotifyAppRemote.connect(getActivity(), parameters, new Connector.ConnectionListener() {
                    @Override public void onConnected(SpotifyAppRemote appRemote) {
                        main.post(() -> {
                            if (owned != generation || destroyed || !enabled || pendingConnection == null) {
                                SpotifyAppRemote.disconnect(appRemote); return;
                            }
                            remote = appRemote;
                            main.removeCallbacks(connectionTimeout);
                            PluginCall waiting = pendingConnection; pendingConnection = null;
                            playerSubscription = remote.getPlayerApi().subscribeToPlayerState();
                            playerSubscription.setEventCallback(state -> main.post(() -> {
                                if (owned != generation || !connected() || !enabled) return;
                                playerState = state; updatedAt = System.currentTimeMillis();
                                updateArtwork(owned, state.track); emitState();
                            }));
                            playerSubscription.setErrorCallback(error -> main.post(() -> {
                                if (owned == generation) disconnectInternal();
                            }));
                            waiting.resolve(snapshot()); emitState();
                        });
                    }
                    @Override public void onFailure(Throwable error) {
                        main.post(() -> {
                            if (owned != generation) return;
                            rejectConnection("No se pudo autorizar Spotify. Revisa su sesión y los permisos de CiviGo.", "SPOTIFY_CONNECTION_FAILED");
                            disconnectInternal();
                        });
                    }
                });
            } catch (Exception error) {
                rejectConnection("No se pudo abrir la conexión oficial con Spotify.", "SPOTIFY_CONNECTION_FAILED");
                disconnectInternal();
            }
        });
    }

    @PluginMethod public void getState(PluginCall call) { main.post(() -> call.resolve(snapshot())); }
    @PluginMethod public void disconnect(PluginCall call) { main.post(() -> { enabled = false; disconnectInternal(); call.resolve(); }); }

    @PluginMethod
    public void command(PluginCall call) {
        main.post(() -> {
            if (destroyed || !enabled || !connected()) { call.reject("Conecta Spotify para usar sus controles.", "SPOTIFY_NOT_CONNECTED"); return; }
            String action = call.getString("action", "");
            try {
                CallResult<Empty> operation;
                switch (action) {
                    case "pause": operation = remote.getPlayerApi().pause(); break;
                    case "resume": operation = remote.getPlayerApi().resume(); break;
                    case "next":
                        if (playerState == null || playerState.playbackRestrictions == null || !playerState.playbackRestrictions.canSkipNext) { call.reject("Spotify no permite saltar esta pista.", "SPOTIFY_CONTROL_UNAVAILABLE"); return; }
                        operation = remote.getPlayerApi().skipNext(); break;
                    case "previous":
                        if (playerState == null || playerState.playbackRestrictions == null || !playerState.playbackRestrictions.canSkipPrev) { call.reject("Spotify no permite volver a la pista anterior.", "SPOTIFY_CONTROL_UNAVAILABLE"); return; }
                        operation = remote.getPlayerApi().skipPrevious(); break;
                    default: call.reject("El control de Spotify no es válido.", "SPOTIFY_INVALID_COMMAND"); return;
                }
                PendingCommand pending = new PendingCommand(call, operation, generation);
                commands.add(pending); main.postDelayed(pending.timeout, 8000);
                operation.setResultCallback(value -> main.post(() -> pending.finish(null)));
                operation.setErrorCallback(error -> main.post(() -> pending.finish("Spotify no pudo ejecutar el control.")));
            } catch (Exception error) { call.reject("Spotify no pudo ejecutar el control.", "SPOTIFY_COMMAND_FAILED"); }
        });
    }
    private class PendingCommand {
        final PluginCall call; final CallResult<Empty> operation; final int owner; boolean finished;
        final Runnable timeout;
        PendingCommand(PluginCall call, CallResult<Empty> operation, int owner) {
            this.call = call; this.operation = operation; this.owner = owner;
            timeout = () -> { operation.cancel(); finish("El control de Spotify tardó demasiado."); };
        }
        void finish(String error) {
            if (finished) return; finished = true; main.removeCallbacks(timeout); commands.remove(this);
            if (owner != generation || !enabled || !connected()) call.reject("Conexión con Spotify cerrada.", "SPOTIFY_CANCELLED");
            else if (error != null) call.reject(error, "SPOTIFY_COMMAND_FAILED");
            else call.resolve();
        }
    }

    private void updateArtwork(int owned, Track track) {
        String uri = track == null || track.imageUri == null ? "" : track.imageUri.raw;
        if (uri == null || uri.equals(artworkUri)) return;
        artwork = null; artworkUri = uri;
        if (uri.isEmpty() || !connected()) return;
        try {
            remote.getImagesApi().getImage(track.imageUri, Image.Dimension.X_SMALL).setResultCallback(bitmap -> main.post(() -> {
                if (owned != generation || !uri.equals(artworkUri) || !connected() || bitmap == null || bitmap.isRecycled()) return;
                try {
                    int width = bitmap.getWidth(), height = bitmap.getHeight();
                    if (width <= 0 || height <= 0) return;
                    float ratio = Math.min(1f, 128f / Math.max(width, height));
                    Bitmap compact = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), true);
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream(); compact.compress(Bitmap.CompressFormat.JPEG, 75, bytes);
                    if (compact != bitmap) compact.recycle();
                    if (bytes.size() <= 75000) { artwork = "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP); emitState(); }
                } catch (Exception ignored) { /* A missing cover never interrupts navigation. */ }
            })).setErrorCallback(error -> { /* No retry loop or invented cover. */ });
        } catch (Exception ignored) { /* Metadata remains usable without artwork. */ }
    }

    private JSObject snapshot() {
        JSObject state = new JSObject(); boolean live = enabled && connected();
        state.put("connected", live); state.put("updatedAt", updatedAt); state.put("paused", playerState == null || playerState.isPaused);
        state.put("positionMs", playerState == null ? 0 : Math.max(0, playerState.playbackPosition));
        state.put("canSkipNext", live && playerState != null && playerState.playbackRestrictions != null && playerState.playbackRestrictions.canSkipNext);
        state.put("canSkipPrevious", live && playerState != null && playerState.playbackRestrictions != null && playerState.playbackRestrictions.canSkipPrev);
        if (live && playerState != null && playerState.track != null) {
            Track track = playerState.track; JSObject data = new JSObject();
            data.put("name", track.name); data.put("artist", track.artist == null || track.artist.name == null ? "" : track.artist.name);
            data.put("uri", track.uri); data.put("durationMs", Math.max(0, track.duration));
            if (artwork != null) data.put("artwork", artwork);
            state.put("track", data);
        } else state.put("track", JSONObject.NULL);
        return state;
    }
    private void emitState() { if (!destroyed) notifyListeners("playerState", snapshot()); }
    private void rejectConnection(String message, String code) {
        main.removeCallbacks(connectionTimeout);
        PluginCall waiting = pendingConnection; pendingConnection = null;
        if (waiting != null) waiting.reject(message, code);
    }
    private void disconnectInternal() {
        generation++; rejectConnection("Conexión con Spotify cancelada.", "SPOTIFY_CANCELLED");
        for (PendingCommand command : new HashSet<>(commands)) { command.operation.cancel(); command.finish("Conexión cerrada."); }
        if (playerSubscription != null) { playerSubscription.cancel(); playerSubscription = null; }
        if (remote != null) { try { SpotifyAppRemote.disconnect(remote); } catch (Exception ignored) {} remote = null; }
        playerState = null; artwork = null; artworkUri = null; updatedAt = 0; emitState();
    }
    @Override protected void handleOnStop() {
        main.post(() -> { if (pendingConnection == null) disconnectInternal(); });
    }
    @Override protected void handleOnDestroy() {
        main.post(() -> { destroyed = true; enabled = false; disconnectInternal(); });
    }
}
