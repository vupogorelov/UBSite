// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { scanAudio, createAudio } from './audio.js';

test('the catalog: a file per section, two sections in one file, other files skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-audio-'));
  try {
    for (const f of ['01-00.mp3', '01-02.mp3', '01-01.mp3', '139-09-10.mp3', 'notes.txt', '2-1.ogg']) writeFileSync(join(dir, f), 'x');
    assert.deepEqual(scanAudio(dir), [
      { paper: 1, sections: [0], file: '01-00.mp3', size: 1 },
      { paper: 1, sections: [1], file: '01-01.mp3', size: 1 },
      { paper: 1, sections: [2], file: '01-02.mp3', size: 1 },
      { paper: 2, sections: [1], file: '2-1.ogg', size: 1 },
      { paper: 139, sections: [9, 10], file: '139-09-10.mp3', size: 1 },
    ]);
    assert.deepEqual(scanAudio(join(dir, 'none')), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the catalog: where the paragraphs begin, from the folder\'s timings.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-audio-'));
  try {
    writeFileSync(join(dir, '05-01.mp3'), 'x');
    writeFileSync(join(dir, '05-02.mp3'), 'x');
    writeFileSync(join(dir, 'timings.json'), JSON.stringify({ '05-01.mp3': { '5:1.2': 41.5, '5:1.1': 0, '5:1.3': 'x' } }));
    assert.deepEqual(scanAudio(dir), [
      { paper: 5, sections: [1], file: '05-01.mp3', size: 1, marks: [['5:1.1', 0], ['5:1.2', 41.5]] },
      { paper: 5, sections: [2], file: '05-02.mp3', size: 1 },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a file goes out whole or in the part asked for', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ub-audio-'));
  const prev = process.env.UB_AUDIO_RU_DIR, prevEn = process.env.UB_AUDIO_EN_DIR;
  process.env.UB_AUDIO_RU_DIR = dir;
  process.env.UB_AUDIO_EN_DIR = join(dir, 'none'); // (no English recording here)
  writeFileSync(join(dir, '05-01.mp3'), '0123456789');
  const audio = createAudio();
  const server = createServer((req, res) => {
    try {
      audio.send(req, res, 'ru', String(req.url).slice(1));
    } catch (err) {
      res.writeHead(/** @type {any} */ (err).status ?? 500).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/`;
  try {
    assert.deepEqual(audio.catalog(), { ru: [{ paper: 5, sections: [1], file: '05-01.mp3', size: 10 }] });
    let r = await fetch(base + '05-01.mp3');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.equal(await r.text(), '0123456789');
    r = await fetch(base + '05-01.mp3', { headers: { range: 'bytes=2-5' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await r.text(), '2345');
    r = await fetch(base + '05-01.mp3', { headers: { range: 'bytes=7-' } });
    assert.equal(await r.text(), '789');
    r = await fetch(base + '05-01.mp3', { headers: { range: 'bytes=-3' } });
    assert.equal(await r.text(), '789');
    r = await fetch(base + '05-01.mp3', { headers: { range: 'bytes=20-' } });
    assert.equal(r.status, 416);
    r = await fetch(base + '..%2Fsecret.mp3');
    assert.equal(r.status, 404);
  } finally {
    server.close();
    if (prev === undefined) delete process.env.UB_AUDIO_RU_DIR;
    else process.env.UB_AUDIO_RU_DIR = prev;
    if (prevEn === undefined) delete process.env.UB_AUDIO_EN_DIR;
    else process.env.UB_AUDIO_EN_DIR = prevEn;
    rmSync(dir, { recursive: true });
  }
});
