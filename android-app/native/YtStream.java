package com.rohit.dreamtune.app;

import android.net.Uri;

import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.BaseDataSource;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;

import org.json.JSONArray;
import org.json.JSONObject;
import org.schabi.newpipe.extractor.MediaFormat;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.RequestBody;

/**
 * LIVE STREAMING for the native player (this is what makes a song start in about a second, like YouTube Music).
 *
 * Before: the app downloaded the WHOLE song, then played it. A 1-2 hour podcast needs 40-100 MB, so it never
 * started in time and the app switched to the YouTube web player (which stops in the background).
 *
 * Now: the player is given the address  dtyt://yt/VIDEOID . This class finds the real audio link (fast, ~0.5 s)
 * and hands the player the audio in small pieces, so playback starts after the first few hundred KB and the rest
 * keeps loading while you listen. Seeking works too (a new piece is requested from that spot).
 */
@UnstableApi
final class YtStream {
    private YtStream() { }

    static final String SCHEME = "dtyt";
    static final long LONG_SECONDS = 15 * 60;            // longer than this = "long audio": lowest quality is used
    private static final long FIRST_PIECE = 384L * 1024;  // tiny first request so playback can start at once
    private static final long PIECE = 3L * 1024 * 1024;

    static Uri uriFor(String id) { return Uri.parse(SCHEME + "://yt/" + id); }

    // ------------------------------------------------------------------ finding the audio link

    static final class Link {
        String url, ua;
        long total = -1;
        int lenSec;
        long exp;
    }

    private static final ConcurrentHashMap<String, Link> LINKS = new ConcurrentHashMap<>();
    private static volatile OkHttpClient fast;

    static Link cached(String id) { return LINKS.get(id); }
    static void forget(String id) { LINKS.remove(id); }

    private static final String[][] CLIENTS = {
        { "28", "1.65.10", "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip", "ANDROID_VR" },
        { "28", "1.60.19", "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip", "ANDROID_VR" },
        { "5", "20.10.4", "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)", "IOS" }
    };

    /** the audio link of a video. Cached for 20 minutes. fresh = ignore the cache (the old link stopped working). */
    static Link find(String id, boolean fresh) throws Exception {
        if (!fresh) {
            Link hit = LINKS.get(id);
            if (hit != null && hit.exp > System.currentTimeMillis()) return hit;
        }
        YtAudio.init();
        Link l = null;
        try { l = findFast(id); } catch (Exception e) { /* fall through to NewPipe */ }
        if (l == null) l = findNewPipe(id);
        l.exp = System.currentTimeMillis() + 20 * 60 * 1000L;
        LINKS.put(id, l);
        return l;
    }

    /** Same as find(), but goes straight to NewPipe Extractor: a different kind of link, used when the quick one keeps failing. */
    static Link findAlt(String id) throws Exception {
        YtAudio.init();
        Link l = findNewPipe(id);
        l.exp = System.currentTimeMillis() + 20 * 60 * 1000L;
        LINKS.put(id, l);
        return l;
    }

    /** Asks YouTube the way the phone apps do: one small request, answer in well under a second. */
    private static Link findFast(String id) throws Exception {
        if (fast == null) fast = YtAudio.http.newBuilder().callTimeout(5, TimeUnit.SECONDS).build();
        Exception last = null;
        for (String[] c : CLIENTS) {
            try {
                JSONObject client = new JSONObject().put("clientName", c[3]).put("clientVersion", c[1]).put("hl", "en").put("gl", "IN");
                if ("ANDROID_VR".equals(c[3])) {
                    client.put("deviceMake", "Oculus").put("deviceModel", "Quest 3").put("androidSdkVersion", 32)
                          .put("osName", "Android").put("osVersion", "12L");
                } else {
                    client.put("deviceMake", "Apple").put("deviceModel", "iPhone16,2").put("osName", "iPhone").put("osVersion", "18.3.2.22D82");
                }
                JSONObject body = new JSONObject().put("videoId", id).put("contentCheckOk", true).put("racyCheckOk", true)
                        .put("context", new JSONObject().put("client", client));
                okhttp3.Request req = new okhttp3.Request.Builder()
                        .url("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
                        .header("User-Agent", c[2]).header("X-YouTube-Client-Name", c[0]).header("X-YouTube-Client-Version", c[1])
                        .header("Origin", "https://www.youtube.com")
                        .post(RequestBody.create(body.toString(), MediaType.parse("application/json"))).build();
                String text;
                try (okhttp3.Response r = fast.newCall(req).execute()) {
                    if (!r.isSuccessful() || r.body() == null) { last = new IOException("YouTube HTTP " + r.code()); continue; }
                    text = r.body().string();
                }
                JSONObject d = new JSONObject(text);
                JSONObject ps = d.optJSONObject("playabilityStatus");
                if (ps != null && !"OK".equals(ps.optString("status", "OK"))) { last = new IOException("YouTube says: " + ps.optString("status")); continue; }
                JSONObject sd = d.optJSONObject("streamingData");
                JSONArray fm = sd == null ? null : sd.optJSONArray("adaptiveFormats");
                if (fm == null) { last = new IOException("no formats"); continue; }

                int lenSec = 0;
                JSONObject vd = d.optJSONObject("videoDetails");
                if (vd != null) { try { lenSec = Integer.parseInt(vd.optString("lengthSeconds", "0")); } catch (Exception e) { } }

                ArrayList<JSONObject> list = new ArrayList<>();
                for (int i = 0; i < fm.length(); i++) {
                    JSONObject f = fm.optJSONObject(i);
                    if (f == null) continue;
                    if (!f.optString("mimeType", "").startsWith("audio/mp4")) continue;
                    if (f.optString("url", "").isEmpty()) continue;
                    if (f.optLong("contentLength", 0) <= 0 && !f.optString("contentLength", "").matches("\\d+")) continue;
                    list.add(f);
                }
                if (list.isEmpty()) { last = new IOException("no direct audio link"); continue; }

                JSONObject pick = null;
                if (lenSec > LONG_SECONDS) {
                    // long audio: lowest usable quality = small download, starts fast, never stalls
                    for (JSONObject f : list) {
                        int br = f.optInt("bitrate", 0);
                        if (br > 20000 && (pick == null || br < pick.optInt("bitrate", 0))) pick = f;
                    }
                    if (pick == null) for (JSONObject f : list) if (pick == null || f.optInt("bitrate", 0) < pick.optInt("bitrate", 0)) pick = f;
                } else {
                    for (JSONObject f : list) if (f.optInt("itag", 0) == 140) pick = f;       // 128 kbps AAC
                    if (pick == null) for (JSONObject f : list) if (pick == null || f.optInt("bitrate", 0) > pick.optInt("bitrate", 0)) pick = f;
                }
                Link l = new Link();
                l.url = pick.getString("url");
                l.ua = c[2];
                l.total = Long.parseLong(pick.optString("contentLength", "-1"));
                l.lenSec = lenSec;
                return l;
            } catch (Exception e) { last = e; }
        }
        throw last != null ? last : new IOException("no audio link");
    }

    /** Slower but more thorough: NewPipe Extractor (also solves YouTube's speed-limit puzzle). */
    private static Link findNewPipe(String id) throws Exception {
        StreamInfo info = StreamInfo.getInfo("https://www.youtube.com/watch?v=" + id);
        ArrayList<AudioStream> list = new ArrayList<>();
        for (AudioStream a : info.getAudioStreams()) if (a.getDeliveryMethod() == DeliveryMethod.PROGRESSIVE_HTTP) list.add(a);
        if (list.isEmpty()) throw new Exception("no audio stream found");
        final boolean isLong = info.getDuration() > LONG_SECONDS;
        list.sort((x, y) -> {
            boolean mx = x.getFormat() == MediaFormat.M4A, my = y.getFormat() == MediaFormat.M4A;
            if (mx != my) return mx ? -1 : 1;
            return isLong ? Integer.compare(x.getAverageBitrate(), y.getAverageBitrate())      // long: smallest first
                          : Integer.compare(y.getAverageBitrate(), x.getAverageBitrate());     // song: best first
        });
        AudioStream a = list.get(0);
        if (isLong) for (AudioStream s : list) if (s.getAverageBitrate() > 20 && s.getFormat() == MediaFormat.M4A) { a = s; break; }
        Link l = new Link();
        l.url = a.getContent();
        l.ua = YtAudio.uaFor(l.url);
        l.lenSec = (int) info.getDuration();
        String clen = Uri.parse(l.url).getQueryParameter("clen");
        if (clen != null) { try { l.total = Long.parseLong(clen); } catch (Exception e) { } }
        return l;
    }

    // ------------------------------------------------------------------ the data source ExoPlayer reads from

    static final class Factory implements DataSource.Factory {
        @Override public DataSource createDataSource() { return new Source(); }
    }

    private static final Pattern CR = Pattern.compile("bytes\\s+(\\d+)-(\\d+)/(\\d+|\\*)|bytes\\s+\\*/(\\d+)");

    static final class Source extends BaseDataSource {
        private Uri uri;
        private String id;
        private okhttp3.Response resp;
        private InputStream in;
        private long pos, endPos = Long.MAX_VALUE, total = -1, gotInChunk;
        private boolean eof, opened, firstOfOpen;

        Source() { super(true); }

        @Override
        public long open(DataSpec spec) throws IOException {
            uri = spec.uri;
            id = uri.getLastPathSegment();
            if (id == null || id.isEmpty()) throw new IOException("no video id");
            transferInitializing(spec);
            pos = spec.position; eof = false; total = -1; endPos = Long.MAX_VALUE; firstOfOpen = true;
            openChunk(pos);
            if (spec.length != C.LENGTH_UNSET) endPos = pos + spec.length;
            if (total >= 0) endPos = Math.min(endPos, total);
            opened = true;
            transferStarted(spec);
            return endPos == Long.MAX_VALUE ? C.LENGTH_UNSET : Math.max(0, endPos - pos);
        }

        private void openChunk(long from) throws IOException {
            closeChunk();
            IOException last = null;
            for (int attempt = 0; attempt < 3; attempt++) {
                Link l;
                try {
                    if (attempt >= 2) {                                   // the quick link keeps being refused: try the other kind of link
                        try { l = findAlt(id); } catch (Exception x) { l = find(id, true); }
                    } else l = find(id, attempt > 0);
                }
                catch (Exception e) { throw new IOException("audio link: " + e.getMessage(), e); }
                long tot = total >= 0 ? total : l.total;
                if (tot >= 0 && from >= tot) { eof = true; return; }
                long size = firstOfOpen ? FIRST_PIECE : PIECE;
                long to = from + size - 1;
                if (tot >= 0) to = Math.min(to, tot - 1);
                okhttp3.Request req = new okhttp3.Request.Builder().url(l.url + "&range=" + from + "-" + to)
                        .header("User-Agent", l.ua).header("Range", "bytes=" + from + "-" + to).build();
                okhttp3.Response r = null;
                try {
                    r = YtAudio.http.newCall(req).execute();
                    int code = r.code();
                    if ((code == 200 || code == 206) && r.body() != null) {
                        String h = r.header("Content-Range");
                        long asked = to - from + 1, bodyLen = r.body().contentLength();
                        boolean whole = false;                                       // true = the server ignored the range and sends the whole file
                        if (h != null) {
                            Matcher m = CR.matcher(h);
                            if (m.find()) {
                                String t = m.group(3) != null ? m.group(3) : m.group(4);
                                // With the &range= parameter YouTube reports "end of this piece + 1" as the size of the whole file.
                                // Believing it made the song end after the first piece (about 24 s) -> error -> skipped to the next song,
                                // and made every jump ahead end right away. The size that came WITH THE LINK is the real one.
                                if (t != null && !"*".equals(t) && l.total < 0) {
                                    long ct = Long.parseLong(t);
                                    if (ct != to + 1) total = ct;
                                }
                            }
                        } else if (code == 200) {
                            // 200 without Content-Range: if the body is only as long as the piece we asked for, it IS that piece
                            // (the old code took its length for the size of the whole song, which made every jump ahead end at once)
                            whole = bodyLen <= 0 || bodyLen > asked;
                            if (whole && bodyLen > 0 && l.total < 0) total = bodyLen;
                        }
                        if (l.total >= 0) total = l.total;              // the size YouTube told us with the link
                        InputStream s = r.body().byteStream();
                        if (whole && from > 0) {                                     // skip to where we wanted to be
                            long left = from;
                            while (left > 0) { long k = s.skip(left); if (k <= 0) { if (s.read() < 0) break; k = 1; } left -= k; }
                        }
                        resp = r; in = s; gotInChunk = 0; firstOfOpen = false;
                        return;
                    }
                    if (code == 416) { r.close(); eof = true; return; }
                    last = new IOException("audio server HTTP " + code);
                    r.close();
                } catch (IOException e) {
                    last = e;
                    if (r != null) r.close();
                }
                forget(id);                                                           // link expired / refused: ask for a new one and retry
            }
            throw last != null ? last : new IOException("audio server not reachable");
        }

        private void closeChunk() {
            try { if (in != null) in.close(); } catch (Exception e) { }
            try { if (resp != null) resp.close(); } catch (Exception e) { }
            in = null; resp = null;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (len == 0) return 0;
            for (int guard = 0; guard < 4; guard++) {
                if (eof || pos >= endPos) return C.RESULT_END_OF_INPUT;
                if (in == null) { openChunk(pos); if (eof) return C.RESULT_END_OF_INPUT; }
                int want = (int) Math.min((long) len, endPos - pos);
                int n = in.read(buf, off, want);
                if (n > 0) { pos += n; gotInChunk += n; bytesTransferred(n); return n; }
                closeChunk();                                                         // this piece is finished: next loop asks for the next piece
                if (total >= 0 && pos >= total) return C.RESULT_END_OF_INPUT;
            }
            throw new IOException("audio server sent no data at " + pos);
        }

        @Override public Uri getUri() { return uri; }

        @Override
        public void close() {
            closeChunk();
            if (opened) { opened = false; transferEnded(); }
        }
    }
}
