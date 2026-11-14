package com.rohit.dreamtune.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
        try {
            WebSettings s = getBridge().getWebView().getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);   // let the next song start by itself with the screen off
            s.setUserAgentString(s.getUserAgentString() + " DreamTuneApp/4");   // the number is set automatically by the build (scripts/patch-android.js) and written to public/version.json
        } catch (Exception e) { }

        // Back button / swipe-back: the web app decides (close a sheet, go to the previous page, or "press again to exit")
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                try {
                    getBridge().getWebView().evaluateJavascript(
                        "(function(){try{return window.__dtBack?window.__dtBack():'none'}catch(e){return 'none'}})()",
                        new android.webkit.ValueCallback<String>() {
                            @Override public void onReceiveValue(String value) {
                                String v = value == null ? "" : value;
                                if (v.contains("handled")) return;
                                if (v.contains("hide")) { moveTaskToBack(true); return; }     // music is playing: keep it going in the background
                                finish();
                            }
                        });
                } catch (Exception e) { finish(); }
            }
        });
    }

    // Android calls WebView.onPause() when the screen turns off / the app is hidden, which silences <audio>
    // and freezes JavaScript timers (so the next song never starts). Undo that while we are in the background.
    private void keepWebAlive() {
        try {
            WebView w = getBridge().getWebView();
            w.onResume();
            w.resumeTimers();
        } catch (Exception e) { }
    }

    @Override public void onPause() { super.onPause(); keepWebAlive(); }
    @Override public void onStop()  { super.onStop();  keepWebAlive(); }
}
