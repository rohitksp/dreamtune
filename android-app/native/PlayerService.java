package com.rohit.dreamtune.app;

import android.app.PendingIntent;
import android.content.Intent;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/** The real music player. Runs as a foreground media service, so it keeps playing with the screen off,
 *  and shows the lock-screen / notification controls. It does not depend on the WebView at all. */
@androidx.media3.common.util.UnstableApi
public class PlayerService extends MediaSessionService {
    static volatile PlayerService instance;
    ExoPlayer exo;
    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();
        // dtyt://  addresses are streamed live (YtStream); files and phone songs are read normally
        DataSource.Factory data = new DefaultDataSource.Factory(this, new YtStream.Factory());
        // start playing after 0.6 s of audio (default is 2.5 s) and keep a big cushion ahead, so a weak network moment does not stop a long podcast
        DefaultLoadControl load = new DefaultLoadControl.Builder().setBufferDurationsMs(120000, 300000, 600, 2000).build();
        exo = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(data))
                .setLoadControl(load)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)      // also keeps Wi-Fi awake, so a 2-hour podcast keeps loading with the screen off
                .build();

        // show next / previous buttons and tell the web app when they are pressed
        Player wrapped = new ForwardingPlayer(exo) {
            @Override public Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .add(Player.COMMAND_SEEK_TO_NEXT).add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM).add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM).build();
            }
            @Override public boolean isCommandAvailable(int command) { return getAvailableCommands().contains(command); }
            @Override public void seekToNext() { NativePlayer.command("next"); }
            @Override public void seekToNextMediaItem() { NativePlayer.command("next"); }
            @Override public void seekToPrevious() { NativePlayer.command("prev"); }
            @Override public void seekToPreviousMediaItem() { NativePlayer.command("prev"); }
        };
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent open = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, wrapped).setSessionActivity(open).build();
        // IMPORTANT: we start this service ourselves (nobody "binds" to it), so the session must be registered by hand,
        // otherwise Android never shows the notification / lock-screen player.
        addSession(session);

        exo.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                NativePlayer.snapshot(exo);
                if (state == Player.STATE_ENDED) NativePlayer.onEnded();
            }
            @Override public void onIsPlayingChanged(boolean playing) { NativePlayer.snapshot(exo); }
            @Override public void onPlayerError(PlaybackException error) {
                Throwable c = error.getCause();
                String why = error.getErrorCodeName() + (c != null && c.getMessage() != null ? ": " + c.getMessage() : "");
                NativePlayer.onError(why.length() > 90 ? why.substring(0, 90) : why);
            }
        });
        instance = this;
        NativePlayer.startTicker();
    }

    @Nullable @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) { return session; }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // app swiped away from recents: keep going only if music is actually playing
        if (exo == null || !exo.getPlayWhenReady() || exo.getMediaItemCount() == 0) stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        try { if (session != null) session.release(); } catch (Exception e) { }
        try { if (exo != null) exo.release(); } catch (Exception e) { }
        session = null; exo = null;
        super.onDestroy();
    }
}
