package ubsite.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * Reading aloud as a player of the system: while it lasts the app runs in the foreground (Android
 * keeps it alive with the screen off), the notification shade and the lock screen show what is read
 * with ⏮ ▶ ⏭ ✕, and so do headphones' buttons. The buttons go to the page as commands.
 * Started on the first ▶, stopped when the page closes its player (or ✕).
 */
public final class PlayerService extends Service {
    static final String PLAY = "play", PAUSE = "pause", NEXT = "next", PREV = "prev", CLOSE = "close";
    private static final String CHANNEL = "reading";
    private static final int ID = 1;

    /** What the page told last (the service may start after it). */
    static volatile boolean playing;
    static volatile String title = "", album = "";
    private static PlayerService instance;

    private MediaSession session;

    /**
     * The page's state changed: refresh the notification, or start the service — only for reading that
     * goes (a service started and stopped before it shows its notification makes Android close the app).
     */
    static void update(Context c) {
        if (starting) return; // (it shows the state when it starts)
        if (instance != null) instance.refresh();
        else if (playing) {
            starting = true;
            stopWanted = false;
            c.startForegroundService(new Intent(c, PlayerService.class));
        }
    }

    /** Started, but not yet foreground: a stop then waits until it is (stopping earlier closes the app). */
    private static boolean starting, stopWanted;

    /** The notification shows the new text (if reading has started). */
    static void refreshIfRunning() {
        if (instance != null) instance.refresh();
    }

    static void end(Context c) {
        if (starting) stopWanted = true;
        else c.stopService(new Intent(c, PlayerService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
        session = new MediaSession(this, "UBSite");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.command(PLAY); }
            @Override public void onPause() { MainActivity.command(PAUSE); }
            @Override public void onSkipToNext() { MainActivity.command(NEXT); }
            @Override public void onSkipToPrevious() { MainActivity.command(PREV); }
            @Override public void onStop() { MainActivity.command(PAUSE); }
        });
        session.setSessionActivity(openApp());
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // (every start must make the service foreground at once, or Android stops the app)
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, build());
        if (starting) NativeLog.add("info", "Плеер в шторке запущен");
        starting = false;
        if (stopWanted) {
            stopWanted = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        String a = intent != null ? intent.getAction() : null;
        if (a != null) MainActivity.command(a);
        if (CLOSE.equals(a)) stopSelf();
        return START_NOT_STICKY;
    }

    private void refresh() {
        getSystemService(NotificationManager.class).notify(ID, build());
    }

    private Notification build() {
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Urantia Papers Explorer")
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                .build());
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(album)
                .setContentIntent(openApp())
                .setDeleteIntent(action(CLOSE))
                .setOngoing(playing)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(button(android.R.drawable.ic_media_previous, R.string.prev, PREV))
                .addAction(playing
                        ? button(android.R.drawable.ic_media_pause, R.string.pause, PAUSE)
                        : button(android.R.drawable.ic_media_play, R.string.play, PLAY))
                .addAction(button(android.R.drawable.ic_media_next, R.string.next, NEXT))
                .addAction(button(android.R.drawable.ic_menu_close_clear_cancel, R.string.close, CLOSE))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2))
                .build();
    }

    private Notification.Action button(int icon, int label, String action) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), getString(label), action(action)).build();
    }

    private PendingIntent action(String action) {
        Intent i = new Intent(this, PlayerService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** The app was swiped away from the recent apps: the page is gone, reading ends. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        NativeLog.add("info", "Приложение смахнули из недавних — чтение остановлено");
        MainActivity.command(CLOSE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        session.setActive(false);
        session.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
