package com.rohit.dreamtune.app;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.function.BooleanSupplier;

/**
 * Downloads one audio file in pieces and PROVES it is complete before it is used.
 * (No Android code in here on purpose, so it can be tested on a normal computer.)
 *
 * Why: a song that is saved only half-way (for example 2 of 4 minutes) plays fine until the end of the
 * saved part, and then ExoPlayer stops with ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE. Seeking past the saved part
 * gives the same error. The old code decided "the song is over" as soon as one piece came back smaller than
 * asked, and it never checked the finished file.
 */
final class AudioFetch {
    private AudioFetch() { }

    /** one answer from the audio server */
    static final class Part {
        int code;               // HTTP status
        long from = -1;         // first byte of this answer (from Content-Range), -1 = not told
        long total = -1;        // size of the whole file (from Content-Range), -1 = not told
        byte[] data = new byte[0];
    }

    interface Source { Part get(long start, long endInclusive) throws IOException; }

    // ------------------------------------------------------------------ MP4 checks

    /** true if the file starts like an MP4/M4A (ftyp / styp box) */
    static boolean looksMp4(File f) {
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            if (r.length() < 12) return false;
            byte[] h = new byte[8];
            r.readFully(h);
            String t = new String(h, 4, 4, "ISO-8859-1");
            return t.equals("ftyp") || t.equals("styp");
        } catch (Exception e) { return false; }
    }

    /**
     * Walks the top-level boxes of an MP4 and returns how long the file MUST be.
     * equal to the file length -> complete; bigger -> cut off; -2 -> damaged.
     */
    static long mp4Needed(File f) {
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long len = r.length(), pos = 0;
            while (pos + 8 <= len) {
                r.seek(pos);
                long size = r.readInt() & 0xFFFFFFFFL;
                r.readInt();                                   // box type
                if (size == 1) {                                // 64-bit size
                    if (pos + 16 > len) return pos + 16;
                    size = r.readLong();
                } else if (size == 0) {
                    return len;                                 // "until the end of the file"
                }
                if (size < 8) return -2;
                pos += size;
            }
            if (pos == len) return len;
            if (pos > len) return pos;
            return -2;                                          // a few stray bytes after the last box
        } catch (Exception e) { return -2; }
    }

    /** is this saved file whole? (MP4: exact box check; other formats: just not empty) */
    static boolean valid(File f) {
        if (f == null || !f.exists() || f.length() < 1024) return false;
        if (looksMp4(f)) return mp4Needed(f) == f.length();
        return true;
    }

    // ------------------------------------------------------------------ download

    /**
     * Fills tmp (starting from nothing) piece by piece.
     * @param knownTotal size of the whole file if known, otherwise -1
     * @param chunk      piece size asked from the server
     */
    static boolean fill(File tmp, Source src, long knownTotal, long chunk, BooleanSupplier cancelled) throws IOException {
        if (tmp.exists() && !tmp.delete()) throw new IOException("cannot reset the temporary file");
        long total = knownTotal, len = 0;
        boolean confirmed = false;                              // did the SERVER confirm where the file ends?
        try (RandomAccessFile out = new RandomAccessFile(tmp, "rw")) {
            for (int guard = 0; guard < 4000; guard++) {
                if (cancelled != null && cancelled.getAsBoolean()) throw new IOException("cancelled");
                if (total >= 0 && len >= total) break;

                long end = len + chunk - 1;
                if (total >= 0) end = Math.min(end, total - 1);
                long asked = end - len + 1;

                Part p = src.get(len, end);

                if (p.code == 416) {                            // nothing left after this point
                    if (total >= 0 && len < total) throw new IOException("server says the file ends at " + len + " but it should be " + total);
                    confirmed = true;
                    break;
                }
                if (p.code != 200 && p.code != 206) throw new IOException("audio server HTTP " + p.code);
                if (p.total >= 0) { total = p.total; confirmed = true; }
                byte[] d = p.data == null ? new byte[0] : p.data;

                if (p.from >= 0 && p.from != len) throw new IOException("server sent bytes from " + p.from + " instead of " + len);
                if (d.length == 0) {
                    if (total < 0 || len >= total) { confirmed = true; break; }       // end of the file
                    throw new IOException("empty answer at " + len + " of " + total);
                }

                if (d.length > asked) {
                    if (len == 0 && p.code == 200 && p.from < 0) {      // the server ignored the range and sent the whole file
                        out.seek(0); out.write(d); len = d.length; total = len; confirmed = true;
                        break;
                    }
                    if (p.from < 0 && p.code == 200 && len > 0) throw new IOException("server ignored the range at " + len);
                    d = java.util.Arrays.copyOf(d, (int) asked);        // too much: keep only what we asked for
                }
                out.seek(len);
                out.write(d);
                len += d.length;

                // finished? (only trust this when the file really is a whole MP4)
                if (total < 0 && d.length < asked && looksMp4(tmp) && mp4Needed(tmp) == len) { confirmed = true; break; }
            }
        }
        if (total >= 0 && tmp.length() != total) throw new IOException("saved " + tmp.length() + " of " + total + " bytes");
        return confirmed;
    }

    /**
     * Full job: download, then check. If the MP4 says more data is needed than we saved,
     * download exactly that missing part. Throws if the result is still not whole.
     */
    static void download(File tmp, Source src, long knownTotal, long chunk, BooleanSupplier cancelled) throws IOException {
        boolean confirmed = fill(tmp, src, knownTotal, chunk, cancelled);
        if (looksMp4(tmp)) {
            long need = mp4Needed(tmp);
            if (need > tmp.length()) {                          // cut off: the size we were told was too small
                confirmed = fill(tmp, src, need, chunk, cancelled);
                need = mp4Needed(tmp);
            }
            if (need != tmp.length()) throw new IOException("audio file incomplete (" + tmp.length() + " bytes, needs " + need + ")");
            if (!confirmed) {                                   // the length was only a hint: is there really nothing after this?
                Part p = src.get(tmp.length(), tmp.length());
                boolean more = (p.code == 200 || p.code == 206) && p.data != null && p.data.length == 1 && (p.from < 0 || p.from == tmp.length());
                if (more) {                                     // yes there is more: download again, without trusting the hint
                    fill(tmp, src, -1, chunk, cancelled);
                    long n2 = mp4Needed(tmp);
                    if (n2 != tmp.length()) throw new IOException("audio file incomplete (" + tmp.length() + " bytes, needs " + n2 + ")");
                }
            }
        } else if (tmp.length() < 1024) {
            throw new IOException("audio file too small");
        }
    }
}
