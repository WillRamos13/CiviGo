package com.civigo.app;

import android.app.Activity;
import android.graphics.Color;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Keep the current window and the theme restored by Android's splash in agreement. */
@CapacitorPlugin(name = "SystemChrome")
public class SystemChromePlugin extends Plugin {
    @PluginMethod
    public void setTheme(PluginCall call) {
        final Boolean dark = call.getBoolean("dark");
        if (dark == null) { call.reject("Theme must provide a boolean dark value.", "CHROME_INVALID"); return; }
        final Activity activity = getActivity();
        if (activity == null) { call.reject("Activity unavailable.", "CHROME_UNAVAILABLE"); return; }
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Activity unavailable.", "CHROME_UNAVAILABLE"); return;
            }
            try {
                // AndroidX's splash exit reapplies these attributes from activity.theme.
                // Only merge chrome attributes; never replace app theme or global night mode.
                activity.getTheme().applyStyle(dark ? R.style.CiviGoSystemChromeDark : R.style.CiviGoSystemChromeLight, true);
                Window window = activity.getWindow();
                window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
                window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                window.setStatusBarColor(Color.parseColor(dark ? "#091320" : "#f5f8fe"));
                WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightStatusBars(!dark);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Unable to apply system chrome theme.", "CHROME_FAILED");
            }
        });
    }
}
