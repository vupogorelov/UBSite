// @ts-check
// The AI the platform speaks through (VISION.md, 7): remote models, reached by the platform's server only — so the
// server carries no model, and a reader's question never goes from the browser to a third party. A connection
// is made by OAuth 2.0 (a sign-in in the browser, the service gives the application a key): the application's
// own — the administrator connects it once (the shared answers of the day); later a reader's own. The keys stay
// in the database (ai_keys), never sent to a browser.
import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

/**
 * The services one connects by OAuth: where to sign in, where the code becomes a key, where to ask.
 * OpenRouter: OAuth with PKCE — the key is the signed-in account's (its free models, its limits).
 */
export const PROVIDERS = {
  openrouter: {
    title: 'OpenRouter',
    auth: 'https://openrouter.ai/auth',
    exchange: 'https://openrouter.ai/api/v1/auth/keys',
    chat: 'https://openrouter.ai/api/v1/chat/completions',
  },
};
/** @typedef {keyof typeof PROVIDERS} Provider */

/**
 * The application's own answers a day, for everyone together (its account's free models: ≈50 a day — a few kept
 * for the Laboratory). The day is Moscow's, as the Book's daily voice.
 */
const perDay = () => Number(process.env.UB_AI_SHARED_PER_DAY ?? 45);
const ZONE_HOURS = 3;
const today = () => new Date(Date.now() + ZONE_HOURS * 3_600_000).toISOString().slice(0, 10);
/** A sign-in begun and not finished: forgotten after this. */
const PENDING = 15 * 60_000;
/** A model's answer is waited for this long. */
const TIMEOUT = Number(process.env.UB_AI_TIMEOUT_MS ?? 90_000);
const fetchFn = () => globalThis.fetch;

/** @param {import('node:sqlite').DatabaseSync} db */
export function createAi(db) {
  const q = {
    get: db.prepare('SELECT provider, secret, created_at AS since FROM ai_keys WHERE owner = ?'),
    put: db.prepare('INSERT OR REPLACE INTO ai_keys (owner, provider, secret) VALUES (?, ?, ?)'),
    del: db.prepare('DELETE FROM ai_keys WHERE owner = ?'),
    meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  };
  /** The shared answers used today. */
  const used = () => {
    const v = /** @type {{ value: string } | undefined} */ (q.meta.get('ai.shared'))?.value?.split(' ');
    return v && v[0] === today() ? Number(v[1]) : 0;
  };
  /** @param {number} n */
  const setUsed = (n) => q.setMeta.run('ai.shared', `${today()} ${Math.max(0, Math.min(perDay(), n))}`);
  /** state → the sign-in it belongs to. @type {Map<string, { provider: Provider, verifier: string, owner: string, back: string, until: number }>} */
  const pending = new Map();

  /** @param {string} provider @returns {Provider} */
  const providerOf = (provider) => {
    if (!(provider in PROVIDERS)) throw new HttpError(404, 'Нет такого сервиса ИИ');
    return /** @type {Provider} */ (provider);
  };

  return {
    /** What is connected for an owner ('app' — the application's own): the service and since when; null — nothing. @param {string} owner */
    status(owner) {
      const row = /** @type {{ provider: Provider, since: string } | undefined} */ (q.get.get(owner));
      return row ? { provider: row.provider, title: PROVIDERS[row.provider]?.title ?? row.provider, since: row.since } : null;
    },

    /**
     * A sign-in begun: the address of the service's page to send the browser to (PKCE: the challenge goes, the
     * verifier stays here); it comes back to /api/ai/callback/<provider>, then to `back`.
     * @param {string} owner @param {string} provider @param {string} origin the site's public address @param {string} back a path of the site
     */
    begin(owner, provider, origin, back) {
      const p = providerOf(provider);
      const now = Date.now();
      for (const [k, v] of pending) if (v.until < now) pending.delete(k);
      const state = randomBytes(16).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      pending.set(state, { provider: p, verifier, owner, back: back.startsWith('/') ? back : '/', until: now + PENDING });
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const callback = `${origin}/api/ai/callback/${p}?state=${state}`;
      return `${PROVIDERS[p].auth}?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
    },

    /**
     * The service sent the browser back with a code: it becomes the key, kept for the owner. The path to go on to.
     * @param {string} provider @param {string} code @param {string} state
     */
    async finish(provider, code, state) {
      const p = providerOf(provider);
      const s = pending.get(state);
      pending.delete(state);
      if (!s || s.provider !== p || s.until < Date.now()) throw new HttpError(400, 'Вход устарел — начните заново');
      const res = await fetchFn()(PROVIDERS[p].exchange, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: s.verifier, code_challenge_method: 'S256' }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = /** @type {any} */ (await res.json().catch(() => null));
      if (!res.ok || typeof data?.key !== 'string') throw new HttpError(502, `${PROVIDERS[p].title} не выдал ключ${data?.error?.message ? `: ${data.error.message}` : ''}`);
      q.put.run(s.owner, p, data.key);
      return s.back;
    },

    /** The page a sign-in began on ('/' — unknown). @param {string} state */
    backOf(state) {
      return pending.get(state)?.back ?? '/';
    },

    /** @param {string} owner */
    disconnect(owner) {
      q.del.run(owner);
    },

    // ---- the shared answers of the day (the application's own connection, for everyone together) ----
    /** How many are left today, of how many. */
    shared() {
      return { left: perDay() - used(), of: perDay() };
    },
    /** One taken (false — none left today). */
    takeShared() {
      const n = used();
      if (n >= perDay()) return false;
      setUsed(n + 1);
      return true;
    },
    /** One given back (the answer did not come: not the service's limit). */
    returnShared() {
      setUsed(used() - 1);
    },
    /** None left today: the service said its limit is reached. */
    spendShared() {
      setUsed(perDay());
    },

    /**
     * A model's answer to a conversation, through an owner's connection. Errors say what happened: nothing
     * connected (409), the day's limit spent (429), the service failing (502).
     * @param {string} owner @param {string} model the service's name of it
     * @param {{ role: string, content: string }[]} messages @param {{ max: number }} opts
     * @returns {Promise<{ text: string, tokens: number }>}
     */
    async chat(owner, model, messages, { max }) {
      const row = /** @type {{ provider: Provider, secret: string } | undefined} */ (q.get.get(owner));
      if (!row) throw new HttpError(409, 'Нейросеть не подключена');
      const res = await fetchFn()(PROVIDERS[row.provider].chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${row.secret}`, 'X-Title': 'Urantia Papers Explorer' },
        // (a thinking model thinks briefly and keeps it to itself: the answer alone)
        body: JSON.stringify({ model, messages, max_tokens: max, temperature: 0.3, reasoning: { effort: 'low', exclude: true } }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = /** @type {any} */ (await res.json().catch(() => null));
      if (res.status === 429) throw new HttpError(429, 'Запас ответов на сегодня закончился');
      if (res.status === 401 || res.status === 403) throw new HttpError(409, `${PROVIDERS[row.provider].title}: доступ закрыт — подключите заново`);
      if (!res.ok || data?.error) throw new HttpError(502, `${PROVIDERS[row.provider].title}: ${data?.error?.message ?? `ошибка ${res.status}`}`);
      const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
      if (!text) throw new HttpError(502, `${PROVIDERS[row.provider].title}: пустой ответ`);
      return { text, tokens: Number(data?.usage?.completion_tokens ?? 0) };
    },
  };
}
