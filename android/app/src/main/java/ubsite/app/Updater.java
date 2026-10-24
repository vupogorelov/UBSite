package ubsite.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The app's own update, as apps from outside a store do it: the newer APK is downloaded here (the page sees
 * how much: "update" events) and handed to the system's installer (PackageInstaller) — it asks to install
 * (the first time also to allow installing from this app), no browser between. The page:
 * window.__ubNative("update", "<percent>" | "install" | "error:<why>").
 */
final class Updater {
    private static volatile boolean busy;

    /** @param url the APK's address (the site's /app/upexplorer.apk) */
    static void start(MainActivity app, String url) {
        if (busy) return;
        busy = true;
        new Thread(() -> {
            try {
                install(app, url);
            } catch (Exception e) {
                NativeLog.add("warn", "Обновление не скачалось: " + e);
                app.runOnUiThread(() -> app.emit("update", "error:" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage())));
            } finally {
                busy = false;
            }
        }, "update").start();
    }

    private static void install(MainActivity app, String url) throws Exception {
        PackageInstaller pi = app.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(app.getPackageName());
        int id = pi.createSession(params);
        try (PackageInstaller.Session session = pi.openSession(id)) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); OutputStream out = session.openWrite("app.apk", 0, total)) {
                byte[] buf = new byte[64 * 1024];
                long done = 0;
                int last = -1;
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (done * 100 / total) : -1;
                    if (pct != last && pct >= 0) {
                        last = pct;
                        final String p = String.valueOf(pct);
                        app.runOnUiThread(() -> app.emit("update", p));
                    }
                }
                session.fsync(out);
            }
            app.runOnUiThread(() -> app.emit("update", "install"));
            Intent done = new Intent(app, Result.class);
            PendingIntent status = PendingIntent.getBroadcast(app, id, done, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(status.getIntentSender());
            NativeLog.add("info", "Обновление скачано — установщик спрашивает");
        } catch (Exception e) {
            pi.abandonSession(id);
            throw e;
        }
    }

    /** The installer's answer: it asks the person (opened here), or it went, or it failed (told to the page). */
    public static final class Result extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent i) {
            int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent ask = i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (ask != null) c.startActivity(ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
            if (status == PackageInstaller.STATUS_SUCCESS) return; // (the app restarts as the new one)
            String why = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            NativeLog.add("warn", "Установка не удалась: " + status + " " + why);
            MainActivity.updateFailed(status == PackageInstaller.STATUS_FAILURE_ABORTED ? "cancelled" : (why == null ? "failed" : why));
        }
    }
}
