package com.rohit.dreamtune.app;

import android.os.Bundle;
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
            s.setUserAgentString(s.getUserAgentString() + " DreamTuneApp/3");   // bump together with public/version.json when native code changes
        } catch (Exception e) { }
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
