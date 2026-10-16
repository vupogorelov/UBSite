package ubsite.app;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;

/**
 * What the page can ask of the app: `window.UBNative` (web/src/lib/native.js). The app answers with
 * events: `window.__ubNative(type, id)`. Methods run on a thread of WebView's: whatever touches the
 * screen goes to the main thread.
 */
final class Bridge {
    private final MainActivity app;

    Bridge(MainActivity app) {
        this.app = app;
    }

    /**
     * The bridge's version: the page can check what it may ask
     * (2: appVersion, downloads go to the browser; 3: takeLog; 4: shareImage).
     */
    @JavascriptInterface
    public int version() {
        return 4;
    }

    /**
     * «Поделиться» a picture the page drew (a quote): a PNG (base64) and the text that goes with it (the
     * link), into the app the person chooses. The file lives in the cache, given out by ShareProvider.
     */
    @JavascriptInterface
    public boolean shareImage(String base64, String name, String text) {
        try {
            String file = (name == null || !name.matches("[A-Za-z0-9._-]{1,80}\\.png")) ? "quote.png" : name;
            File f = new File(ShareProvider.dir(app), file);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(Base64.decode(base64, Base64.DEFAULT));
            }
            Uri uri = Uri.parse("content://" + ShareProvider.AUTHORITY + "/" + file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.setClipData(ClipData.newRawUri("", uri)); // (the chooser's preview, and the permission travels with it)
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, null);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            app.runOnUiThread(() -> app.startActivity(chooser));
            return true;
        } catch (Exception e) {
            NativeLog.add("error", "Не удалось поделиться картинкой", "error", String.valueOf(e));
            return false;
        }
    }

    /** The app's own events for the journal since the last time (NativeLog), as a JSON array. */
    @JavascriptInterface
    public String takeLog() {
        return NativeLog.take();
    }

    /** The installed app's version ("1.3"). */
    @JavascriptInterface
    public String appVersion() {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public String voices() {
        return app.speech.voices();
    }

    @JavascriptInterface
    public void speak(String id, String text, String lang, String voice, double rate, double pitch, double volume) {
        app.speech.speak(id, text, lang, voice == null ? "" : voice, (float) rate, (float) pitch, (float) volume);
    }

    @JavascriptInterface
    public void cancel() {
        app.speech.cancel();
    }

    /** Reading goes (true) or is paused (false): the system player shows it. */
    @JavascriptInterface
    public void player(boolean playing) {
        PlayerService.playing = playing;
        app.runOnUiThread(() -> PlayerService.update(app));
    }

    /** What the system player shows: the sentence being read and the paper. */
    @JavascriptInterface
    public void meta(String title, String album) {
        PlayerService.title = title == null ? "" : title;
        PlayerService.album = album == null ? "" : album;
        app.runOnUiThread(PlayerService::refreshIfRunning);
    }

    /** The page closed its player: the system player goes away. */
    @JavascriptInterface
    public void end() {
        PlayerService.playing = false;
        app.runOnUiThread(() -> PlayerService.end(app));
    }

    /** The colors of the page's top and bottom (CSS colors): the status bar and the navigation bar take them. */
    @JavascriptInterface
    public void bars(String top, String bottom) {
        app.runOnUiThread(() -> app.setBars(top, bottom));
    }

    @JavascriptInterface
    public String server() {
        return app.server();
    }

    @JavascriptInterface
    public void setServer(String url) {
        app.runOnUiThread(() -> app.openServer(url));
    }
}
