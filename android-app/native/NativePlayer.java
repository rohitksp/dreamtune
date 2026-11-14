package com.rohit.dreamtune.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.File;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Glue between the web app (through KeepAlivePlugin) and the native player. */
final class NativePlayer {
    interface Cb { void done(boolean ok, String err); }

    static final Handler main = new Handler(Looper.getMainLooper());
    static final ExecutorService pool = Executors.newFixedThreadPool(3);
    static volatile int token = 0;

    // last known player state, read by the web app
    static volatile String curId = "";
    static volatile boolean playing = false;
    static volatile int st = 1;
    static volatile long pos = 0, dur = 0;
    static volatile int advSeq = 0, cmdSeq = 0;
    static volatile String cmd = "";

    static class Meta { String id, uri, title, artist, thumb; volatile Uri src; }
    static volatile Meta next = null;
    static volatile Meta curMeta = null;
    static volatile int retry = 0;
    static volatile String lastErr = "";

    static void snapshot(ExoPlayer p) {
        try {
            playing = p.isPlaying();
            st = p.getPlaybackState();
            pos = Math.max(0, p.getCurrentPosition());
            long d = p.getDuration();
            dur = d == C.TIME_UNSET ? 0 : d;
        } catch (Exception e) { }
    }

    static void startTicker() {
        main.postDelayed(new Runnable() {
            @Override public void run() {
                PlayerService s = PlayerService.instance;
                if (s == null || s.exo == null) return;
                snapshot(s.exo);
                main.postDelayed(this, 500);
            }
        }, 500);
    }

    static void command(String c) { cmd = c; cmdSeq++; }
    private static void giveUp() { st = 1; playing = false; command("error"); }

    /** playback error (for example after jumping to the middle of a song): reload the song and carry on from the same spot.
     *  1st try: same file. 2nd try: download the file again. Only then give up and let the web app skip. */
    static void onError(String code) {
        lastErr = code == null ? "" : code;
        final Meta m = curMeta;
        final PlayerService s = PlayerService.instance;
        // add what the saved file looks like, so an error message tells us the reason
        boolean bad = false;
        if (m != null && s != null) {
            File cf = new File(new File(s.getCacheDir(), "yt"), m.id + ".m4a");
            if (cf.exists()) { bad = !AudioFetch.valid(cf); lastErr += " [" + (cf.length() / 1024) + " KB" + (bad ? ", incomplete file" : ", file ok") + "]"; }
        }
        if (m == null || s == null || s.exo == null || retry >= 2) { giveUp(); return; }
        final int attempt = ++retry, my = token;
        final boolean redo = bad;
        final long at = Math.max(0, s.exo.getCurrentPosition());
        pool.execute(() -> {
            try {
                if (attempt == 2 || redo) { m.src = null; new File(new File(s.getCacheDir(), "yt"), m.id + ".m4a").delete(); }
                final Uri src = m.src != null ? m.src : resolveSource(s, m, () -> token != my);
                m.src = src;
                main.post(() -> { if (token == my) startItem(src, m, at); });
            } catch (Exception e) {
                main.post(() -> giveUp());
            }
        });
    }

    private static boolean readable(Context c, String uri) {
        if (uri == null || uri.isEmpty()) return false;
        try (InputStream in = c.getContentResolver().openInputStream(Uri.parse(uri))) { return in != null; }
        catch (Exception e) { return false; }
    }

    private static Uri resolveSource(Context c, Meta m, java.util.function.BooleanSupplier cancelled) throws Exception {
        if (readable(c, m.uri)) return Uri.parse(m.uri);
        return Uri.fromFile(YtAudio.ensureFile(c, m.id, cancelled));
    }

    private static MediaItem item(Uri src, Meta m) {
        MediaMetadata.Builder md = new MediaMetadata.Builder().setTitle(m.title).setArtist(m.artist);
        if (m.thumb != null && !m.thumb.isEmpty()) { try { md.setArtworkUri(Uri.parse(m.thumb)); } catch (Exception e) { } }
        return new MediaItem.Builder().setUri(src).setMediaId(m.id).setMediaMetadata(md.build()).build();
    }

    // must run on the main thread
    private static void startItem(Uri src, Meta m) { startItem(src, m, 0); }

    private static void startItem(Uri src, Meta m, long startMs) {
        PlayerService s = PlayerService.instance;
        if (s == null || s.exo == null) return;
        curMeta = m;
        s.exo.setMediaItem(item(src, m), startMs);
        s.exo.prepare();
        s.exo.play();
        curId = m.id; st = 2; playing = false; pos = startMs;
    }

    private static boolean ensureService(Context c) {
        if (PlayerService.instance != null) return true;
        c.startService(new Intent(c, PlayerService.class));
        for (int i = 0; i < 50 && PlayerService.instance == null; i++) {
            try { Thread.sleep(100); } catch (InterruptedException e) { }
        }
        return PlayerService.instance != null;
    }

    static void play(final Context ctx, final Meta m, final Cb cb) {
        final int my = ++token;
        next = null; retry = 0;
        main.post(() -> { PlayerService s = PlayerService.instance; if (s != null && s.exo != null) s.exo.pause(); });
        pool.execute(() -> {
            try {
                Uri src = resolveSource(ctx, m, () -> token != my);
                if (token != my) { cb.done(false, "cancelled"); return; }
                if (!ensureService(ctx)) { cb.done(false, "player service did not start"); return; }
                final Uri fsrc = src;
                m.src = fsrc;
                main.post(() -> { if (token == my) startItem(fsrc, m); });
                cb.done(true, null);
            } catch (Exception e) {
                cb.done(false, String.valueOf(e.getMessage()));
            }
        });
    }

    static void setNext(final Context ctx, final Meta m) {
        next = m;
        pool.execute(() -> {
            try { m.src = resolveSource(ctx, m, () -> next != m); } catch (Exception e) { }
        });
    }

    /** current song finished: if the next one is ready, start it here, even if the web page is asleep */
    static void onEnded() {
        Meta n = next;
        if (n != null && n.src != null) {
            next = null; token++; retry = 0;
            advSeq++;
            startItem(n.src, n);
        }
    }

    static void withPlayer(final java.util.function.Consumer<ExoPlayer> fn) {
        main.post(() -> {
            PlayerService s = PlayerService.instance;
            if (s != null && s.exo != null) { try { fn.accept(s.exo); } catch (Exception e) { } }
        });
    }

    static void stop() {
        token++; next = null;
        withPlayer(p -> { p.stop(); p.clearMediaItems(); });
        st = 1; playing = false;
    }

    static void speed(final float s) { withPlayer(p -> p.setPlaybackParameters(new PlaybackParameters(s, 1f))); }
}
