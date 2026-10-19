// @ts-check
// Workspace settings: one schema shared by the server (validation) and the web app (settings UI).
// Adding a setting = adding an item here; storage is a JSON column, so no migration is needed.

/**
 * @typedef {{
 *   theme: 'system' | 'paper' | 'graphite',
 *   fontFamily: 'serif' | 'sans' | 'roboto',
 *   fontSize: number,
 *   chatFontSize: number,
 *   kanbanFontSize: number,
 *   taskListFontSize: number,
 *   chatBg: string,
 *   chatWallpaper: string,
 *   chatBubble: string,
 *   chatOwn: string,
 *   chatFont: 'sans' | 'serif',
 *   chatRadius: number,
 *   fontWeight: number,
 *   lineHeight: number,
 *   columnWidth: number,
 *   textAlign: 'left' | 'justify',
 *   hyphens: boolean,
 *   flashTone: 'warm' | 'cool',
 *   readLang: 'ru' | 'en',
 *   enMode: 'full' | 'collapsed' | 'hidden',
 *   textActions: 'top' | 'bottom' | 'side',
 *   placeMode: 'separate' | 'shared',
 *   showRefs: boolean,
 *   showPageRefs: boolean,
 *   altNames: boolean,
 *   termPairs: boolean,
 *   dictHints: boolean,
 *   dictMark: 'dot' | 'line',
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
 *   phoneNav: string,
 *   whatsNewSeen: string,
 *   searchMode: 'words' | 'meaning' | 'hybrid',
 *   glassBars: boolean,
 *   navLabels: boolean,
 *   barsAutoHide: boolean,
 *   navStyle: 'bar' | 'air',
 * }} Settings
 *
 * `when`: the setting only applies while another setting has one of the given values; otherwise
 * the form shows it disabled with `whenHint`. `hidden`: stored like the others, but changed elsewhere
 * (not in the settings form).
 * @typedef {{ key: keyof Settings, label: string, hint?: string, when?: { key: keyof Settings, values: unknown[] }, whenHint?: string, hidden?: boolean } & (
 *   | { type: 'choice', options: [string, string][], default: string, swatches?: boolean }
 *   | { type: 'range', min: number, max: number, step: number, unit: string, default: number, valueLabels?: Record<number, string> }
 *   | { type: 'toggle', default: boolean }
 *   | { type: 'text', maxLength: number, swatch?: string, default: string }
 * )} SettingDef
 *
 * @typedef {{ title: string, scope: 'user' | 'workspace', section: string, icon: string, items: SettingDef[] }} SettingGroup
 * scope "user": personal for each member of a workspace; "workspace": shared by all members.
 * The settings form has two levels: sections (`section`) listing their groups as rows with a summary
 * of the current values, and a group's own page with its settings.
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
    title: 'Оформление', section: 'Чтение', icon: 'theme',
    scope: 'user',
    items: [
      // Two modes, switched by the button in the header: light (Paper) and dark (Graphite);
      // until the first switch — as on the device.
      {
        key: 'theme', label: 'Тема', type: 'choice', default: 'system', hidden: true,
        options: [['system', 'Как на устройстве'], ['paper', 'Светлая'], ['graphite', 'Тёмная']],
      },
      {
        key: 'fontFamily', label: 'Шрифт', type: 'choice', default: 'serif',
        options: [['serif', 'С засечками'], ['sans', 'Geist'], ['roboto', 'Roboto']],
      },
      {
        key: 'fontSize', label: 'Размер шрифта', type: 'range', min: 14, max: 26, step: 1, unit: 'px', default: 18,
        hint: 'На телефоне и планшете — также сведением и разведением двух пальцев над текстом книги.',
      },
      {
        key: 'fontWeight', label: 'Толщина шрифта', type: 'range', min: 300, max: 700, step: 100, unit: '', default: 400,
        valueLabels: { 300: 'Тонкий', 400: 'Обычный', 500: 'Средний', 600: 'Полужирный', 700: 'Жирный' },
        when: { key: 'fontFamily', values: ['sans', 'roboto'] },
        whenHint: 'Доступна для шрифтов Geist и Roboto (переменной толщины). У «С засечками» есть только обычное и жирное начертания.',
      },
      { key: 'lineHeight', label: 'Межстрочный интервал', type: 'range', min: 1.3, max: 2.1, step: 0.1, unit: '', default: 1.6 },
      { key: 'columnWidth', label: 'Ширина колонки', type: 'range', min: 560, max: 1200, step: 20, unit: 'px', default: 820 },
      {
        key: 'textAlign', label: 'Выравнивание текста', type: 'choice', default: 'left',
        hint: '«По ширине» — строки ровные с обоих краёв. На узком экране лучше вместе с переносами: иначе между словами появляются широкие промежутки.',
        options: [['left', 'По левому краю'], ['justify', 'По ширине']],
      },
      {
        key: 'hyphens', label: 'Переносы слов', type: 'toggle', default: false,
        hint: 'Длинные слова переносятся по слогам — русские и английские по правилам своего языка. Меняется только вид: копирование, заметки и поиск работают как прежде.',
      },
      {
        key: 'flashTone', label: 'Подсветка найденного абзаца', type: 'choice', default: 'warm',
        hint: 'Абзац, к которому вы перешли (из поиска, заметки, ссылки), на мгновение подсвечивается и плавно гаснет.',
        options: [['warm', 'Тёплая'], ['cool', 'Холодная']],
      },
    ],
  },
  {
    title: 'Текст', section: 'Чтение', icon: 'book-open',
    scope: 'user',
    items: [
      {
        key: 'readLang', label: 'Язык чтения', type: 'choice', default: 'ru',
        hint: 'English — оригинал (издание Uversa Press) без сверочного блока; слой перевода при этом не показывается. Интерфейс остаётся русским.',
        options: [['ru', 'Русский'], ['en', 'English']],
      },
      {
        key: 'enMode', label: 'Английский оригинал', type: 'choice', default: 'full',
        hint: 'В свёрнутом виде видна одна строка; клик по ней раскрывает абзац.',
        when: { key: 'readLang', values: ['ru'] },
        whenHint: 'При чтении по-английски сверочного блока нет.',
        options: [['full', 'Полностью'], ['collapsed', 'Свёрнуто'], ['hidden', 'Скрыт']],
      },
      {
        key: 'textActions', label: 'Меню действий с текстом (телефон и планшет)', type: 'choice', default: 'top',
        hint: 'Где показывать «Комментарий · Обсудить · Перевести · Ссылка…» при выделении. Системное меню телефона появляется рядом с выделением, поэтому наше удобнее у края экрана. «Сбоку» — колонка у того края, где нет выделенного слова.',
        options: [['top', 'Сверху'], ['bottom', 'Снизу'], ['side', 'Сбоку (авто)']],
      },
      {
        key: 'placeMode', label: 'Место в книге: чтение и озвучка', type: 'choice', default: 'separate',
        hint: '«Раздельно» — у чтения глазами и у озвучки своё место и свой прогресс. «Общее» — одно место на оба режима: где остановились глазами, оттуда продолжит голос, и наоборот. Место переходит между вашими устройствами.',
        options: [['separate', 'Раздельно'], ['shared', 'Общее']],
      },
      { key: 'showRefs', label: 'Номера абзацев (5:1.3)', type: 'toggle', default: true },
      { key: 'showPageRefs', label: 'Номера страниц (62.3)', type: 'toggle', default: true },
      {
        key: 'termPairs', label: 'Пары терминов при наведении', type: 'toggle', default: true,
        hint: 'На компьютере: наведите мышь на имя или термин из глоссария — он и его пара в другом языке подсветятся оранжевым, другие упоминания в абзаце — голубым. Если английский скрыт или свёрнут, пара появится подсказкой.',
      },
      {
        key: 'dictHints', label: 'Подсказки словаря', type: 'toggle', default: false,
        hint: 'Имя или понятие, о котором есть статья в словаре книги, отмечено при первом упоминании в каждом разделе. Наведите на него мышь или коснитесь пальцем — откроется карточка: что это, коротко, и путь к статье.',
      },
      {
        key: 'dictMark', label: 'Вид отметки', type: 'choice', default: 'dot',
        options: [['dot', 'Точка над словом'], ['line', 'Тонкая линия']],
        when: { key: 'dictHints', values: [true] }, whenHint: 'Действует, когда включены подсказки словаря.',
      },
      {
        key: 'altNames', label: 'Названия по смыслу', type: 'toggle', default: false,
        hint: 'Салвингтон → Спасоград, Дивинингтон → Божеград… — как в переводе Общества Урантии Нью-Йорка. Отмечены пунктиром, под пальцем или мышью — название в переводе. Список — ниже, «Словарь названий».',
      },
    ],
  },
  {
    title: 'Заметки', section: 'Заметки и перевод', icon: 'notes',
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
    title: 'Перевод', section: 'Заметки и перевод', icon: 'translate',
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
    // every conversation alike: the chat list's chats, a paragraph's thread, comments on notes, proposals.
    // `swatches`: a choice of colours (web: round swatches; each theme has its own shade of a colour).
    title: 'Чаты', section: 'Интерфейс', icon: 'discuss',
    scope: 'user',
    items: [
      {
        key: 'chatBg', label: 'Фон', type: 'choice', default: 'default', swatches: true,
        options: [['default', 'Как в теме'], ['sky', 'Небо'], ['ice', 'Лёд'], ['mint', 'Мята'], ['sage', 'Шалфей'], ['lavender', 'Лаванда'], ['lilac', 'Сирень'], ['rose', 'Роза'], ['peach', 'Персик'], ['sand', 'Песок'], ['pearl', 'Жемчуг'], ['stone', 'Камень']],
      },
      {
        key: 'chatWallpaper', label: 'Узор на фоне', type: 'choice', default: 'none', swatches: true,
        options: [['none', 'Без узора'], ['dots', 'Точки'], ['grid', 'Сетка'], ['diagonal', 'Диагональ'], ['cross', 'Ромбы'], ['waves', 'Волны'], ['rings', 'Кольца']],
      },
      {
        key: 'chatBubble', label: 'Сообщения собеседников', type: 'choice', default: 'default', swatches: true,
        options: [['default', 'Как в теме'], ['white', 'Белые'], ['cream', 'Сливки'], ['mist', 'Туман'], ['mint', 'Мятные'], ['rose', 'Розовые'], ['lilac', 'Сиреневые'], ['sand', 'Песочные']],
      },
      {
        key: 'chatOwn', label: 'Мои сообщения', type: 'choice', default: 'default', swatches: true,
        options: [['default', 'Как в теме'], ['blue', 'Голубые'], ['sky', 'Небесные'], ['green', 'Зелёные'], ['mint', 'Мятные'], ['lavender', 'Лавандовые'], ['rose', 'Розовые'], ['peach', 'Персиковые'], ['yellow', 'Жёлтые']],
      },
      {
        key: 'chatFontSize', label: 'Размер шрифта сообщений', type: 'range', min: 12, max: 24, step: 1, unit: 'px', default: 15,
        hint: 'Во всех чатах одинаково; абзацы книги в них — чуть крупнее. На телефоне и планшете — также двумя пальцами в любом чате.',
      },
      {
        key: 'chatFont', label: 'Шрифт сообщений', type: 'choice', default: 'sans',
        options: [['sans', 'Как в интерфейсе'], ['serif', 'Как в книге']],
      },
      { key: 'chatRadius', label: 'Скругление сообщений', type: 'range', min: 4, max: 22, step: 1, unit: 'px', default: 14 },
    ],
  },
  {
    // its page is an editor of its own (web: NavEditor), not the schema form
    title: 'Панели', section: 'Интерфейс', icon: 'dots',
    scope: 'user',
    items: [
      { key: 'phoneNav', label: 'Разделы нижней панели', type: 'text', maxLength: 80, default: 'search,notes,listen,chat', hidden: true },
      // «Что нового»: the date of the newest entry seen (the bell offers the newer ones; the same on every device)
      { key: 'whatsNewSeen', label: 'Что нового: просмотрено по', type: 'text', maxLength: 10, default: '', hidden: true },
      // the search's way, chosen above its field (SearchPanel): by the words, by meaning, both
      {
        key: 'searchMode', label: 'Поиск', type: 'choice', default: 'words', hidden: true,
        options: [['words', 'По словам'], ['meaning', 'По смыслу'], ['hybrid', 'Гибридный']],
      },
      // the tasks' kanban: its cards' size, changed by pinching two fingers over it (TasksPage)
      { key: 'kanbanFontSize', label: 'Размер карточек канбана', type: 'range', min: 10, max: 20, step: 1, unit: 'px', default: 14, hidden: true },
      // …and of the tasks' list
      { key: 'taskListFontSize', label: 'Размер задач в списке', type: 'range', min: 11, max: 22, step: 1, unit: 'px', default: 15, hidden: true },
      {
        key: 'navStyle', label: 'Вид нижней панели', type: 'choice', default: 'bar',
        hint: 'Air glass — панель парит над текстом, со скруглёнными краями; линия прогресса чтения встроена в неё сверху. Плеер — часть той же формы, его настройки раскрывают её вверх.',
        options: [['bar', 'Обычная'], ['air', 'Air glass']],
      },
      {
        key: 'glassBars', label: 'Стеклянные панели', type: 'toggle', default: false,
        hint: 'Нижняя панель и плеер полупрозрачны: текст книги размыто просвечивает сквозь них. Шапка остаётся сплошной — одного цвета с системной строкой.',
      },
      { key: 'navLabels', label: 'Подписи разделов в нижней панели', type: 'toggle', default: true, hint: 'Без подписей панель ниже, остаются одни значки.' },
      {
        key: 'barsAutoHide', label: 'Прятать панели при прокрутке', type: 'toggle', default: true,
        hint: 'Листаете вниз — шапка и нижняя панель уходят, вверх или касание текста — возвращаются. Выключено — панели всегда на месте.',
      },
    ],
  },
  {
    title: 'Цвета закладок', section: 'Пространство', icon: 'bookmark',
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
  // Sepia was replaced by Paper; then Light and Dark were dropped for Paper and Graphite.
  if (src.theme === 'sepia' || src.theme === 'light') src.theme = 'paper';
  if (src.theme === 'dark') src.theme = 'graphite';
  // "Air glass 2" became the one Air glass.
  if (src.navStyle === 'air2') src.navStyle = 'air';
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
