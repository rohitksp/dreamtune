package com.rohit.dreamtune.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.media.MediaScannerConnection;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.io.InputStream;
import androidx.core.content.FileProvider;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "KeepAlive", permissions = {
    @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
    @Permission(alias = "storage", strings = { "android.permission.WRITE_EXTERNAL_STORAGE" })
})
public class KeepAlivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), KeepAliveService.class);
            i.putExtra("title", call.getString("title", "DreamTune"));
            i.putExtra("text", call.getString("text", "Playing"));
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try { getContext().stopService(new Intent(getContext(), KeepAliveService.class)); } catch (Exception e) { }
        call.resolve();
    }

    @PluginMethod
    public void askNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notifDone");
        } else {
            call.resolve();
        }
    }

    @PermissionCallback
    private void notifDone(PluginCall call) { call.resolve(); }

    @PluginMethod
    public void batteryExempt(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (Build.VERSION.SDK_INT >= 23 && !pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            call.resolve();
        } catch (Exception e) {
            call.resolve();
        }
    }

    /* ---------- save a downloaded song into the phone's Music/DreamTune folder ---------- */
    private Uri saveUri;
    private File saveFile;
    private OutputStream saveOut;

    @PluginMethod
    public void askStorage(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageDone");
        } else {
            call.resolve();
        }
    }

    @PermissionCallback
    private void storageDone(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) call.reject("storage permission denied");
        else call.resolve();
    }

    private void abortSave() {
        try { if (saveOut != null) saveOut.close(); } catch (Exception e) { }
        try {
            if (saveUri != null) getContext().getContentResolver().delete(saveUri, null, null);
            if (saveFile != null) saveFile.delete();
        } catch (Exception e) { }
        saveOut = null; saveUri = null; saveFile = null;
    }

    private void openSave(String name, String mime, String title, String artist) throws Exception {
        saveOut = null; saveUri = null; saveFile = null;
        ContentResolver cr = getContext().getContentResolver();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Audio.Media.DISPLAY_NAME, name);
            v.put(MediaStore.Audio.Media.MIME_TYPE, mime);
            v.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/DreamTune");
            if (title != null) v.put(MediaStore.Audio.Media.TITLE, title);
            if (artist != null) v.put(MediaStore.Audio.Media.ARTIST, artist);
            v.put(MediaStore.Audio.Media.IS_MUSIC, 1);
            v.put(MediaStore.Audio.Media.IS_PENDING, 1);
            saveUri = cr.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, v);
            if (saveUri == null) throw new Exception("could not create the file");
            saveOut = cr.openOutputStream(saveUri);
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "DreamTune");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("could not create the Music/DreamTune folder");
            saveFile = new File(dir, name);
            saveOut = new FileOutputStream(saveFile);
        }
    }

    private void finishSave() throws Exception {
        saveOut.flush(); saveOut.close(); saveOut = null;
        if (saveUri != null) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Audio.Media.IS_PENDING, 0);
            getContext().getContentResolver().update(saveUri, v, null, null);
        } else if (saveFile != null) {
            MediaScannerConnection.scanFile(getContext(), new String[]{ saveFile.getAbsolutePath() }, new String[]{ "audio/mp4" }, null);
        }
    }

    @PluginMethod
    public void saveAudio(PluginCall call) {
        try {
            boolean first = Boolean.TRUE.equals(call.getBoolean("first", false));
            boolean last = Boolean.TRUE.equals(call.getBoolean("last", false));
            if (first) {
                abortSave();
                openSave(call.getString("name", "song.m4a"), call.getString("mime", "audio/mp4"), call.getString("title"), call.getString("artist"));
            }
            if (saveOut == null) { call.reject("no save in progress"); return; }
            String data = call.getString("data", "");
            if (data.length() > 0) saveOut.write(Base64.decode(data, Base64.DEFAULT));
            if (last) {
                finishSave();
                JSObject r = new JSObject();
                r.put("path", "Music/DreamTune/" + call.getString("name", "song.m4a"));
                call.resolve(r);
            } else {
                call.resolve();
            }
        } catch (Exception e) {
            abortSave();
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    /* ---------- native player controls (ExoPlayer in PlayerService) ---------- */
    private static NativePlayer.Meta meta(PluginCall call) {
        NativePlayer.Meta m = new NativePlayer.Meta();
        m.id = call.getString("id", "");
        m.uri = call.getString("uri", "");
        m.title = call.getString("title", "DreamTune");
        m.artist = call.getString("artist", "");
        m.thumb = call.getString("thumb", "");
        return m;
    }

    @PluginMethod
    public void nPlay(final PluginCall call) {
        NativePlayer.Meta m = meta(call);
        if (m.id.isEmpty()) { call.reject("no id"); return; }
        NativePlayer.play(getContext(), m, (ok, err) -> { if (ok) call.resolve(); else call.reject(err); });
    }

    @PluginMethod public void nSetNext(PluginCall call) { NativePlayer.setNext(getContext(), meta(call)); call.resolve(); }
    @PluginMethod public void nWarm(PluginCall call) { NativePlayer.warm(getContext()); call.resolve(); }
    @PluginMethod public void nPause(PluginCall call) { NativePlayer.withPlayer(p -> p.pause()); call.resolve(); }
    @PluginMethod public void nResume(PluginCall call) { NativePlayer.withPlayer(p -> p.play()); call.resolve(); }
    @PluginMethod public void nStop(PluginCall call) { NativePlayer.stop(); call.resolve(); }

    @PluginMethod
    public void nSeek(PluginCall call) {
        final long ms = (long) (call.getDouble("ms", 0.0) + 0.5);
        NativePlayer.withPlayer(p -> p.seekTo(ms));
        call.resolve();
    }

    @PluginMethod
    public void nSpeed(PluginCall call) {
        Double v = call.getDouble("speed", 1.0);
        NativePlayer.speed(v == null ? 1f : v.floatValue());
        call.resolve();
    }

    @PluginMethod
    public void nVolume(PluginCall call) {
        Double v = call.getDouble("v", 1.0);
        final float f = v == null ? 1f : v.floatValue();
        NativePlayer.withPlayer(p -> p.setVolume(f));
        call.resolve();
    }

    @PluginMethod
    public void nState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("id", NativePlayer.curId);
        r.put("playing", NativePlayer.playing);
        r.put("st", NativePlayer.st);
        r.put("pos", NativePlayer.pos);
        r.put("dur", NativePlayer.dur);
        r.put("advSeq", NativePlayer.advSeq);
        r.put("cmdSeq", NativePlayer.cmdSeq);
        r.put("cmd", NativePlayer.cmd);
        r.put("err", NativePlayer.lastErr);
        call.resolve(r);
    }

    /* ---------- downloads with live progress ----------
       nDownload starts the job and answers at once. The web app then asks nDlState every half second
       and shows 1%, 2% ... 100% (also for 1-2 hour podcasts, which download in the background). */
    static final class Job {
        volatile String state = "run";          // run | done | error
        volatile long done = 0, total = -1;
        volatile int phase = 0;                  // 0 = downloading, 1 = copying into Music/DreamTune
        volatile String uri = "", err = "";
        volatile boolean cancel = false;
    }
    private static final java.util.concurrent.ConcurrentHashMap<String, Job> JOBS = new java.util.concurrent.ConcurrentHashMap<>();
    private static final java.util.concurrent.ExecutorService DL_POOL = java.util.concurrent.Executors.newFixedThreadPool(2);

    @PluginMethod
    public void nDownload(final PluginCall call) {
        final NativePlayer.Meta m = meta(call);
        if (m.id.isEmpty()) { call.reject("no id"); return; }
        Job old = JOBS.get(m.id);
        if (old != null && "run".equals(old.state)) {            // already running: just keep watching it
            JSObject r = new JSObject(); r.put("started", true); call.resolve(r); return;
        }
        final Job job = new Job();
        JOBS.put(m.id, job);
        DL_POOL.execute(() -> {
            try {
                File f = YtAudio.ensureFile(getContext(), m.id, () -> job.cancel, (done, total) -> { job.done = done; job.total = total; });
                if (job.cancel) throw new Exception("cancelled");
                job.phase = 1;
                String name = m.title.replaceAll("[\\\\/:*?\"<>|]", " ").trim();
                if (m.artist != null && !m.artist.isEmpty()) name += " - " + m.artist.replaceAll("[\\\\/:*?\"<>|]", " ").trim();
                if (name.length() > 90) name = name.substring(0, 90);
                job.uri = copyToMusic(f, name + ".m4a", m.title, m.artist);
                job.state = "done";
            } catch (Exception e) {
                job.err = String.valueOf(e.getMessage());
                job.state = "error";
            }
        });
        JSObject r = new JSObject(); r.put("started", true);
        call.resolve(r);
    }

    @PluginMethod
    public void nDlState(PluginCall call) {
        Job j = JOBS.get(call.getString("id", ""));
        JSObject r = new JSObject();
        if (j == null) { r.put("state", "none"); call.resolve(r); return; }
        r.put("state", j.state);
        r.put("done", j.done);
        r.put("total", j.total);
        int pct = j.total > 0 ? (int) Math.min(100, j.done * 100 / j.total) : 0;
        if (j.phase == 1) pct = 100;
        r.put("pct", pct);
        r.put("phase", j.phase);
        r.put("uri", j.uri);
        r.put("err", j.err);
        call.resolve(r);
        if (!"run".equals(j.state)) JOBS.remove(call.getString("id", ""), j);      // result delivered
    }

    @PluginMethod
    public void nDlCancel(PluginCall call) {
        Job j = JOBS.get(call.getString("id", ""));
        if (j != null) j.cancel = true;
        call.resolve();
    }

    /* ---------- update the app from inside the app (no browser, no GitHub page) ----------
       nUpdateStart downloads the new APK in the background, nUpdateState reports the percentage,
       nUpdateInstall opens Android's installer for it. Your data stays (same signing key). */
    private static volatile Job updJob = null;
    private File updFile() { File d = new File(getContext().getCacheDir(), "update"); d.mkdirs(); return new File(d, "DreamTune.apk"); }

    @PluginMethod
    public void nUpdateStart(final PluginCall call) {
        final String url = call.getString("url", "");
        if (url.isEmpty()) { call.reject("no url"); return; }
        Job old = updJob;
        if (old != null && "run".equals(old.state)) { call.resolve(); return; }
        final Job job = new Job();
        updJob = job;
        DL_POOL.execute(() -> {
            File out = updFile();
            File tmp = new File(out.getParentFile(), "DreamTune.apk.part");
            try {
                YtAudio.init();
                okhttp3.OkHttpClient c = YtAudio.http.newBuilder().readTimeout(60, java.util.concurrent.TimeUnit.SECONDS).build();
                okhttp3.Request rq = new okhttp3.Request.Builder().url(url).header("User-Agent", "DreamTune-Updater").build();
                long len;
                try (okhttp3.Response r = c.newCall(rq).execute()) {
                    if (!r.isSuccessful() || r.body() == null) throw new Exception("download HTTP " + r.code() + " - is the new APK published yet?");
                    len = r.body().contentLength();
                    job.total = len;
                    try (InputStream in = r.body().byteStream(); java.io.FileOutputStream o = new java.io.FileOutputStream(tmp)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (job.cancel) throw new Exception("cancelled");
                            o.write(buf, 0, n);
                            job.done += n;
                        }
                    }
                }
                if (len > 0 && tmp.length() != len) throw new Exception("update file incomplete");
                if (tmp.length() < 1024 * 1024) throw new Exception("update file is not an app");
                out.delete();
                if (!tmp.renameTo(out)) throw new Exception("could not save the update");
                job.state = "done";
            } catch (Exception e) {
                tmp.delete();
                job.err = String.valueOf(e.getMessage());
                job.state = "error";
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void nUpdateState(PluginCall call) {
        Job j = updJob;
        JSObject r = new JSObject();
        if (j == null) { r.put("state", updFile().exists() ? "done" : "none"); call.resolve(r); return; }
        r.put("state", j.state);
        r.put("pct", j.total > 0 ? (int) Math.min(100, j.done * 100 / j.total) : 0);
        r.put("err", j.err);
        call.resolve(r);
    }

    @PluginMethod
    public void nUpdateInstall(PluginCall call) {
        try {
            File apk = updFile();
            if (!apk.exists()) { call.reject("update file missing"); return; }
            Context ctx = getContext();
            JSObject r = new JSObject();
            if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
                // Android asks once: "allow DreamTune to install apps"
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(s);
                r.put("needPermission", true);
                call.resolve(r);
                return;
            }
            Uri u = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(u, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            r.put("needPermission", false);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }


    private synchronized String copyToMusic(File src, String name, String title, String artist) throws Exception {
        try {
            openSave(name, "audio/mp4", title, artist);
            try (FileInputStream in = new FileInputStream(src)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) saveOut.write(buf, 0, n);
            }
            String uri = saveUri != null ? saveUri.toString() : Uri.fromFile(saveFile).toString();
            finishSave();
            return uri;
        } catch (Exception e) {
            abortSave();
            throw e;
        }
    }
}
