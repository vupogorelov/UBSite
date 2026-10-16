package ubsite.app;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.io.Writer;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * The app's own part of the journal (web/src/lib/log.js): what the page cannot see — the app crashing,
 * why the system closed it last time (Android 11+: a crash, "not responding", low memory, killed to save
 * the battery…), the player service, the speech engines' errors. Kept in a file (it survives a crash)
 * until the page takes it (Bridge.takeLog) and sends it with its own events.
 */
final class NativeLog {
    private static File file;
    private static final SimpleDateFormat ISO = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);

    static {
        ISO.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    private NativeLog() {
    }

    /** Called once when the app starts: crashes are written down, last time's ending is looked up. */
    static void install(Context context) {
        Context app = context.getApplicationContext();
        file = new File(app.getFilesDir(), "journal.jsonl");
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, e) -> {
            StringWriter stack = new StringWriter();
            e.printStackTrace(new PrintWriter(stack));
            String text = stack.toString();
            add("error", "Приложение упало: " + e, "thread", thread.getName(), "stack", text.substring(0, Math.min(3000, text.length())));
            if (previous != null) previous.uncaughtException(thread, e);
        });
        if (Build.VERSION.SDK_INT >= 30) lastExits(app);
    }

    /** Why the system ended the app's process before (each ending told once). */
    private static void lastExits(Context app) {
        try {
            ActivityManager am = app.getSystemService(ActivityManager.class);
            List<ApplicationExitInfo> exits = am.getHistoricalProcessExitReasons(app.getPackageName(), 0, 5);
            SharedPreferences prefs = app.getSharedPreferences("journal", Context.MODE_PRIVATE);
            long seen = prefs.getLong("exitSeen", 0);
            long newest = seen;
            for (int i = exits.size() - 1; i >= 0; i--) {
                ApplicationExitInfo x = exits.get(i);
                if (x.getTimestamp() <= seen) continue;
                newest = Math.max(newest, x.getTimestamp());
                int r = x.getReason();
                String level = r == ApplicationExitInfo.REASON_CRASH || r == ApplicationExitInfo.REASON_CRASH_NATIVE || r == ApplicationExitInfo.REASON_ANR
                        ? "error"
                        : r == ApplicationExitInfo.REASON_EXIT_SELF || r == ApplicationExitInfo.REASON_USER_REQUESTED || r == ApplicationExitInfo.REASON_PACKAGE_UPDATED
                        ? "info" : "warn";
                addAt(x.getTimestamp(), level, "Приложение закрыто: " + reason(r),
                        "description", String.valueOf(x.getDescription()), "importance", String.valueOf(x.getImportance()),
                        "memoryKb", String.valueOf(x.getPss()));
            }
            if (newest > seen) prefs.edit().putLong("exitSeen", newest).apply();
        } catch (Exception e) {
            Log.w("ubsite", "exit reasons", e);
        }
    }

    private static String reason(int r) {
        switch (r) {
            case ApplicationExitInfo.REASON_EXIT_SELF: return "само (обычный выход)";
            case ApplicationExitInfo.REASON_SIGNALED: return "остановлено системой (сигнал)";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "не хватило памяти";
            case ApplicationExitInfo.REASON_CRASH: return "упало";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "упало (системная часть)";
            case ApplicationExitInfo.REASON_ANR: return "не отвечало";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "не запустилось";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE: return "изменились разрешения";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "слишком много ресурсов";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "остановлено человеком";
            case ApplicationExitInfo.REASON_USER_STOPPED: return "смахнуто или остановлено в настройках";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "остановилась часть системы";
            case ApplicationExitInfo.REASON_OTHER: return "закрыто системой (часто — ради батареи)";
            default: return "причина " + r;
        }
    }

    /** An event now: level, name, then pairs key, value. */
    static void add(String level, String name, String... kv) {
        addAt(System.currentTimeMillis(), level, name, kv);
    }

    private static synchronized void addAt(long at, String level, String name, String... kv) {
        if (file == null) return;
        try {
            JSONObject data = new JSONObject();
            for (int i = 0; i + 1 < kv.length; i += 2) data.put(kv[i], kv[i + 1]);
            JSONObject e = new JSONObject().put("at", ISO.format(new Date(at))).put("level", level).put("name", name).put("data", data);
            // (FileOutputStream + OutputStreamWriter: FileWriter with a charset is Android 13+ only)
            try (Writer w = new OutputStreamWriter(new FileOutputStream(file, true), StandardCharsets.UTF_8)) {
                w.write(e.toString());
                w.write('\n');
            }
        } catch (Exception ignored) {
        }
    }

    /** All events written since the page took them last, as a JSON array; the file starts over. */
    static synchronized String take() {
        JSONArray out = new JSONArray();
        if (file == null || !file.exists()) return out.toString();
        try {
            for (String line : Files.readAllLines(file.toPath(), StandardCharsets.UTF_8)) {
                if (line.isEmpty()) continue;
                try {
                    out.put(new JSONObject(line));
                } catch (Exception ignored) {
                }
            }
            file.delete();
        } catch (Exception ignored) {
        }
        return out.toString();
    }
}
