// @ts-check
// Workspace settings: one schema shared by the server (validation) and the web app (settings UI).
// Adding a setting = adding an item here; storage is a JSON column, so no migration is needed.

/**
 * @typedef {{
 *   theme: 'system' | 'light' | 'paper' | 'dark' | 'graphite',
 *   fontFamily: 'serif' | 'sans' | 'roboto',
 *   fontSize: number,
 *   fontWeight: number,
 *   lineHeight: number,
 *   columnWidth: number,
 *   enMode: 'full' | 'collapsed' | 'hidden',
 *   textActions: 'top' | 'bottom' | 'side',
 *   showRefs: boolean,
 *   showPageRefs: boolean,
 *   showNotes: boolean,
 *   showRail: boolean,
 *   showResolved: boolean,
 *   trText: 'original' | 'edition' | 'review',
 *   trMarks: boolean,
 *   trMine: boolean,
 *   trTint: boolean,
 *   colorYellow: string,
 *   colorGreen: string,
 *   colorBlue: string,
 *   colorPink: string,
 *   colorPurple: string,
 * }} Settings
 *
 * `when`: the setting only applies while another setting has one of the given values; otherwise
 * the form shows it disabled with `whenHint`.
 * @typedef {{ key: keyof Settings, label: string, hint?: string, when?: { key: keyof Settings, values: unknown[] }, whenHint?: string } & (
 *   | { type: 'choice', options: [string, string][], default: string }
 *   | { type: 'range', min: number, max: number, step: number, unit: string, default: number, valueLabels?: Record<number, string> }
 *   | { type: 'toggle', default: boolean }
 *   | { type: 'text', maxLength: number, swatch?: string, default: string }
 * )} SettingDef
 *
 * @typedef {{ title: string, scope: 'user' | 'workspace', items: SettingDef[] }} SettingGroup
 * scope "user": personal for each member of a workspace; "workspace": shared by all members.
 */

/** Highlight colors: id → settings key holding its workspace-specific name. */
export const NOTE_COLORS = /** @type {const} */ ([
  ['yellow', 'colorYellow'],
  ['green', 'colorGreen'],
  ['blue', 'colorBlue'],
  ['pink', 'colorPink'],
  ['purple', 'colorPurple'],
]);

/** @type {SettingGroup[]} */
export const SETTINGS_GROUPS = [
  {
    title: 'Оформление',
    scope: 'user',
    items: [
      {
        key: 'theme', label: 'Тема', type: 'choice', default: 'system',
        options: [['system', 'Системная'], ['light', 'Светлая'], ['paper', 'Бумага'], ['dark', 'Тёмная'], ['graphite', 'Графит']],
      },
      {
        key: 'fontFamily', label: 'Шрифт', type: 'choice', default: 'serif',
        options: [['serif', 'С засечками'], ['sans', 'Geist'], ['roboto', 'Roboto']],
      },
      { key: 'fontSize', label: 'Размер шрифта', type: 'range', min: 14, max: 26, step: 1, unit: 'px', default: 18 },
      {
        key: 'fontWeight', label: 'Толщина шрифта', type: 'range', min: 300, max: 700, step: 100, unit: '', default: 400,
        valueLabels: { 300: 'Тонкий', 400: 'Обычный', 500: 'Средний', 600: 'Полужирный', 700: 'Жирный' },
        when: { key: 'fontFamily', values: ['sans', 'roboto'] },
        whenHint: 'Доступна для шрифтов Geist и Roboto (переменной толщины). У «С засечками» есть только обычное и жирное начертания.',
      },
      { key: 'lineHeight', label: 'Межстрочный интервал', type: 'range', min: 1.3, max: 2.1, step: 0.1, unit: '', default: 1.6 },
      { key: 'columnWidth', label: 'Ширина колонки', type: 'range', min: 560, max: 1200, step: 20, unit: 'px', default: 820 },
    ],
  },
  {
    title: 'Текст',
    scope: 'user',
    items: [
      {
        key: 'enMode', label: 'Английский оригинал', type: 'choice', default: 'full',
        hint: 'В свёрнутом виде видна одна строка; клик по ней раскрывает абзац.',
        options: [['full', 'Полностью'], ['collapsed', 'Свёрнуто'], ['hidden', 'Скрыт']],
      },
      {
        key: 'textActions', label: 'Меню действий с текстом (телефон и планшет)', type: 'choice', default: 'top',
        hint: 'Где показывать «Комментарий · Обсудить · Перевести · Ссылка…» при выделении. Системное меню телефона появляется рядом с выделением, поэтому наше удобнее у края экрана. «Сбоку» — колонка у того края, где нет выделенного слова.',
        options: [['top', 'Сверху'], ['bottom', 'Снизу'], ['side', 'Сбоку (авто)']],
      },
      { key: 'showRefs', label: 'Номера абзацев (5:1.3)', type: 'toggle', default: true },
      { key: 'showPageRefs', label: 'Номера страниц (62.3)', type: 'toggle', default: true },
    ],
  },
  {
    title: 'Заметки',
    scope: 'user',
    items: [
      { key: 'showNotes', label: 'Закладки и комментарии в тексте', type: 'toggle', default: true },
      {
        key: 'showRail', label: 'Комментарии на полях', type: 'toggle', default: true,
        hint: 'Если места на экране мало, комментарий открывается снизу по клику на отмеченный фрагмент.',
      },
      { key: 'showResolved', label: 'Решённые обсуждения на полях', type: 'toggle', default: false },
    ],
  },
  {
    title: 'Перевод',
    scope: 'user',
    items: [
      {
        key: 'trText', label: 'Текст', type: 'choice', default: 'original',
        hint: '«Новая редакция» — принятые голосованием варианты стоят в тексте вместо исходного (исходный — в подсказке при наведении). «Правка» — исходный зачёркнут, принятый вариант вставлен рядом.',
        options: [['original', 'Исходный'], ['edition', 'Новая редакция'], ['review', 'Правка']],
      },
      {
        key: 'trMarks', label: 'Подчёркивать варианты перевода', type: 'toggle', default: true,
        hint: 'Принятые — сплошной линией, на голосовании — штрихом, ваши черновики — точками. Ctrl+клик по фрагменту — все варианты и голосование; на телефоне — касание.',
      },
      {
        key: 'trMine', label: 'Мои варианты поверх текста', type: 'toggle', default: false,
        hint: 'Ваши черновики и ваши предложения на голосовании стоят в тексте вместо исходного (или принятого).',
      },
      {
        key: 'trTint', label: 'Тонировать мои варианты', type: 'toggle', default: true,
        when: { key: 'trMine', values: [true] }, whenHint: 'Действует, когда включены «Мои варианты поверх текста».',
      },
    ],
  },
  {
    title: 'Цвета закладок',
    scope: 'workspace',
    items: [
      { key: 'colorYellow', label: 'Жёлтый', type: 'text', maxLength: 40, swatch: 'yellow', default: 'Важно' },
      { key: 'colorGreen', label: 'Зелёный', type: 'text', maxLength: 40, swatch: 'green', default: 'Ключевая мысль' },
      { key: 'colorBlue', label: 'Синий', type: 'text', maxLength: 40, swatch: 'blue', default: 'Вопрос' },
      { key: 'colorPink', label: 'Розовый', type: 'text', maxLength: 40, swatch: 'pink', default: 'Перевод' },
      { key: 'colorPurple', label: 'Фиолетовый', type: 'text', maxLength: 40, swatch: 'purple', default: 'Связь' },
    ],
  },
];

const DEFS = SETTINGS_GROUPS.flatMap((g) => g.items);

/** @returns {Settings} */
export function settingDefaults() {
  return /** @type {Settings} */ (Object.fromEntries(DEFS.map((d) => [d.key, d.default])));
}

/**
 * Keeps only known keys with valid values (optionally of one scope); everything else is dropped.
 * @param {unknown} input
 * @param {'user' | 'workspace'} [scope]
 * @returns {Partial<Settings>}
 */
export function sanitizeSettings(input, scope) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!input || typeof input !== 'object') return out;
  const src = { .../** @type {Record<string, unknown>} */ (input) };
  if (src.theme === 'sepia') src.theme = 'paper'; // the Sepia theme was replaced by Paper
  // One "trMode" switch was split into trMarks + trMine (trText is new).
  if (typeof src.trMode === 'string' && src.trMarks === undefined) {
    src.trMarks = src.trMode !== 'off';
    src.trMine = src.trMode === 'mine';
  }
  const defs = scope ? SETTINGS_GROUPS.filter((g) => g.scope === scope).flatMap((g) => g.items) : DEFS;
  for (const d of defs) {
    const v = src[d.key];
    if (d.type === 'choice' && typeof v === 'string' && d.options.some(([value]) => value === v)) out[d.key] = v;
    if (d.type === 'range' && typeof v === 'number' && v >= d.min && v <= d.max) out[d.key] = v;
    if (d.type === 'toggle' && typeof v === 'boolean') out[d.key] = v;
    if (d.type === 'text' && typeof v === 'string' && v.trim().length <= d.maxLength) out[d.key] = v.trim();
  }
  return /** @type {Partial<Settings>} */ (out);
}
