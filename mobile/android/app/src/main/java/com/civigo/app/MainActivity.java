package com.civigo.app;

import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.SharedPreferences;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private boolean recoveringRenderer;
    private boolean resumed;
    private boolean recoveryPending;

    @Override
    public void onResume() {
        super.onResume();
        resumed = true;
        if (recoveryPending) {
            recoveryPending = false;
            scheduleVisibleRecovery();
        }
    }

    @Override
    public void onPause() {
        resumed = false;
        super.onPause();
    }

    private void scheduleVisibleRecovery() {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (resumed) recreate();
            else recoveryPending = true;
        });
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NavigationVoicePlugin.class);
        registerPlugin(SpotifyRemotePlugin.class);
        registerPlugin(SpeechSearchPlugin.class);
        registerPlugin(SystemChromePlugin.class);
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) recoverRenderer(view, detail.didCrash());
                return true;
            }
        });
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
                if (manager != null) for (ApplicationExitInfo exit : manager.getHistoricalProcessExitReasons(getPackageName(), 0, 3)) {
                    Log.i("CiviGoRecovery", "previous_exit reason=" + exit.getReason() + " pssKb=" + exit.getPss() + " timestamp=" + exit.getTimestamp());
                }
            } catch (RuntimeException error) { Log.w("CiviGoRecovery", "exit_diagnostics_unavailable"); }
        }
    }

    /** A dead renderer must never be reused, nor recreated in an endless loop. */
    private void recoverRenderer(WebView deadView, boolean crashed) {
        if (recoveringRenderer || isFinishing() || isDestroyed()) return;
        recoveringRenderer = true;
        Log.w("CiviGoRecovery", "renderer_gone crashed=" + crashed);
        Bridge previousBridge = bridge;
        bridge = null; // Later Activity callbacks cannot call the dead WebView.
        if (deadView.getParent() instanceof ViewGroup) ((ViewGroup) deadView.getParent()).removeView(deadView);
        if (previousBridge != null) {
            try { previousBridge.onDestroy(); }
            catch (RuntimeException error) { Log.w("CiviGoRecovery", "renderer_cleanup_failed " + error.getClass().getSimpleName()); }
        }
        try { deadView.destroy(); }
        catch (RuntimeException error) { Log.w("CiviGoRecovery", "renderer_dispose_failed " + error.getClass().getSimpleName()); }

        SharedPreferences recovery = getSharedPreferences("civigo_renderer_recovery", MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long previous = recovery.getLong("attemptAt", 0);
        recovery.edit().putLong("attemptAt", now).apply();
        if (now - previous >= 60_000L) {
            scheduleVisibleRecovery();
            return;
        }
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        TextView message = new TextView(this);
        message.setText("CiviGo necesita recuperar el mapa. Tu último recorrido guardado se recuperará al abrir de nuevo.");
        message.setTextSize(18);
        panel.addView(message);
        Button retry = new Button(this);
        retry.setText("Reabrir CiviGo");
        retry.setOnClickListener(view -> { recovery.edit().remove("attemptAt").apply(); recreate(); });
        panel.addView(retry);
        setContentView(panel);
    }
}
