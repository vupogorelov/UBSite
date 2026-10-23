// @ts-check
// The settings' schema: what a new person starts with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingDefaults, sanitizeSettings } from './settings.js';

test('a new person searches by the words', () => {
  assert.equal(/** @type {any} */ (settingDefaults()).searchMode, 'words');
});

test('a way of searching not known is not kept', () => {
  assert.equal(sanitizeSettings({ searchMode: 'magic' }, 'user').searchMode, undefined);
});
