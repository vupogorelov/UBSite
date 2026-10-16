// @ts-check
// Recorded reading of the book: a folder of files per language, one file per section of a paper —
// "PP-SS.mp3" (section 0 — the paper's introduction), or "PP-S1-S2.mp3" when one file reads two
// sections. The catalog is read from the folder at start; files go out in parts (Range), so the
// player can seek without loading the whole file. Russian — Григорий Войнер, English — Merritt Horn.
// A folder's timings.json, when there is one, marks where the paragraphs begin in its files:
// { "05-01.mp3": { "5:1.1": 0, "5:1.2": 41.5, … } } — a track gets them as marks [[ref, seconds], …].
import { readdirSync, readFileSync, statSync, createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.js';

const TYPES = /** @type {Record<string, string>} */ ({ mp3: 'audio/mpeg', ogg: 'audio/ogg' });
const NAME = /^(\d+)-(\d+)(?:-(\d+))?\.(mp3|ogg)$/;

/** `size`: bytes (a download without a network is offered with its size). @typedef {{ paper: number, sections: number[], file: string, size?: number, duration?: number, marks?: [string, number][] }} Track */

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 layer III
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * An MP3 file's length in seconds, from its first frame (no decoding): the frame count of a Xing /
 * Info header, else (constant bitrate) the size over the bitrate. Null when it is not an MP3.
 * @param {string} path
 */
export function mp3Duration(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const buf = Buffer.alloc(64 * 1024);
    let n = readSync(fd, buf, 0, buf.length, 0);
    let start = 0;
    if (buf.toString('latin1', 0, 3) === 'ID3') {
      // ID3v2: a tag before the audio, its size in 7-bit bytes
      start = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]) + (buf[5] & 0x10 ? 10 : 0);
      n = readSync(fd, buf, 0, buf.length, start);
    }
    for (let i = 0; i + 4 < n; i++) {
      if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
      const version = (buf[i + 1] >> 3) & 3; // 3 — MPEG-1, 2 — MPEG-2, 0 — MPEG-2.5
      const layer = (buf[i + 1] >> 1) & 3; // 1 — layer III
      const kbps = BITRATES[version === 3 ? 1 : 2][buf[i + 2] >> 4];
      const rate = RATES[/** @type {3 | 2 | 0} */ (version)]?.[(buf[i + 2] >> 2) & 3];
      if (version === 1 || layer !== 1 || !kbps || !rate) continue;
      const mono = buf[i + 3] >> 6 === 3;
      const perFrame = version === 3 ? 1152 : 576;
      const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
      const x = i + 4 + side;
      const tag = buf.toString('latin1', x, x + 4);
      if ((tag === 'Xing' || tag === 'Info') && buf[x + 7] & 1) return (buf.readUInt32BE(x + 8) * perFrame) / rate;
      return ((size - start - i) * 8) / (kbps * 1000);
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The folders, by language (a language without a folder has no recording). */
function folders() {
  /** @type {Record<string, string>} */
  const dirs = {};
  const ru = process.env.UB_AUDIO_RU_DIR ?? fileURLToPath(new URL('../book/UB_audio_voiner', import.meta.url));
  if (ru) dirs.ru = ru;
  const en = process.env.UB_AUDIO_EN_DIR ?? fileURLToPath(new URL('../book/UB_audio_horn', import.meta.url));
  if (en) dirs.en = en;
  return dirs;
}

/** @param {string} dir @returns {Track[]} */
export function scanAudio(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  /** @type {Record<string, Record<string, number>>} */
  let timings = {};
  if (names.includes('timings.json')) {
    try {
      timings = JSON.parse(readFileSync(join(dir, 'timings.json'), 'utf8'));
    } catch (err) {
      console.error(`${join(dir, 'timings.json')}: ${/** @type {Error} */ (err).message}`);
    }
  }
  /** @type {Track[]} */
  const tracks = [];
  for (const file of names) {
    const m = file.match(NAME);
    if (!m) continue;
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    const sections = [];
    for (let s = a; s <= b; s++) sections.push(s);
    /** @type {Track} */
    const t = { paper: Number(m[1]), sections, file };
    try {
      t.size = statSync(join(dir, file)).size;
    } catch {}
    if (m[4] === 'mp3') {
      try {
        const d = mp3Duration(join(dir, file));
        if (d) t.duration = Math.round(d);
      } catch {}
    }
    const marks = timings[file];
    if (marks && typeof marks === 'object') {
      t.marks = /** @type {[string, number][]} */ (Object.entries(marks).filter(([, s]) => typeof s === 'number' && s >= 0)).sort((x, y) => x[1] - y[1]);
    }
    tracks.push(t);
  }
  return tracks.sort((x, y) => x.paper - y.paper || x.sections[0] - y.sections[0]);
}

export function createAudio() {
  const dirs = folders();
  /** @type {Record<string, Track[]>} */
  const catalog = {};
  for (const [lang, dir] of Object.entries(dirs)) {
    const tracks = scanAudio(dir);
    if (tracks.length) catalog[lang] = tracks;
  }
  /** @type {Record<string, Set<string>>} */
  const known = Object.fromEntries(Object.entries(catalog).map(([lang, t]) => [lang, new Set(t.map((x) => x.file))]));
  return {
    /** Tracks by language (only languages that have any). */
    catalog: () => catalog,
    /**
     * Sends a file of the catalog, whole or the part asked for (Range).
     * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
     * @param {string} lang @param {string} file
     */
    send(req, res, lang, file) {
      if (!known[lang]?.has(file)) throw new HttpError(404, 'Нет такой записи');
      const path = join(dirs[lang], file);
      const size = statSync(path).size;
      /** @type {Record<string, string | number>} */
      const headers = {
        'Content-Type': TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=86400',
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      let start = 0;
      let end = size - 1;
      let status = 200;
      if (range && (range[1] || range[2])) {
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(end, Number(range[2]));
        } else start = Math.max(0, size - Number(range[2])); // the last N bytes
        if (start > end || start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
          return;
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
      headers['Content-Length'] = end - start + 1;
      res.writeHead(status, headers);
      if (req.method === 'HEAD') return void res.end();
      const stream = createReadStream(path, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy()); // the player jumped elsewhere
      stream.pipe(res);
    },
  };
}
