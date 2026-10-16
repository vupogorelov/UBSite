// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, pageOf, isSectionPath } from './pages.js';

test('the pages in place of the book: found by the address; the book has none', () => {
  assert.equal(pageOf('/chat')?.id, 'chat');
  assert.equal(pageOf('/chat?c=chan:1')?.id, 'chat', 'a conversation is the chat page');
  assert.equal(pageOf('/tasks?ref=5:1.1')?.id, 'tasks');
  assert.equal(pageOf('/about')?.id, 'about');
  assert.equal(pageOf('/support')?.id, 'support');
  assert.equal(pageOf('/c/12')?.id, 'collection');
  assert.deepEqual(pageOf('/c/12')?.props?.('/c/12'), { id: 12 });
  for (const book of ['/5', '/5:1', '/5:1.3', '/5:1.3?sel=ru.1-5', '/chatter', '/c/x']) assert.equal(pageOf(book), null, book);
});

test("a page's own address is a section ('back' from it goes to the book); a collection or a conversation is not", () => {
  assert.equal(isSectionPath('/chat'), true);
  assert.equal(isSectionPath('/tasks'), true);
  assert.equal(isSectionPath('/chat?c=chan:1'), false);
  assert.equal(isSectionPath('/c/12'), false);
  assert.equal(isSectionPath('/5'), false);
});

test('each page: a unique id, a title, a component to load; the chat shows its header unless a conversation is open', () => {
  assert.equal(new Set(PAGES.map((p) => p.id)).size, PAGES.length);
  for (const p of PAGES) assert.ok(p.title && typeof p.load === 'function', p.id);
  const chat = pageOf('/chat');
  assert.equal(chat?.sectionHead?.('/chat'), true);
  assert.equal(chat?.sectionHead?.('/chat?c=chan:1'), false);
});
