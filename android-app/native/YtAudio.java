package com.rohit.dreamtune.app;

import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
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

    /** direct audio link (m4a preferred) */
    static String audioUrl(String id) throws Exception {
        init();
        StreamInfo info = StreamInfo.getInfo("https://www.youtube.com/watch?v=" + id);
        AudioStream best = null;
        for (AudioStream a : info.getAudioStreams()) {
            if (a.getDeliveryMethod() != DeliveryMethod.PROGRESSIVE_HTTP) continue;
            boolean m4a = a.getFormat() == MediaFormat.M4A;
            boolean bestM4a = best != null && best.getFormat() == MediaFormat.M4A;
            if (best == null || (m4a && !bestM4a) || (m4a == bestM4a && a.getAverageBitrate() > best.getAverageBitrate())) best = a;
        }
        if (best == null) throw new Exception("no audio stream found");
        return best.getContent();
    }

    static File ensureFile(Context c, String id, BooleanSupplier cancelled) throws Exception {
        File dir = new File(c.getCacheDir(), "yt");
        if (!dir.exists()) dir.mkdirs();
        File f = new File(dir, id + ".m4a");
        if (f.exists() && f.length() > 0) { f.setLastModified(System.currentTimeMillis()); return f; }

        String url = audioUrl(id);
        String ua = uaFor(url);
        File tmp = new File(dir, id + ".part");
        long start = 0, total = -1;
        String clen = Uri.parse(url).getQueryParameter("clen");
        if (clen != null) { try { total = Long.parseLong(clen); } catch (Exception e) { } }

        try (FileOutputStream out = new FileOutputStream(tmp)) {
            while (total < 0 || start < total) {
                if (cancelled != null && cancelled.getAsBoolean()) throw new Exception("cancelled");
                long end = start + CHUNK - 1;
                okhttp3.Request req = new okhttp3.Request.Builder().url(url + "&range=" + start + "-" + end)
                        .header("User-Agent", ua).header("Range", "bytes=" + start + "-" + end).build();
                try (okhttp3.Response r = http.newCall(req).execute()) {
                    if (r.code() != 200 && r.code() != 206) throw new IOException("audio server HTTP " + r.code());
                    String cr = r.header("Content-Range");
                    if (cr != null && cr.contains("/")) {
                        try { total = Long.parseLong(cr.substring(cr.indexOf('/') + 1).trim()); } catch (Exception e) { }
                    }
                    byte[] data = r.body() != null ? r.body().bytes() : new byte[0];
                    if (data.length == 0) throw new IOException("empty chunk");
                    out.write(data);
                    start += data.length;
                    if (total < 0 && data.length < CHUNK) total = start;
                    if (data.length > CHUNK) total = start;        // server ignored the range and sent everything
                }
            }
        } catch (Exception e) {
            tmp.delete();
            throw e;
        }
        if (!tmp.renameTo(f)) { tmp.delete(); throw new IOException("could not save the audio file"); }
        trim(dir);
        return f;
    }

    private static void trim(File dir) {
        try {
            File[] fs = dir.listFiles((d, n) -> n.endsWith(".m4a"));
            if (fs == null || fs.length <= KEEP_FILES) return;
            java.util.Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (int i = 0; i < fs.length - KEEP_FILES; i++) fs[i].delete();
        } catch (Exception e) { }
    }
}
