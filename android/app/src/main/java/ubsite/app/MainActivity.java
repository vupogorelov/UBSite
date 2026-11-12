package ubsite.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The site in a window of its own (WebView), with the phone's speech synthesis and a system player
 * for reading aloud (Bridge, Speech, PlayerService). The page is never paused here: with the screen
 * off it goes on getting the engine's events and keeps the place read.
 */
public final class MainActivity extends Activity {
    static final String DEFAULT_SERVER = "https://95-31-142-59.broadband.corbina.ru";
    private static final String ACTION_SERVER = "ubsite.app.SERVER";
    private static final String START_PAGE = "file:///android_asset/start.html";

    private static MainActivity instance;

    Speech speech;
    private WebView web;
    private FrameLayout root;
    private View bottomBar;
    private SharedPreferences prefs;

    /** The installer did not install the update (Updater.Result): the page says so. */
    static void updateFailed(String why) {
        MainActivity a = instance;
        if (a != null) a.runOnUiThread(() -> a.emit("update", "error:" + why));
    }

    /** A button of the system player (or headphones) for the page. */
    static void command(String action) {
        MainActivity a = instance;
        if (a != null) a.runOnUiThread(() -> a.emit("cmd", action));
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        NativeLog.install(this); // (first: a crash from here on is written down)
        instance = this;
        prefs = getSharedPreferences("app", MODE_PRIVATE);
        speech = new Speech(this, (type, id) -> runOnUiThread(() -> emit(type, id)));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // (the system player's ▶ starts a recording too)
        s.setUserAgentString(s.getUserAgentString() + " UBSiteApp/1");
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false); // (alive with the screen off)
        web.addJavascriptInterface(new Bridge(this), "UBNative");
        web.setWebViewClient(new Client());
        // A file to save (the app's own APK — "Переустановить приложение"): WebView does not download, the browser does.
        web.setDownloadListener((url, agent, disposition, type, length) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
        });
        CookieManager.getInstance().setAcceptCookie(true);

        root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bottomBar = new View(this);
        root.addView(bottomBar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));
        setContentView(root);
        edgeToEdge();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }

        if (state == null || web.restoreState(state) == null) web.loadUrl(server());
        if (ACTION_SERVER.equals(getIntent().getAction())) askServer();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (ACTION_SERVER.equals(intent.getAction())) askServer();
    }

    // ---- The page ----

    /** An event for the page: `window.__ubNative(type, id)`. */
    void emit(String type, String id) {
        if (web == null) return;
        web.evaluateJavascript("window.__ubNative&&window.__ubNative(" + JSONObject.quote(type) + "," + JSONObject.quote(id) + ")", null);
    }

    private final class Client extends WebViewClient {
        /** Links to other sites open in the browser. */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String host = Uri.parse(server()).getHost();
            if (host != null && host.equalsIgnoreCase(u.getHost())) return false;
            if ("file".equals(u.getScheme())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception ignored) {
            }
            return true;
        }

        /** The site does not open (no network the first time, a wrong address): the start page asks for the address. */
        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame() && !req.getUrl().toString().startsWith("file:")) view.loadUrl(START_PAGE);
        }
    }

    private void back() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // (not closed: reading goes on)
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    // ---- The site's address (it may move: long press on the app's icon → "Адрес сайта") ----

    String server() {
        return prefs.getString("server", DEFAULT_SERVER);
    }

    void openServer(String url) {
        url = url == null ? "" : url.trim();
        if (url.isEmpty()) url = DEFAULT_SERVER;
        if (!url.matches("(?i)^https?://.*")) url = "https://" + url;
        url = url.replaceAll("/+$", "");
        prefs.edit().putString("server", url).apply();
        web.clearHistory();
        web.loadUrl(url);
    }

    private void askServer() {
        EditText field = new EditText(this);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setText(server());
        field.setSelectAllOnFocus(true);
        FrameLayout box = new FrameLayout(this);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(field);
        new AlertDialog.Builder(this)
                .setTitle(R.string.server_title)
                .setView(box)
                .setPositiveButton(R.string.open, (d, w) -> openServer(field.getText().toString()))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    // ---- The system bars: the page goes under them, they take its colors ----

    @SuppressWarnings("deprecation")
    private void edgeToEdge() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        else root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                l = bars.left;
                t = bars.top;
                r = bars.right;
                b = Math.max(bars.bottom, ime.bottom);
            } else {
                l = insets.getSystemWindowInsetLeft();
                t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight();
                b = insets.getSystemWindowInsetBottom();
            }
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
            lp.setMargins(l, t, r, b);
            web.setLayoutParams(lp);
            ViewGroup.LayoutParams bl = bottomBar.getLayoutParams();
            bl.height = b;
            bottomBar.setLayoutParams(bl);
            return WindowInsets.CONSUMED;
        });
    }

    private static final Pattern RGB = Pattern.compile("rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)");

    /** A CSS color ("rgb(…)" from getComputedStyle, or "#rrggbb"), or null. */
    private static Integer parseColor(String css) {
        if (css == null) return null;
        Matcher m = RGB.matcher(css);
        if (m.find()) return Color.rgb(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
        try {
            return Color.parseColor(css.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isLight(int c) {
        return (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) > 150;
    }

    @SuppressWarnings("deprecation")
    void setBars(String top, String bottom) {
        Integer t = parseColor(top), b = parseColor(bottom);
        if (t == null) return;
        if (b == null) b = t;
        root.setBackgroundColor(t);
        bottomBar.setBackgroundColor(b);
        boolean lightTop = isLight(t), lightBottom = isLight(b);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            int on = (lightTop ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0)
                    | (lightBottom ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0);
            c.setSystemBarsAppearance(on, mask);
        } else {
            int f = root.getSystemUiVisibility();
            f = lightTop ? f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            f = lightBottom ? f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            root.setSystemUiVisibility(f);
        }
    }

    // ---- Lifecycle: the page is not paused when the app is hidden (reading goes on) ----

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (instance == this) instance = null;
        speech.shutdown();
        PlayerService.end(this);
        web.destroy();
        web = null;
        super.onDestroy();
    }
}
