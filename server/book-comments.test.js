// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createRouter } from './http.js';
import { createAuth } from './auth.js';
import { createChat } from './chat.js';
import { createGlossary } from './glossary.js';
import { createNotifications } from './notifications.js';
import { createTranslation } from './translation.js';
import { registerPublicRoutes } from './api/public.js';

test('book export comments include only visible paragraph messages in book order', () => {
  const db = openDb(':memory:');
  db.exec(`
    INSERT INTO parts (id, title_ru, title_en) VALUES (1, 'Часть', 'Part');
    INSERT INTO papers (id, part_id, title_ru, title_en) VALUES (5, 1, 'Текст', 'Paper');
    INSERT INTO paragraphs (ref, seq, paper_id, section_num, num, page_ref, html_ru, html_en, plain_ru, plain_en)
      VALUES ('5:1.1', 1, 5, 1, 1, '62.1', 'один', 'one', 'один', 'one'),
             ('5:1.2', 2, 5, 1, 2, '62.2', 'два', 'two', 'два', 'two');
    INSERT INTO users (id, username, username_key, display_name) VALUES (1, 'anna', 'anna', 'Анна');
    INSERT INTO public_messages (ref, author_id, body) VALUES
      ('5:1.2', 1, 'Второй абзац'),
      ('5:1.1', 1, 'Первый абзац'),
      ('5:1.1', 1, 'Скрытый комментарий');
    UPDATE public_messages SET hidden_at = datetime('now') WHERE body = 'Скрытый комментарий';
    INSERT INTO public_messages (ref, author_id, kind, body) VALUES ('5:1.1', 1, 'event', 'Служебное событие');
    INSERT INTO public_messages (ref, author_id, body) VALUES ('note:1', 1, 'Не обсуждение абзаца');
  `);

  const router = createRouter();
  const translation = createTranslation(db);
  registerPublicRoutes(
    router,
    db,
    translation,
    createNotifications(db, translation),
    createGlossary(db),
    createChat(db, createAuth(db)),
  );
  const route = router.match('GET', '/api/public/book-comments');
  assert.ok(route);
  const result = /** @type {{ comments: { ref: string, authorName: string | null, body: string }[] }} */ (
    route.handler({
      req: /** @type {any} */ ({}),
      res: /** @type {any} */ ({}),
      params: route.params,
      url: new URL('http://localhost/api/public/book-comments'),
      user: {
        id: 1, username: 'anna', displayName: 'Анна', isAdmin: false, isTranslator: false, isCoordinator: false,
        email: null, emailVerified: false,
      },
    })
  );

  assert.deepEqual(result.comments.map((comment) => ({ ...comment })), [
    { ref: '5:1.1', authorName: 'Анна', body: 'Первый абзац' },
    { ref: '5:1.2', authorName: 'Анна', body: 'Второй абзац' },
  ]);
  db.close();
});
