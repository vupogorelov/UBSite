package ubsite.app;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The phone's speech synthesis: every installed engine (Google, Huawei, RHVoice…), the one chosen in
 * the system settings first. A voice is "<engine package>|<voice name>"; "" — the default engine's
 * voice for the language. The page queues sentences ahead; the engine reads them one after another
 * on its own, so reading goes on while the page sleeps behind a switched-off screen. Each sentence's
 * start and end go back to the page as events ("start", "end", "error") with the id the page gave it.
 */
final class Speech extends UtteranceProgressListener {
    interface Events {
        void emit(String type, String id);
    }

    /** One engine: its connection and what was last set on it (setting it again for every sentence is slow). */
    private final class Engine {
        final String pkg, label;
        final TextToSpeech tts;
        boolean ready;
        final List<Runnable> waiting = new ArrayList<>();
        String lastVoice, lastLang;
        float lastRate = -1, lastPitch = -1;

        Engine(Context c, String pkg, String label) {
            this.pkg = pkg;
            this.label = label;
            tts = new TextToSpeech(c, this::onInit, pkg);
        }

        private void onInit(int status) {
            synchronized (Speech.this) {
                ready = status == TextToSpeech.SUCCESS;
                if (!ready) {
                    NativeLog.add("warn", "Движок речи не подключился", "engine", pkg, "status", String.valueOf(status));
                    return;
                }
                tts.setOnUtteranceProgressListener(Speech.this);
                for (Runnable r : waiting) r.run();
                waiting.clear();
            }
            events.emit("voices", "");
        }
    }

    private final Events events;
    /** The engines, the default one first. */
    private final Map<String, Engine> engines = new LinkedHashMap<>();
    private final String defaultPkg;

    Speech(Context context, Events events) {
        this.events = events;
        Context app = context.getApplicationContext();
        // (a throwaway connection only to learn the engines and the default one)
        TextToSpeech probe = new TextToSpeech(app, s -> {});
        String def = probe.getDefaultEngine();
        List<TextToSpeech.EngineInfo> all = probe.getEngines();
        probe.shutdown();
        defaultPkg = def != null ? def : all.isEmpty() ? "" : all.get(0).name;
        for (TextToSpeech.EngineInfo e : all) if (e.name.equals(defaultPkg)) engines.put(e.name, new Engine(app, e.name, shortLabel(e)));
        for (TextToSpeech.EngineInfo e : all) if (!engines.containsKey(e.name)) engines.put(e.name, new Engine(app, e.name, shortLabel(e)));
    }

    /** "Распознавание и синтез речи от Google" → "Google". */
    private static String shortLabel(TextToSpeech.EngineInfo e) {
        if (e.name.startsWith("com.google.")) return "Google";
        if (e.name.startsWith("com.huawei.")) return "Huawei";
        if (e.name.startsWith("com.samsung.")) return "Samsung";
        if (e.name.contains("rhvoice")) return "RHVoice";
        return e.label != null ? e.label : e.name;
    }

    /** The engines' installed voices: [{ id, name, lang, local, engine }], each engine's on-device ones first. */
    synchronized String voices() {
        JSONArray out = new JSONArray();
        for (Engine e : engines.values()) {
            if (!e.ready) continue;
            Set<Voice> all;
            try {
                all = e.tts.getVoices();
            } catch (Exception ex) {
                continue;
            }
            if (all == null) continue;
            List<Voice> list = new ArrayList<>();
            for (Voice v : all) {
                Set<String> f = v.getFeatures();
                if (f != null && f.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                if (v.getName().endsWith("-language")) continue; // (Google's "the language's default": that is "Системный")
                list.add(v);
            }
            list.sort((a, b) -> a.isNetworkConnectionRequired() != b.isNetworkConnectionRequired()
                    ? (a.isNetworkConnectionRequired() ? 1 : -1)
                    : label(a).compareTo(label(b)));
            for (Voice v : list) {
                try {
                    out.put(new JSONObject()
                            .put("id", e.pkg + "|" + v.getName())
                            .put("name", label(v))
                            .put("lang", v.getLocale().toLanguageTag())
                            .put("local", !v.isNetworkConnectionRequired())
                            .put("engine", e.label));
                } catch (JSONException ignored) {
                }
            }
        }
        return out.toString();
    }

    /** Google names its voices "ru-ru-x-ruc-local": "Голос ruc". */
    private static String label(Voice v) {
        String[] parts = v.getName().split("-x-");
        if (parts.length == 2) return "Голос " + parts[1].replace("-local", "").replace("-network", "");
        return v.getName();
    }

    /** Adds a sentence to the queue; `voice` "" — the default engine's voice for `lang`. */
    synchronized void speak(String id, String text, String lang, String voice, float rate, float pitch, float volume) {
        int bar = voice.indexOf('|');
        Engine e = engines.get(bar > 0 ? voice.substring(0, bar) : defaultPkg);
        if (e == null) e = engines.get(defaultPkg);
        if (e == null) {
            events.emit("error", id);
            return;
        }
        String name = bar > 0 ? voice.substring(bar + 1) : voice;
        if (!e.ready) {
            Engine en = e;
            e.waiting.add(() -> say(en, id, text, lang, name, rate, pitch, volume));
            return;
        }
        say(e, id, text, lang, name, rate, pitch, volume);
    }

    private void say(Engine e, String id, String text, String lang, String voice, float rate, float pitch, float volume) {
        TextToSpeech tts = e.tts;
        if (!Objects.equals(voice, e.lastVoice) || !Objects.equals(lang, e.lastLang)) {
            Voice v = voice.isEmpty() ? null : find(tts, voice);
            if (v != null) tts.setVoice(v);
            else tts.setLanguage(Locale.forLanguageTag(lang));
            e.lastVoice = voice;
            e.lastLang = lang;
        }
        if (rate != e.lastRate) tts.setSpeechRate(e.lastRate = rate);
        if (pitch != e.lastPitch) tts.setPitch(e.lastPitch = pitch);
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume);
        if (tts.speak(text, TextToSpeech.QUEUE_ADD, params, id) != TextToSpeech.SUCCESS) events.emit("error", id);
    }

    private static Voice find(TextToSpeech tts, String name) {
        try {
            for (Voice v : tts.getVoices()) if (v.getName().equals(name)) return v;
        } catch (Exception ignored) {
        }
        return null;
    }

    /** Stops every engine and empties the queues. */
    synchronized void cancel() {
        for (Engine e : engines.values()) {
            e.waiting.clear();
            if (e.ready) e.tts.stop();
        }
    }

    synchronized void shutdown() {
        for (Engine e : engines.values()) e.tts.shutdown();
    }

    @Override
    public void onStart(String id) {
        events.emit("start", id);
    }

    @Override
    public void onDone(String id) {
        events.emit("end", id);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onError(String id) {
        events.emit("error", id);
    }

    @Override
    public void onError(String id, int code) {
        NativeLog.add("error", "Движок речи: ошибка", "code", String.valueOf(code));
        events.emit("error", id);
    }
}
