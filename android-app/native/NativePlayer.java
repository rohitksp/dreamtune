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
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.File;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Glue between the web app (through KeepAlivePlugin) and the native player. */
@androidx.media3.common.util.UnstableApi
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
        if (m == null || s == null || s.exo == null || retry >= 3) { giveUp(); return; }
        final int attempt = ++retry, my = token;
        final long at = Math.max(0, s.exo.getCurrentPosition());
        // how long is this audio? (long podcasts are never downloaded as a whole file, they are only re-streamed)
        YtStream.Link old = YtStream.cached(m.id);
        final boolean longAudio = old != null && old.lenSec > YtStream.LONG_SECONDS;
        pool.execute(() -> {
            try {
                YtStream.forget(m.id);                                  // the link may have expired: ask for a new one
                Uri src;
                if (attempt == 3 && !longAudio) {                       // last try for a normal song: download the whole file
                    new File(new File(s.getCacheDir(), "yt"), m.id + ".m4a").delete();
                    src = Uri.fromFile(YtAudio.ensureFile(s, m.id, () -> token != my));
                } else {
                    src = longAudio ? sourceFor(s, m) : localOrStream(s, m, () -> token != my);
                }
                m.src = src;
                final Uri fsrc = src;
                main.post(() -> { if (token == my) startItem(fsrc, m, at); });
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

    /** Where to play from. Never waits for a download:
     *  1) a song the user downloaded   2) a complete saved copy   3) live streaming (starts in about a second) */
    private static Uri sourceFor(Context c, Meta m) {
        if (readable(c, m.uri)) return Uri.parse(m.uri);
        File cf = new File(new File(c.getCacheDir(), "yt"), m.id + ".m4a");
        if (cf.exists() && AudioFetch.valid(cf)) { cf.setLastModified(System.currentTimeMillis()); return Uri.fromFile(cf); }
        return YtStream.uriFor(m.id);
    }

    /** Normal songs (under 15 min) are downloaded completely and CHECKED first, then played from that file:
     *  a file never ends early, never goes silent after a jump, and jumping is instant.
     *  Long audio (podcasts) is streamed. If the download does not work, streaming is the fallback. */
    private static Uri localOrStream(Context c, Meta m, java.util.function.BooleanSupplier cancelled) {
        Uri src = sourceFor(c, m);
        if (!YtStream.SCHEME.equals(src.getScheme())) return src;           // already a file / a song you downloaded
        try {
            YtStream.Link l = YtStream.find(m.id, false);
            if (l.lenSec > 0 && l.lenSec <= YtStream.LONG_SECONDS) {
                return Uri.fromFile(YtAudio.ensureFile(c, m.id, cancelled));
            }
        } catch (Exception e) { /* could not get a complete file: stream it instead */ }
        return src;
    }

    private static MediaItem item(Uri src, Meta m) {
        MediaMetadata.Builder md = new MediaMetadata.Builder().setTitle(m.title).setArtist(m.artist);
        if (m.thumb != null && !m.thumb.isEmpty()) { try { md.setArtworkUri(Uri.parse(m.thumb)); } catch (Exception e) { } }
        return new MediaItem.Builder().setUri(src).setMediaId(m.id).setMimeType("audio/mp4").setMediaMetadata(md.build()).build();
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
        next = null; retry = 0; lastErr = "";
        main.post(() -> { PlayerService s = PlayerService.instance; if (s != null && s.exo != null) s.exo.pause(); });
        pool.execute(() -> {
            try {
                if (!ensureService(ctx)) { cb.done(false, "player service did not start"); return; }
                if (token != my) { cb.done(false, "cancelled"); return; }
                cb.done(true, null);                       // answer now: the download below may take a few seconds
                final Uri src = localOrStream(ctx, m, () -> token != my);
                if (token != my) return;
                m.src = src;
                main.post(() -> { if (token == my) startItem(src, m); });
            } catch (Exception e) {
                if (token == my) main.post(() -> giveUp());
            }
        });
    }

    static void setNext(final Context ctx, final Meta m) {
        next = m;
        m.src = sourceFor(ctx, m);
        pool.execute(() -> {
            try {
                if (!YtStream.SCHEME.equals(m.src.getScheme())) return;
                YtStream.Link l = YtStream.find(m.id, false);                // link ready = next song starts at once
                if (l.lenSec > 0 && l.lenSec <= YtStream.LONG_SECONDS) {
                    Uri f = Uri.fromFile(YtAudio.ensureFile(ctx, m.id, () -> next != m));   // the whole next song, checked
                    if (next == m) m.src = f;
                }
            } catch (Exception e) { }
        });
    }

    /** current song finished: if the next one is ready, start it here, even if the web page is asleep */
    static void onEnded() {
        Meta n = next;
        if (n != null && n.src != null) {   // n.src is always set (a stream address needs no waiting)
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

    // ------------------------------------------------------------------ jumping inside a song

    static volatile int seekToken = 0;

    /** how many pieces of audio the audio decoder has played so far (-1 = cannot be read). Done by name, so it can never break the build. */
    private static int rendered(ExoPlayer p) {
        try {
            Object dc = ExoPlayer.class.getMethod("getAudioDecoderCounters").invoke(p);
            if (dc == null) return -1;
            try { dc.getClass().getMethod("ensureUpdated").invoke(dc); } catch (Throwable t) { }
            return dc.getClass().getField("renderedOutputBufferCount").getInt(dc);
        } catch (Throwable t) { return -1; }
    }

    /** load the current song again and carry on from the given spot (a complete saved copy is used if there is one) */
    static void reloadAt(final long at) {
        final Meta m = curMeta;
        final PlayerService s = PlayerService.instance;
        if (m == null || s == null || s.exo == null) return;
        final int my = token;
        pool.execute(() -> {
            try {
                YtStream.forget(m.id);                               // ask for a fresh audio link
                final Uri src = sourceFor(s, m);
                m.src = src;
                main.post(() -> { if (token == my) startItem(src, m, at); });
            } catch (Exception e) { }
        });
    }

    /** Jump to a spot in the song. Afterwards the player is watched: if it is stuck loading, or "plays" but nothing
     *  comes out of the speaker (what happened after jumping far ahead), the song is loaded again from that spot. */
    static void seek(final long ms) {
        final int my = ++seekToken;
        withPlayer(p -> {
            final int before = rendered(p);
            p.seekTo(ms);
            watchSeek(my, ms, before, 0);
        });
    }

    private static void watchSeek(final int my, final long target, final int before, final int round) {
        main.postDelayed(() -> {
            if (seekToken != my) return;                              // you jumped again: that jump has its own watch
            PlayerService s = PlayerService.instance;
            if (s == null || s.exo == null) return;
            ExoPlayer p = s.exo;
            int st = p.getPlaybackState();
            if (st == Player.STATE_ENDED || st == Player.STATE_IDLE || !p.getPlayWhenReady()) return;   // finished, or you paused it
            long at = Math.max(target, Math.max(0, p.getCurrentPosition()));
            boolean stuck = st == Player.STATE_BUFFERING && round >= 1;           // still loading about 8 s after the jump
            boolean silent = false;
            if (st == Player.STATE_READY && p.isPlaying() && before >= 0) {
                int now = rendered(p);
                silent = now >= 0 && now - before < 5;                            // the decoder produced (almost) nothing since the jump
            }
            if (stuck || silent) { reloadAt(at); return; }
            if (round < 2) watchSeek(my, target, before, round + 1);
        }, round == 0 ? 3000 : 5000);
    }
}
