package com.rohit.dreamtune.app;

import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BooleanSupplier;

import okhttp3.OkHttpClient;
import okhttp3.RequestBody;

import org.schabi.newpipe.extractor.MediaFormat;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;
import org.schabi.newpipe.extractor.localization.Localization;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds the audio link of a YouTube video with NewPipe Extractor (the library behind the NewPipe app)
 * and downloads it into the app cache, so the native player can play it from a local file.
 */
public class YtAudio {
    private static final String FF_UA = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0";
    private static final String IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
    private static final String VR_UA = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
    private static final long CHUNK = 1024 * 1024;
    private static final int KEEP_FILES = 40;

    static OkHttpClient http;
    private static boolean inited = false;

    static synchronized void init() {
        if (inited) return;
        http = new OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(40, TimeUnit.SECONDS).build();
        NewPipe.init(new Dl(), new Localization("en", "IN"));
        inited = true;
    }

    /** NewPipe needs us to provide the HTTP layer. */
    static class Dl extends Downloader {
        @Override
        public org.schabi.newpipe.extractor.downloader.Response execute(org.schabi.newpipe.extractor.downloader.Request request)
                throws IOException, ReCaptchaException {
            okhttp3.Request.Builder b = new okhttp3.Request.Builder().url(request.url());
            boolean hasUa = false;
            for (Map.Entry<String, List<String>> e : request.headers().entrySet()) {
                if ("User-Agent".equalsIgnoreCase(e.getKey())) hasUa = true;
                b.removeHeader(e.getKey());
                for (String v : e.getValue()) b.addHeader(e.getKey(), v);
            }
            if (!hasUa) b.header("User-Agent", FF_UA);
            byte[] data = request.dataToSend();
            String m = request.httpMethod();
            RequestBody body = data != null ? RequestBody.create(data, null) : ("POST".equals(m) ? RequestBody.create(new byte[0], null) : null);
            b.method(m, body);
            try (okhttp3.Response r = http.newCall(b.build()).execute()) {
                if (r.code() == 429) throw new ReCaptchaException("rate limited", request.url());
                String text = r.body() != null ? r.body().string() : "";
                return new org.schabi.newpipe.extractor.downloader.Response(
                        r.code(), r.message(), r.headers().toMultimap(), text, r.request().url().toString());
            }
        }
    }

    static String uaFor(String url) {
        if (url.contains("c=IOS")) return IOS_UA;
        if (url.contains("c=ANDROID_VR") || url.contains("c=ANDROID")) return VR_UA;
        return FF_UA;
    }

    /** direct audio link (m4a preferred). pick = 0 best, 1 next best, ... (used when a download did not work) */
    static String audioUrl(String id, int pick) throws Exception {
        init();
        StreamInfo info = StreamInfo.getInfo("https://www.youtube.com/watch?v=" + id);
        ArrayList<AudioStream> list = new ArrayList<>();
        for (AudioStream a : info.getAudioStreams()) {
            if (a.getDeliveryMethod() == DeliveryMethod.PROGRESSIVE_HTTP) list.add(a);
        }
        if (list.isEmpty()) throw new Exception("no audio stream found");
        // m4a first, then the higher bitrate
        list.sort((x, y) -> {
            boolean mx = x.getFormat() == MediaFormat.M4A, my = y.getFormat() == MediaFormat.M4A;
            if (mx != my) return mx ? -1 : 1;
            return Integer.compare(y.getAverageBitrate(), x.getAverageBitrate());
        });
        return list.get(Math.min(pick, list.size() - 1)).getContent();
    }

    /** the audio server, asked with OkHttp */
    static AudioFetch.Source okSource(final String url, final String ua) {
        final Pattern cr = Pattern.compile("bytes\\s+(\\d+)-(\\d+)/(\\d+|\\*)|bytes\\s+\\*/(\\d+)");
        return (start, end) -> {
            okhttp3.Request req = new okhttp3.Request.Builder().url(url + "&range=" + start + "-" + end)
                    .header("User-Agent", ua).header("Range", "bytes=" + start + "-" + end).build();
            try (okhttp3.Response r = http.newCall(req).execute()) {
                AudioFetch.Part p = new AudioFetch.Part();
                p.code = r.code();
                String h = r.header("Content-Range");
                if (h != null) {
                    Matcher m = cr.matcher(h);
                    if (m.find()) {
                        if (m.group(1) != null) {
                            p.from = Long.parseLong(m.group(1));
                            if (!"*".equals(m.group(3))) p.total = Long.parseLong(m.group(3));
                        } else if (m.group(4) != null) {
                            p.total = Long.parseLong(m.group(4));
                        }
                    }
                }
                if (p.code == 200 || p.code == 206) p.data = r.body() != null ? r.body().bytes() : new byte[0];
                return p;
            }
        };
    }

    private static final ConcurrentHashMap<String, Object> LOCKS = new ConcurrentHashMap<>();

    /**
     * The audio file of a song, downloaded and CHECKED. Only a complete file is ever returned or kept.
     * One download per song at a time (the "next song" preloader and the player used to write the same file together).
     */
    static File ensureFile(Context c, String id, BooleanSupplier cancelled) throws Exception {
        File dir = new File(c.getCacheDir(), "yt");
        if (!dir.exists()) dir.mkdirs();
        File f = new File(dir, id + ".m4a");

        Object lock = LOCKS.computeIfAbsent(id, k -> new Object());
        synchronized (lock) {
            if (f.exists()) {
                if (AudioFetch.valid(f)) { f.setLastModified(System.currentTimeMillis()); return f; }
                f.delete();                                   // a half-saved file from an earlier version: download it again
            }

            Exception last = null;
            for (int attempt = 0; attempt < 3; attempt++) {
                if (cancelled != null && cancelled.getAsBoolean()) throw new Exception("cancelled");
                File tmp = new File(dir, id + "." + attempt + ".part");
                try {
                    String url = audioUrl(id, attempt == 2 ? 1 : 0);        // last try: the next best stream
                    String ua = uaFor(url);
                    long total = -1;
                    String clen = Uri.parse(url).getQueryParameter("clen");
                    if (clen != null) { try { total = Long.parseLong(clen); } catch (Exception e) { } }
                    // 1st try: 1 MB pieces. 2nd and 3rd try: one single big request
                    long chunk = attempt == 0 ? CHUNK : 64L * 1024 * 1024;
                    AudioFetch.download(tmp, okSource(url, ua), total, chunk, cancelled);
                    if (!tmp.renameTo(f)) throw new IOException("could not save the audio file");
                    trim(dir);
                    return f;
                } catch (Exception e) {
                    last = e;
                    tmp.delete();
                    if ("cancelled".equals(e.getMessage())) throw e;
                }
            }
            throw last != null ? last : new IOException("download failed");
        }
    }

    private static void trim(File dir) {
        try {
            File[] fs = dir.listFiles((d, n) -> n.endsWith(".m4a"));
            File[] parts = dir.listFiles((d, n) -> n.endsWith(".part"));
            if (parts != null) for (File p : parts) if (System.currentTimeMillis() - p.lastModified() > 10 * 60 * 1000) p.delete();
            if (fs == null || fs.length <= KEEP_FILES) return;
            java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (int i = 0; i < fs.length - KEEP_FILES; i++) fs[i].delete();
        } catch (Exception e) { }
    }
}
