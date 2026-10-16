// @ts-check
// A picture of a quote from the book (to send into a messenger): the words on a quiet background, the
// place under them («Книга Урантии · 5:1.3») and the site. Drawn on a canvas on the device — no
// libraries, no server. The text takes the reader's own font and the largest size it fits in.

/** @typedef {'paper' | 'night' | 'sage' | 'sky'} CardStyle */
/** @typedef {'square' | 'story'} CardFormat */

/**
 * The quote mark: two "commas" — a round head and a tail tapering down to the left (as a printed ”),
 * drawn as a shape, not taken from a font. One mark is 100 wide and 170 high; the pair — 241.
 */
const MARK = 'M49 100A49 49 0 1 1 98 51C98 105 72 146 21 169C40 141 52 120 49 100Z';
export const QUOTE_PATH = `${MARK}M192 100A49 49 0 1 1 241 51C241 105 215 146 164 169C183 141 195 120 192 100Z`;
export const QUOTE_BOX = '0 0 241 170';

/** The backgrounds: two colors of a gradient, the text, the accent (the quote mark, the line), the quiet text. */
export const CARD_STYLES = /** @type {Record<CardStyle, { name: string, bg: [string, string], text: string, accent: string, muted: string }>} */ ({
  paper: { name: 'Бумага', bg: ['#f7f2e8', '#ece3d2'], text: '#2b2620', accent: '#b0894a', muted: '#7d7263' },
  night: { name: 'Ночь', bg: ['#22242a', '#141518'], text: '#f1ede4', accent: '#d6b36c', muted: '#9b978e' },
  sage: { name: 'Шалфей', bg: ['#edf2ea', '#d9e5d4'], text: '#1f2a1f', accent: '#5d7d55', muted: '#66735f' },
  sky: { name: 'Небо', bg: ['#edf2fa', '#d5e0f2'], text: '#1b2433', accent: '#4a6ea6', muted: '#64708a' },
});
/** @type {Record<CardFormat, { name: string, w: number, h: number }>} */
export const CARD_FORMATS = {
  square: { name: 'Квадрат', w: 1080, h: 1080 },
  story: { name: 'История', w: 1080, h: 1920 },
};

/**
 * Lines of a text in a width, word by word (a word longer than the width stands alone).
 * @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} width
 */
function wrap(ctx, text, width) {
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws the card. @param {HTMLCanvasElement} canvas
 * @param {{ text: string, lang: string, ref: string, style: CardStyle, format: CardFormat, font: string, sans: string, site: string }} o
 * font, sans: CSS font families (the reader's text font; the interface's)
 */
export function drawQuoteCard(canvas, o) {
  const { w: W, h: H } = CARD_FORMATS[o.format];
  const c = CARD_STYLES[o.style];
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, c.bg[0]);
  g.addColorStop(1, c.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const pad = 96;
  const story = o.format === 'story';
  const en = o.lang === 'en';
  // the quote mark, large and quiet
  const markW = story ? 84 : 64; // one of the two commas
  const glyphTop = story ? 220 : pad;
  ctx.save();
  ctx.translate(pad, glyphTop);
  ctx.scale(markW / 100, markW / 100);
  ctx.fillStyle = c.accent;
  ctx.globalAlpha = 0.9;
  ctx.fill(new Path2D(QUOTE_PATH));
  ctx.restore();

  // the words: the largest size the box takes (a very long quote is cut with "…")
  const footerH = 150;
  const top = glyphTop + markW * 1.7 + (story ? 64 : 48);
  const bottom = H - pad - footerH - (story ? 120 : 0);
  const boxW = W - pad * 2;
  const text = o.text.replace(/\s+/g, ' ').trim();
  let size = story ? 76 : 64;
  /** @type {string[]} */
  let lines = [];
  let lh = 0;
  for (; size >= 30; size -= 2) {
    ctx.font = `400 ${size}px ${o.font}`;
    lh = Math.round(size * 1.42);
    lines = wrap(ctx, text, boxW);
    if (lines.length * lh <= bottom - top) break;
  }
  if (size < 30) {
    size = 30;
    ctx.font = `400 ${size}px ${o.font}`;
    lh = Math.round(size * 1.42);
    const fit = Math.max(1, Math.floor((bottom - top) / lh));
    if (lines.length > fit) {
      lines = lines.slice(0, fit);
      let last = lines[fit - 1];
      while (last && ctx.measureText(`${last}…`).width > boxW) last = last.replace(/\s*\S+$/, '');
      lines[fit - 1] = `${last.replace(/[\s,.;:—–-]+$/, '')}…`;
    }
  }
  // a short quote stands a little above the middle of its box; a long one fills it from the top
  const blockH = lines.length * lh;
  let y = top + Math.max(0, (bottom - top - blockH) * 0.4);
  ctx.fillStyle = c.text;
  ctx.textBaseline = 'alphabetic';
  for (const line of lines) {
    y += lh;
    ctx.fillText(line, pad, y - Math.round(lh * 0.28));
  }

  // the place and the site
  const fy = H - pad - footerH + (story ? -40 : 30);
  ctx.fillStyle = c.accent;
  ctx.fillRect(pad, fy, 72, 4);
  ctx.fillStyle = c.text;
  ctx.font = `600 ${story ? 40 : 36}px ${o.sans}`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${en ? 'The Urantia Book' : 'Книга Урантии'} · ${o.ref}`, pad, fy + 32);
  ctx.fillStyle = c.muted;
  ctx.font = `400 ${story ? 30 : 28}px ${o.sans}`;
  ctx.fillText(o.site, pad, fy + 32 + (story ? 60 : 54));
}

/** The canvas as a PNG. @param {HTMLCanvasElement} canvas @returns {Promise<Blob>} */
export const cardBlob = (canvas) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось нарисовать картинку'))), 'image/png'));
