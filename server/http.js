// @ts-check
// Minimal HTTP toolkit on node:http: router, JSON in/out, static files with SPA fallback.
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/** @typedef {import('node:http').IncomingMessage} Req */
/** @typedef {import('node:http').ServerResponse} Res */
/**
 * `user` is set for every authenticated request; only /api/auth/* routes run without it.
 * @typedef {{ req: Req, res: Res, params: Record<string, string>, url: URL, user: import('./auth.js').User }} Ctx
 */
/** @typedef {(ctx: Ctx) => unknown} Handler */

export class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createRouter() {
  /** @type {{ method: string, re: RegExp, keys: string[], handler: Handler }[]} */
  const routes = [];
  return {
    /** @param {string} method @param {string} path e.g. "/api/papers/:id" @param {Handler} handler */
    on(method, path, handler) {
      /** @type {string[]} */
      const keys = [];
      const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
      routes.push({ method, re, keys, handler });
    },
    /** @param {string} method @param {string} pathname */
    match(method, pathname) {
      for (const r of routes) {
        const m = r.method === method && pathname.match(r.re);
        if (m) {
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          return { handler: r.handler, params };
        }
      }
      return null;
    },
  };
}

/** A handler result meaning "the handler wrote the response itself" (e.g. a Server-Sent Events stream). */
export const STREAM = Symbol('stream');

/** A handler result sent as a file download instead of JSON. */
export class FileResponse {
  /**
   * @param {string} name file name for the browser @param {string} type media type @param {Buffer | string} body
   * @param {boolean} [inline] shown in the page (an image) rather than downloaded
   */
  constructor(name, type, body, inline = false) {
    this.name = name;
    this.type = type;
    this.body = typeof body === 'string' ? Buffer.from(body) : body;
    this.inline = inline;
  }

  /** @param {Res} res */
  send(res) {
    res.writeHead(200, {
      'Content-Type': this.type,
      'Content-Length': this.body.length,
      'Content-Disposition': `${this.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(this.name)}`,
      'Cache-Control': this.inline ? 'no-cache' : 'no-store',
    }).end(this.body);
  }
}

/** @param {Req} req @param {Res} res @param {number} status @param {unknown} data */
export function sendJson(req, res, status, data) {
  let body = Buffer.from(JSON.stringify(data ?? null));
  /** @type {Record<string, string | number>} */
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (body.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding']))) {
    body = gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers).end(body);
}

/** @param {Req} req @param {number} [limit] */
export async function readJson(req, limit = 1_000_000) {
  let size = 0;
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.apk': 'application/vnd.android.package-archive',
});

/**
 * Serves files from `dir`; unknown paths get index.html so client-side routes work.
 * @param {string} dir
 */
export function createStatic(dir) {
  const root = resolve(dir);
  /** The file's size and an ETag from its size and time of change (-1: no such file). @param {string} file */
  const fileInfo = (file) => {
    try {
      const st = statSync(file);
      return st.isFile() ? { size: st.size, etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"` } : { size: -1, etag: '' };
    } catch {
      return { size: -1, etag: '' };
    }
  };
  /** @param {Req} req @param {Res} res @param {string} pathname */
  return (req, res, pathname) => {
    let file = join(root, decodeURIComponent(pathname));
    if (!file.startsWith(root + sep) && file !== root) throw new HttpError(403, 'Forbidden');
    let info = fileInfo(file);
    if (info.size < 0) {
      file = join(root, 'index.html');
      info = fileInfo(file);
      if (info.size < 0) throw new HttpError(404, 'web/dist not found: run "npm run build" or use "npm run dev"');
    }
    const immutable = pathname.startsWith('/assets/'); // Vite puts content-hashed files here
    const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
    // (the browser checks sw.js, index.html… on every visit: unchanged ones are answered with 304)
    if (req.headers['if-none-match'] === info.etag) {
      res.writeHead(304, { ETag: info.etag, 'Cache-Control': cacheControl }).end();
      return;
    }
    const size = info.size;
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': cacheControl,
      ETag: info.etag,
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  };
}
