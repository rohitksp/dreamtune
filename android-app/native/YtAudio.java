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
    private static final long CHUNK = 1L * 1024 * 1024;          // normal pieces (the same size the website route always used)
    private static final long BIG_CHUNK = 3L * 1024 * 1024;      // 2nd try: bigger pieces, but never so big that the phone runs out of memory

    /** progress of a download: bytes saved so far / total bytes (total = -1 when unknown) */
    interface Progress { void on(long done, long total); }
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

    /** direct audio link. pick = 0 normal, 1+ = ask again without the cache (used when a download did not work).
     *  Long audio (over 15 min) automatically gets the lowest quality, so it is small and fast. */
    @androidx.media3.common.util.UnstableApi
    static String audioUrl(String id, int pick) throws Exception {
        return link(id, pick).url;
    }

    /** the audio link WITH the user agent it was made for (YouTube refuses a link that is used with a different one).
     *  pick 0 = normal, 1 = fresh link, 2 = a different kind of link (NewPipe) */
    @androidx.media3.common.util.UnstableApi
    static YtStream.Link link(String id, int pick) throws Exception {
        init();
        if (pick >= 2) {
            try { return YtStream.findAlt(id); } catch (Exception e) { /* fall back to the normal way */ }
        }
        return YtStream.find(id, pick > 0);
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
    static File ensureFile(Context c, String id, BooleanSupplier cancelled) throws Exception { return ensureFile(c, id, cancelled, null); }

    static File ensureFile(Context c, String id, BooleanSupplier cancelled, final Progress progress) throws Exception {
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
            StringBuilder why = new StringBuilder();                // what went wrong on each try (shown to the user, so a failure can be understood)
            for (int attempt = 0; attempt < 3; attempt++) {
                if (cancelled != null && cancelled.getAsBoolean()) throw new Exception("cancelled");
                File tmp = new File(dir, id + "." + attempt + ".part");
                try {
                    YtStream.Link lk = link(id, attempt);        // 2nd try: a fresh link, 3rd try: a different kind of link
                    String url = lk.url;
                    String ua = (lk.ua != null && !lk.ua.isEmpty()) ? lk.ua : uaFor(url);
                    long total = lk.total;
                    if (total < 0) {
                        String clen = Uri.parse(url).getQueryParameter("clen");
                        if (clen != null) { try { total = Long.parseLong(clen); } catch (Exception e) { } }
                    }
                    // 1st and 3rd try: 1 MB pieces. 2nd try: bigger pieces
                    long chunk = attempt == 1 ? BIG_CHUNK : CHUNK;
                    AudioFetch.Source plain = okSource(url, ua);
                    final long hint = total;
                    AudioFetch.Source src = progress == null ? plain : (a, b) -> {
                        AudioFetch.Part p = plain.get(a, b);
                        long all = p.total >= 0 ? p.total : hint;
                        if (p.data != null && p.data.length > 0) progress.on(Math.min(a + p.data.length, all >= 0 ? all : Long.MAX_VALUE), all);
                        return p;
                    };
                    AudioFetch.download(tmp, src, total, chunk, cancelled);
                    if (!tmp.renameTo(f)) throw new IOException("could not save the audio file");
                    if (progress != null) progress.on(f.length(), f.length());
                    trim(dir);
                    return f;
                } catch (Exception e) {
                    last = e;
                    tmp.delete();
                    if ("cancelled".equals(e.getMessage())) throw e;
                    String em = String.valueOf(e.getMessage());
                    if (em.length() > 70) em = em.substring(0, 70);
                    if (why.length() > 0) why.append(" | ");
                    why.append(em);
                }
            }
            throw new IOException(why.length() > 0 ? why.toString() : (last != null ? String.valueOf(last.getMessage()) : "download failed"));
        }
    }

    private static void trim(File dir) {
        try {
            File[] fs = dir.listFiles((d, n) -> n.endsWith(".m4a"));
            File[] parts = dir.listFiles((d, n) -> n.endsWith(".part"));
            if (parts != null) for (File p : parts) if (System.currentTimeMillis() - p.lastModified() > 10 * 60 * 1000) p.delete();
            if (fs == null) return;
            java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            long sum = 0; for (File x : fs) sum += x.length();
            int i = 0;
            // keep at most 40 songs and about 600 MB of saved audio (long podcasts are big)
            while (i < fs.length - 1 && (fs.length - i > KEEP_FILES || sum > 600L * 1024 * 1024)) { sum -= fs[i].length(); fs[i].delete(); i++; }
        } catch (Exception e) { }
    }
}
