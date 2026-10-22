// @ts-check
// The database's schema, as the steps that made it (server/db.js applies the ones not applied yet).

/**
 * Migrations run in order; PRAGMA user_version stores how many have been applied.
 * Never edit an applied migration — append a new one.
 */
export const MIGRATIONS = [
  // 1: book text. Re-imported wholesale; user data must reference paragraphs by `ref`, not rowid.
  `
  CREATE TABLE parts (
    id          INTEGER PRIMARY KEY,
    title_ru    TEXT NOT NULL,
    title_en    TEXT NOT NULL,
    subtitle_ru TEXT
  );
  CREATE TABLE papers (
    id       INTEGER PRIMARY KEY,
    part_id  INTEGER NOT NULL REFERENCES parts(id),
    title_ru TEXT NOT NULL,
    title_en TEXT NOT NULL
  );
  CREATE TABLE sections (
    paper_id INTEGER NOT NULL REFERENCES papers(id),
    num      INTEGER NOT NULL,
    title_ru TEXT,
    title_en TEXT,
    PRIMARY KEY (paper_id, num)
  ) WITHOUT ROWID;
  CREATE TABLE paragraphs (
    ref         TEXT PRIMARY KEY,
    seq         INTEGER NOT NULL UNIQUE,
    paper_id    INTEGER NOT NULL REFERENCES papers(id),
    section_num INTEGER NOT NULL,
    num         INTEGER NOT NULL,
    page_ref    TEXT NOT NULL,
    html_ru     TEXT NOT NULL,
    html_en     TEXT NOT NULL,
    plain_ru    TEXT NOT NULL,
    plain_en    TEXT NOT NULL
  );
  CREATE INDEX paragraphs_paper ON paragraphs (paper_id, seq);
  `,
  // 2: workspaces. Everything user-made (settings now; annotations, tags later) belongs to one.
  // Users and membership arrive together with authentication.
  `
  CREATE TABLE workspaces (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('personal', 'group')),
    settings   TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO workspaces (id, name, kind) VALUES (1, 'Личное', 'personal');
  `,
  // 3: full-text search (pre-tokenized by server/search/text.js; rowid = paragraphs.seq),
  // saved queries and search history.
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE VIRTUAL TABLE search_fts USING fts5(
    ru_exact, ru_stem, en_exact, en_stem,
    content = '', columnsize = 0, tokenize = 'unicode61 remove_diacritics 0'
  );
  CREATE TABLE saved_queries (
    id           INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    query        TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX saved_queries_workspace ON saved_queries (workspace_id);
  CREATE TABLE search_history (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    query        TEXT NOT NULL,
    used_at      TEXT NOT NULL DEFAULT (datetime('now')),
    uses         INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (workspace_id, query)
  ) WITHOUT ROWID;
  `,
  // 4: annotations (highlights, comment threads, bookmarks) and tags.
  // Paragraphs are referenced by `ref` text, not a foreign key: book tables are re-imported.
  `
  CREATE TABLE annotations (
    id           INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    author_id    INTEGER,
    ref          TEXT NOT NULL,
    lang         TEXT CHECK (lang IN ('ru', 'en')),
    start_pos    INTEGER,
    end_pos      INTEGER,
    quote        TEXT,
    color        TEXT CHECK (color IN ('yellow', 'green', 'blue', 'pink', 'purple')),
    bookmark     INTEGER NOT NULL DEFAULT 0,
    title        TEXT,
    resolved_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    -- lang/start/end are all set (text fragment) or all NULL (whole paragraph)
    CHECK ((lang IS NULL) = (start_pos IS NULL) AND (start_pos IS NULL) = (end_pos IS NULL))
  );
  CREATE INDEX annotations_workspace_ref ON annotations (workspace_id, ref);
  CREATE TABLE comments (
    id            INTEGER PRIMARY KEY,
    annotation_id INTEGER NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    author_id     INTEGER,
    body          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX comments_annotation ON comments (annotation_id, id);
  CREATE TABLE tags (
    id           INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,          -- as typed, "/" separates levels: космология/Хавона
    name_key     TEXT NOT NULL,          -- lower case, for case-insensitive uniqueness (NOCASE is ASCII-only)
    color        TEXT,
    description  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workspace_id, name_key)
  );
  CREATE TABLE annotation_tags (
    annotation_id INTEGER NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (annotation_id, tag_id)
  ) WITHOUT ROWID;
  CREATE INDEX annotation_tags_tag ON annotation_tags (tag_id);
  `,
  // 5: users, sessions, invitations, workspace membership, personal settings, personal history.
  // Existing data (workspace 1, authorless notes) is claimed by the first admin (scripts/admin.js init).
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL,
    username_key  TEXT NOT NULL UNIQUE,
    display_name  TEXT,
    password_hash TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX sessions_user ON sessions (user_id);
  -- kind 'account': creates a user (optionally joining workspace_id with role);
  -- kind 'reset': sets a new password for user_id.
  CREATE TABLE invites (
    token_hash   TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('account', 'reset')),
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    role         TEXT CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
    is_admin     INTEGER NOT NULL DEFAULT 0,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL,
    used_at      TEXT
  ) WITHOUT ROWID;
  CREATE TABLE workspace_members (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
    joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id)
  ) WITHOUT ROWID;
  CREATE INDEX workspace_members_user ON workspace_members (user_id);
  ALTER TABLE workspaces ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  CREATE TABLE user_settings (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    settings     TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (user_id, workspace_id)
  ) WITHOUT ROWID;
  CREATE TABLE search_history_v2 (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    query        TEXT NOT NULL,
    used_at      TEXT NOT NULL DEFAULT (datetime('now')),
    uses         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (workspace_id, user_id, query)
  );
  INSERT INTO search_history_v2 (workspace_id, user_id, query, used_at, uses)
    SELECT workspace_id, NULL, query, used_at, uses FROM search_history;
  DROP TABLE search_history;
  ALTER TABLE search_history_v2 RENAME TO search_history;
  `,
  // 6: collective translation — the platform-wide public layer: proposals for better wording of
  // a fragment of the Russian text (offsets in paragraphs.plain_ru), their versions and votes,
  // and public paragraph threads (messages, plus events such as "published", "approved").
  `
  ALTER TABLE users ADD COLUMN is_translator INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN is_coordinator INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE proposals (
    id            INTEGER PRIMARY KEY,
    ref           TEXT NOT NULL,
    start_pos     INTEGER NOT NULL,
    end_pos       INTEGER NOT NULL,
    original      TEXT NOT NULL,
    author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'voting', 'approved', 'rejected', 'superseded')),
    version       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    published_at  TEXT,
    closes_at     TEXT,
    decided_at    TEXT,
    decision_note TEXT,
    superseded_by INTEGER REFERENCES proposals(id) ON DELETE SET NULL
  );
  CREATE INDEX proposals_ref ON proposals (ref, status);
  CREATE INDEX proposals_status ON proposals (status, closes_at);
  CREATE TABLE proposal_versions (
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    text        TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (proposal_id, version)
  ) WITHOUT ROWID;
  CREATE TABLE votes (
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value       INTEGER NOT NULL CHECK (value IN (-1, 0, 1)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (proposal_id, version, user_id)
  ) WITHOUT ROWID;
  CREATE TABLE public_messages (
    id          INTEGER PRIMARY KEY,
    ref         TEXT NOT NULL,
    proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'event')),
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body        TEXT NOT NULL,
    hidden_at   TEXT,
    hidden_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX public_messages_ref ON public_messages (ref, id);
  CREATE INDEX public_messages_proposal ON public_messages (proposal_id, id);
  `,
  // 7: in-app notifications. A user follows a paragraph thread automatically by taking part in it
  // (message, proposal, vote); thread_follows stores explicit choices: 1 = follow, 0 = muted.
  // Everything up to notif_seen_id counts as read (the list is read as a whole when opened).
  `
  CREATE TABLE thread_follows (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ref        TEXT NOT NULL,
    follow     INTEGER NOT NULL CHECK (follow IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, ref)
  ) WITHOUT ROWID;
  ALTER TABLE users ADD COLUMN notif_seen_id INTEGER NOT NULL DEFAULT 0;
  UPDATE users SET notif_seen_id = (SELECT coalesce(max(id), 0) FROM public_messages);
  CREATE INDEX votes_user ON votes (user_id);
  CREATE INDEX proposals_author ON proposals (author_id);
  CREATE INDEX public_messages_author ON public_messages (author_id);
  `,
  // 8: translation glossary, kept by coordinators. `avoid`: undesirable Russian variants, one per line.
  `
  CREATE TABLE glossary (
    id         INTEGER PRIMARY KEY,
    en         TEXT NOT NULL,
    ru         TEXT NOT NULL,
    avoid      TEXT NOT NULL DEFAULT '',
    note       TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX glossary_en ON glossary (lower(en));
  `,
  // 9: collections ("подборки") — a hand-ordered list of paragraphs (or ranges), notes and text
  // blocks, kept in a workspace. `shared`: every user of the platform may read it, subscribe or copy.
  // Items: kind 'para' (ref … ref_end), 'note' (annotation of the same workspace), 'text' (body,
  // `heading` = a section title). `body` of para/note items is the compiler's comment.
  `
  CREATE TABLE collections (
    id           INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    shared       INTEGER NOT NULL DEFAULT 0,
    author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    copied_from  INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX collections_ws ON collections (workspace_id);
  CREATE TABLE collection_items (
    id            INTEGER PRIMARY KEY,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    pos           INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('para', 'note', 'text')),
    ref           TEXT,
    ref_end       TEXT,
    annotation_id INTEGER REFERENCES annotations(id) ON DELETE CASCADE,
    body          TEXT,
    heading       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX collection_items_order ON collection_items (collection_id, pos);
  CREATE TABLE collection_subscriptions (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, collection_id)
  ) WITHOUT ROWID;
  `,
  // 10: personal tasks — each user's own, shared by all their workspaces. A task may point to a
  // place in the book (paragraph or range), a note or a collection. `due`: a calendar date
  // (YYYY-MM-DD, the user's own day); `tags`: JSON array of labels.
  `
  CREATE TABLE task_lists (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    emoji      TEXT,
    pos        INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX task_lists_user ON task_lists (user_id, pos);
  CREATE TABLE tasks (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id       INTEGER REFERENCES task_lists(id) ON DELETE SET NULL,
    title         TEXT NOT NULL,
    notes         TEXT,
    status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    important     INTEGER NOT NULL DEFAULT 0,
    due           TEXT,
    tags          TEXT NOT NULL DEFAULT '[]',
    ref           TEXT,
    ref_end       TEXT,
    annotation_id INTEGER REFERENCES annotations(id) ON DELETE SET NULL,
    collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    pos           INTEGER NOT NULL DEFAULT 0,
    done_at       TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX tasks_user ON tasks (user_id, status, pos);
  CREATE TABLE subtasks (
    id      INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title   TEXT NOT NULL,
    done    INTEGER NOT NULL DEFAULT 0,
    pos     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX subtasks_task ON subtasks (task_id, pos);
  `,
  // 11: chat. Every conversation of the public layer lives in public_messages, keyed by `ref`:
  // a paragraph ("5:1.2"), a channel ("chan:3") or a group workspace ("ws:2", members only).
  // Replies, reactions, @mentions and read marks work the same for all of them.
  `
  ALTER TABLE public_messages ADD COLUMN reply_to INTEGER REFERENCES public_messages(id) ON DELETE SET NULL;
  CREATE TABLE channels (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO channels (title, description) VALUES ('Общий', 'Обо всём, что касается работы с книгой');
  CREATE TABLE message_reactions (
    message_id INTEGER NOT NULL REFERENCES public_messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id, emoji)
  ) WITHOUT ROWID;
  CREATE TABLE mentions (
    message_id INTEGER NOT NULL REFERENCES public_messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
  ) WITHOUT ROWID;
  CREATE INDEX mentions_user ON mentions (user_id);
  CREATE TABLE chat_reads (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat         TEXT NOT NULL,
    last_read_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, chat)
  ) WITHOUT ROWID;
  `,
  // 12: the pronunciation dictionary for reading aloud, shared by everybody (coordinators edit).
  // `written` matches the start of a word (so every case form of a name is caught); `spoken` is
  // what the voice gets instead, a stress as U+0301 after the vowel.
  `
  CREATE TABLE pronunciations (
    id         INTEGER PRIMARY KEY,
    lang       TEXT NOT NULL CHECK (lang IN ('ru', 'en')),
    written    TEXT NOT NULL,
    spoken     TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX pronunciations_written ON pronunciations (lang, lower(written));
  `,
  // 13: a paragraph in a collection may point at a fragment of itself (shown highlighted and quoted,
  // `body` is then the compiler's explanation of it); an item can be folded to its fragment alone,
  // and a whole collection can show fragments only.
  `
  ALTER TABLE collection_items ADD COLUMN frag_lang TEXT CHECK (frag_lang IN ('ru', 'en'));
  ALTER TABLE collection_items ADD COLUMN frag_start INTEGER;
  ALTER TABLE collection_items ADD COLUMN frag_end INTEGER;
  ALTER TABLE collection_items ADD COLUMN quote TEXT;
  ALTER TABLE collection_items ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE collections ADD COLUMN fragments_only INTEGER NOT NULL DEFAULT 0;
  `,
  // 14: where each reader stopped — reading (the first paragraph on screen) and listening (the sentence
  // the voice was at) — so it carries over between devices (later: context for the Book as a companion).
  // `key`: a paragraph ref ("5:1.3") or a title ("h0", "h3") of `paper`; `s`: the sentence (listening);
  // `at`: the device's time in ms (the latest wins); `device`: a random id of the browser, `device_kind`
  // 'phone' | 'computer' for the "on your phone you stopped at…" hint.
  `
  CREATE TABLE reading_places (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('read', 'listen')),
    paper       INTEGER NOT NULL,
    key         TEXT NOT NULL,
    s           INTEGER NOT NULL DEFAULT 0,
    lang        TEXT NOT NULL,
    progress    REAL,
    device      TEXT NOT NULL,
    device_kind TEXT NOT NULL,
    at          INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  ) WITHOUT ROWID;
  `,
  // 15: one conversation model (VISION.md, principle 2). Comments on notes move into public_messages
  // as the conversation "note:<annotation id>" — with replies, reactions, @mentions, live updates and
  // notifications like every other chat; access stays with the note's workspace. A deleted note takes
  // its conversation along. The moved comments are not news: everybody's "seen" mark goes past them.
  `
  INSERT INTO public_messages (ref, author_id, body, created_at, updated_at)
    SELECT 'note:' || c.annotation_id, CASE WHEN c.author_id IN (SELECT id FROM users) THEN c.author_id END,
           c.body, c.created_at, c.updated_at
    FROM comments c ORDER BY c.id;
  DROP TABLE comments;
  UPDATE users SET notif_seen_id = max(notif_seen_id, (SELECT coalesce(max(id), 0) FROM public_messages));
  CREATE TRIGGER annotation_conversation AFTER DELETE ON annotations BEGIN
    DELETE FROM public_messages WHERE ref = 'note:' || old.id;
  END;
  `,
  // 16: a message in a collection — a thought from a conversation kept as it was said (VISION.md,
  // principle 4): a snapshot of its text (`quote`), author and time, the conversation it came from
  // (`msg_chat`) and its place in the book (`ref`), if any. The kind list is a CHECK, so the table is rebuilt.
  `
  CREATE TABLE collection_items_new (
    id            INTEGER PRIMARY KEY,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    pos           INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('para', 'note', 'text', 'message')),
    ref           TEXT,
    ref_end       TEXT,
    annotation_id INTEGER REFERENCES annotations(id) ON DELETE CASCADE,
    body          TEXT,
    heading       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    frag_lang     TEXT CHECK (frag_lang IN ('ru', 'en')),
    frag_start    INTEGER,
    frag_end      INTEGER,
    quote         TEXT,
    collapsed     INTEGER NOT NULL DEFAULT 0,
    msg_id        INTEGER,
    msg_author    TEXT,
    msg_at        TEXT,
    msg_chat      TEXT
  );
  INSERT INTO collection_items_new (id, collection_id, pos, kind, ref, ref_end, annotation_id, body, heading, created_at,
                                    frag_lang, frag_start, frag_end, quote, collapsed)
    SELECT id, collection_id, pos, kind, ref, ref_end, annotation_id, body, heading, created_at,
           frag_lang, frag_start, frag_end, quote, collapsed FROM collection_items;
  DROP TABLE collection_items;
  ALTER TABLE collection_items_new RENAME TO collection_items;
  CREATE INDEX collection_items_order ON collection_items (collection_id, pos);
  `,
  // 17: a task made from a message ("В задачи") keeps the way back to it: the message and its conversation.
  `
  ALTER TABLE tasks ADD COLUMN message_id INTEGER;
  ALTER TABLE tasks ADD COLUMN message_chat TEXT;
  `,
  // 18: e-mail for restoring a forgotten password. Optional; it counts only once confirmed by a link
  // sent to it (email_tokens: one-time, for the address it was sent to). Several accounts may share an
  // address (a family): "Забыли пароль" by e-mail writes to each of them.
  `
  ALTER TABLE users ADD COLUMN email TEXT;
  ALTER TABLE users ADD COLUMN email_key TEXT;
  ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX users_email ON users (email_key);
  CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_at    TEXT
  ) WITHOUT ROWID;
  `,
  // 19: one pinned message per conversation, shown under its header. Pins it whoever made the chat
  // (a channel's creator, a workspace's owner, a note's author) or an administrator.
  `
  CREATE TABLE chat_pins (
    chat       TEXT PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES public_messages(id) ON DELETE CASCADE,
    pinned_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    pinned_at  TEXT NOT NULL DEFAULT (datetime('now'))
  ) WITHOUT ROWID;
  `,
  // 20: chats each user pins at the top of their chat list (up to 10), in their own order.
  `
  CREATE TABLE pinned_chats (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat    TEXT NOT NULL,
    pos     INTEGER NOT NULL,
    PRIMARY KEY (user_id, chat)
  ) WITHOUT ROWID;
  `,
  // 21: tasks are sorted by tags (#words in the title and the tags of the details), not by lists:
  // the lists go. (Tags are kept in lower case from now on; older ones are read so — shared/tasktags.js.)
  `
  ALTER TABLE tasks DROP COLUMN list_id;
  DROP TABLE task_lists;
  `,
  // 22: an administrator's mark on a message — take / work / done (a bug or an idea from users and
  // where it stands); found by a filter of the chat list. Its author is told by a row of the hidden
  // conversation "mark:<chat>" (kind 'event', reply_to = the message) with a mention of them — the way
  // every notification goes.
  `
  ALTER TABLE public_messages ADD COLUMN mark TEXT CHECK (mark IN ('take', 'work', 'done'));
  ALTER TABLE public_messages ADD COLUMN mark_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE public_messages ADD COLUMN mark_at TEXT;
  CREATE INDEX public_messages_mark ON public_messages (mark, mark_at) WHERE mark IS NOT NULL;
  `,
  // 23: the Book's voice (VISION.md, principle 1: the Book is a participant). The Book is a user of its
  // own kind (`is_agent`: it never signs in; created by server/bookvoice.js) who writes in the "Голос Книги" channel (`voice`: only it
  // writes there); each post is also put into the channel's discussion (`discussion`, the general chat),
  // where people talk about it — the post keeps the way to it (`linked_id`). A message may be anchored to
  // a place in the book (`anchor_*`, the one anchor of the platform: ref, lang, start, end) — the Book's
  // posts are, and later its answers. `chat_mutes`: a chat whose news a user does not want counted.
  `
  ALTER TABLE users ADD COLUMN is_agent INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE channels ADD COLUMN voice INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE channels ADD COLUMN discussion TEXT;
  INSERT INTO channels (title, description, voice, discussion)
    VALUES ('Голос Книги', 'Каждый день Книга говорит сама — абзацем со своих страниц. Обсуждение — в «Общем».', 1,
            'chan:' || (SELECT min(id) FROM channels));
  ALTER TABLE public_messages ADD COLUMN anchor_ref TEXT;
  ALTER TABLE public_messages ADD COLUMN anchor_lang TEXT CHECK (anchor_lang IN ('ru', 'en'));
  ALTER TABLE public_messages ADD COLUMN anchor_start INTEGER;
  ALTER TABLE public_messages ADD COLUMN anchor_end INTEGER;
  ALTER TABLE public_messages ADD COLUMN linked_id INTEGER REFERENCES public_messages(id) ON DELETE SET NULL;
  CREATE TABLE chat_mutes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat    TEXT NOT NULL,
    PRIMARY KEY (user_id, chat)
  ) WITHOUT ROWID;
  `,
  // 24: integrations. The English text is kept in step with its source (the Uversa Press edition through
  // the ubsite API, server/textsync.js); `uf_ref` — the paragraph's number as the Urantia Foundation counts
  // it, which every translation follows (107 paragraphs differ). `sync_runs`: the report of each run.
  `
  ALTER TABLE paragraphs ADD COLUMN uf_ref TEXT;
  CREATE INDEX paragraphs_uf_ref ON paragraphs (uf_ref);
  CREATE TABLE sync_runs (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    trigger     TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ok', 'unchanged', 'error')),
    version_from INTEGER,
    version_to  INTEGER,
    summary     TEXT NOT NULL DEFAULT '{}',
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
  `,
  // 25: analytics. A row per person per minute they were active in the app (a tab in view with a tap,
  // scroll or key in the last 2 minutes, or the voice reading): the section they were in, whether they
  // were reading the book, whether the voice was reading to them. Tabs and devices of one minute make one
  // row, so time is not counted twice. Sessions are runs of minutes with gaps under 30 minutes.
  // `minute`: Unix time in minutes (UTC).
  `
  CREATE TABLE activity_minutes (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    minute    INTEGER NOT NULL,
    section   TEXT NOT NULL,
    reading   INTEGER NOT NULL DEFAULT 0,
    listening INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, minute)
  ) WITHOUT ROWID;
  CREATE INDEX activity_minutes_minute ON activity_minutes (minute);
  `,
  // 26: a part's introduction (who sponsored it) in English too — the Uversa Press text's `sponsor`;
  // shown as the part's title page before its first paper. The Russian one is `subtitle_ru`.
  `
  ALTER TABLE parts ADD COLUMN subtitle_en TEXT;
  `,
  // 27: titles are plain text. Some Russian section titles came from the source with its line breaks
  // ("…наводнений<br />Период кораллов…"): a break becomes ". " (after a dash — a space).
  `
  UPDATE sections SET title_ru = replace(replace(replace(title_ru, ' – <br />', ' – '), '<br /> ', '. '), '<br />', '. ')
    WHERE title_ru LIKE '%<br%';
  UPDATE papers SET title_ru = replace(replace(replace(title_ru, ' – <br />', ' – '), '<br /> ', '. '), '<br />', '. ')
    WHERE title_ru LIKE '%<br%';
  `,
  // 28: analytics — what the app was opened on in that minute: a phone (or tablet) or a computer, the
  // installed app or a browser ('' — minutes from before this was recorded).
  `
  ALTER TABLE activity_minutes ADD COLUMN device TEXT NOT NULL DEFAULT '';
  `,
  // 29: a listening place in a recording: its file and the second in it (the recording goes on from
  // there, not from the paragraph's estimated start). Null — heard by speech synthesis.
  `
  ALTER TABLE reading_places ADD COLUMN file TEXT;
  ALTER TABLE reading_places ADD COLUMN t REAL;
  `,
  // 30: the dictionary of names (server/api/aliases.js): a name as the translation writes it and its
  // rendering by meaning, shown in its place to those who turn it on. Seeded with the names the
  // USGNY translation renders by meaning.
  `
  CREATE TABLE name_aliases (
    id         INTEGER PRIMARY KEY,
    written    TEXT NOT NULL UNIQUE,
    alias      TEXT NOT NULL,
    forms      TEXT,
    note       TEXT,
    source     TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO name_aliases (written, alias, forms, note, source) VALUES
    ('Салвингтон', 'Спасоград', NULL, 'Salvington — от salvation, «спасение»: столица локальной вселенной Небадон.', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Дивинингтон', 'Божеград', NULL, 'Divinington — от divine, «божественный»: райская сфера Отца.', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Сонарингтон', 'Сыноград', NULL, 'Sonarington — от Son, «Сын»: райская сфера Вечного Сына.', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Спиритингтон', 'Духоград', NULL, 'Spiritington — от Spirit, «Дух»: райская сфера Бесконечного Духа.', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Вайсджерингтон', 'Наместникоград', NULL, 'Vicegerington — от vicegerent, «наместник».', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Солитарингтон', 'Град Одиночности', NULL, 'Solitarington — от solitary, «одинокий».', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Серафингтон', 'Серафимоград', NULL, 'Seraphington — сфера серафимов.', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Асендингтон', 'Восходоград', NULL, 'Ascendington — от ascend, «восходить».', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017'),
    ('Декаполис', 'Десятиградие', '{"Декаполис":"Десятиградие","Декаполиса":"Десятиградия","Декаполису":"Десятиградию","Декаполисом":"Десятиградием","Декаполисе":"Десятиградии"}', 'Decapolis — «Десять городов»; так и в Синодальном переводе Библии.', 'Перевод Общества Урантии Большого Нью-Йорка (USGNY), 2017');
  `,
  // 31: one exchange with the server (the device's outgoing queue, web/src/lib/outbox.svelte.js).
  // `ops`: each change comes with its own id; the answer is kept, so a change sent again (the network
  // broke before the answer arrived) is answered the same and not done twice (server/ops.js). Kept 30 days.
  // `written_at`: when a message was written, if earlier than it reached the server (written without a
  // network, sent later); shown as its time.
  `
  CREATE TABLE ops (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    op_id      TEXT NOT NULL,
    status     INTEGER NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, op_id)
  ) WITHOUT ROWID;
  CREATE INDEX ops_created ON ops (created_at);
  ALTER TABLE public_messages ADD COLUMN written_at TEXT;
  `,
  // 32: a note's own id given by the device that made it (a UUID): a note written without a network is
  // shown, tagged, commented on or deleted by it before the server has numbered it (its address in the
  // API: "u-<uid>"). Notes from before have none.
  `
  ALTER TABLE annotations ADD COLUMN uid TEXT;
  CREATE UNIQUE INDEX annotations_uid ON annotations (workspace_id, uid) WHERE uid IS NOT NULL;
  `,
  // 33: the journal of what happened on people's devices (web/src/lib/log.js, server/clientlog.js) — to see
  // what really went on when something failed. No texts of notes, messages or searches: screens, button
  // names, failures, timings. `session`: one opening of the app (a tab); `device`: phone/computer, app or
  // browser, version. Kept 30 days.
  `
  CREATE TABLE client_events (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session     TEXT NOT NULL,
    device      TEXT NOT NULL,
    at          TEXT NOT NULL,
    level       TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    data        TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX client_events_user ON client_events (user_id, at);
  CREATE INDEX client_events_at ON client_events (at);
  `,
  // 34: the feed of changes (server/feed.js): what changed in a workspace, in order — a device asks "what
  // changed after N?" and keeps the workspace's notes on itself (web/src/lib/feed.js). Written by
  // triggers, so no path that changes a note can forget it: the note itself, its tags (and a tag's
  // rename), its comments and their reactions. Kept 60 days; a device further behind gets everything anew.
  `
  CREATE TABLE changes (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL,
    entity       TEXT NOT NULL,
    entity_id    INTEGER NOT NULL,
    at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX changes_ws ON changes (workspace_id, seq);
  CREATE TRIGGER changes_note_ins AFTER INSERT ON annotations BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) VALUES (NEW.workspace_id, 'note', NEW.id);
  END;
  CREATE TRIGGER changes_note_upd AFTER UPDATE ON annotations BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) VALUES (NEW.workspace_id, 'note', NEW.id);
  END;
  CREATE TRIGGER changes_note_del AFTER DELETE ON annotations BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) VALUES (OLD.workspace_id, 'note', OLD.id);
  END;
  CREATE TRIGGER changes_note_tag_ins AFTER INSERT ON annotation_tags BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) SELECT workspace_id, 'note', id FROM annotations WHERE id = NEW.annotation_id;
  END;
  CREATE TRIGGER changes_note_tag_del AFTER DELETE ON annotation_tags BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) SELECT workspace_id, 'note', id FROM annotations WHERE id = OLD.annotation_id;
  END;
  CREATE TRIGGER changes_tag_rename AFTER UPDATE OF name ON tags BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) SELECT NEW.workspace_id, 'note', annotation_id FROM annotation_tags WHERE tag_id = NEW.id;
  END;
  CREATE TRIGGER changes_comment_ins AFTER INSERT ON public_messages WHEN NEW.ref LIKE 'note:%' BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) SELECT workspace_id, 'note', id FROM annotations WHERE id = CAST(substr(NEW.ref, 6) AS INTEGER);
  END;
  CREATE TRIGGER changes_comment_upd AFTER UPDATE ON public_messages WHEN NEW.ref LIKE 'note:%' BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) SELECT workspace_id, 'note', id FROM annotations WHERE id = CAST(substr(NEW.ref, 6) AS INTEGER);
  END;
  CREATE TRIGGER changes_comment_del AFTER DELETE ON public_messages WHEN OLD.ref LIKE 'note:%' BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id) SELECT workspace_id, 'note', id FROM annotations WHERE id = CAST(substr(OLD.ref, 6) AS INTEGER);
  END;
  CREATE TRIGGER changes_reaction_ins AFTER INSERT ON message_reactions BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id)
      SELECT a.workspace_id, 'note', a.id FROM public_messages m JOIN annotations a ON a.id = CAST(substr(m.ref, 6) AS INTEGER)
      WHERE m.id = NEW.message_id AND m.ref LIKE 'note:%';
  END;
  CREATE TRIGGER changes_reaction_del AFTER DELETE ON message_reactions BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id)
      SELECT a.workspace_id, 'note', a.id FROM public_messages m JOIN annotations a ON a.id = CAST(substr(m.ref, 6) AS INTEGER)
      WHERE m.id = OLD.message_id AND m.ref LIKE 'note:%';
  END;
  `,
  // 35: personal tasks in the feed and in the queue: a change of a task or its subtasks is a change of
  // the task for its owner (changes.user_id; workspace 0 — tasks belong to a person, not a workspace);
  // a task's own id from the device that made it (as notes, migration 32).
  `
  ALTER TABLE changes ADD COLUMN user_id INTEGER;
  CREATE INDEX changes_user ON changes (user_id, seq) WHERE user_id IS NOT NULL;
  ALTER TABLE tasks ADD COLUMN uid TEXT;
  CREATE UNIQUE INDEX tasks_uid ON tasks (user_id, uid) WHERE uid IS NOT NULL;
  CREATE TRIGGER changes_task_ins AFTER INSERT ON tasks BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id, user_id) VALUES (0, 'task', NEW.id, NEW.user_id);
  END;
  CREATE TRIGGER changes_task_upd AFTER UPDATE ON tasks BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id, user_id) VALUES (0, 'task', NEW.id, NEW.user_id);
  END;
  CREATE TRIGGER changes_task_del AFTER DELETE ON tasks BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id, user_id) VALUES (0, 'task', OLD.id, OLD.user_id);
  END;
  CREATE TRIGGER changes_subtask_ins AFTER INSERT ON subtasks BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id, user_id) SELECT 0, 'task', id, user_id FROM tasks WHERE id = NEW.task_id;
  END;
  CREATE TRIGGER changes_subtask_upd AFTER UPDATE ON subtasks BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id, user_id) SELECT 0, 'task', id, user_id FROM tasks WHERE id = NEW.task_id;
  END;
  CREATE TRIGGER changes_subtask_del AFTER DELETE ON subtasks BEGIN
    INSERT INTO changes (workspace_id, entity, entity_id, user_id) SELECT 0, 'task', id, user_id FROM tasks WHERE id = OLD.task_id;
  END;
  `,
  // 36: analytics — the system of the device a minute was spent on (android, ios, other; '' — before it was recorded)
  `
  ALTER TABLE activity_minutes ADD COLUMN os TEXT NOT NULL DEFAULT '';
  `,
  // 37: the dictionary of the book (server/features/dictionary/): an article on a person, a place, a
  // concept… — its names (the glossary's entries: where the name stands in the text is found by them), a
  // short and a full description in each language, the main places chosen by a coordinator, the related
  // articles. A draft is seen by the coordinators only.
  `
  CREATE TABLE dict_articles (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL DEFAULT 'concept' CHECK (kind IN ('person', 'being', 'place', 'concept', 'event')),
    name_ru    TEXT NOT NULL,
    name_en    TEXT NOT NULL DEFAULT '',
    brief_ru   TEXT NOT NULL DEFAULT '',
    brief_en   TEXT NOT NULL DEFAULT '',
    body_ru    TEXT NOT NULL DEFAULT '',
    body_en    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE dict_names (
    article_id  INTEGER NOT NULL REFERENCES dict_articles(id) ON DELETE CASCADE,
    glossary_id INTEGER NOT NULL UNIQUE REFERENCES glossary(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, glossary_id)
  );
  CREATE TABLE dict_places (
    article_id INTEGER NOT NULL REFERENCES dict_articles(id) ON DELETE CASCADE,
    ref        TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    pos        INTEGER NOT NULL,
    PRIMARY KEY (article_id, ref)
  );
  CREATE TABLE dict_links (
    from_id INTEGER NOT NULL REFERENCES dict_articles(id) ON DELETE CASCADE,
    to_id   INTEGER NOT NULL REFERENCES dict_articles(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL DEFAULT 'related' CHECK (kind IN ('part', 'belongs', 'related')),
    PRIMARY KEY (from_id, to_id),
    CHECK (from_id != to_id)
  );
  `,
  // 38: a large number's groups of digits ("611 121") kept together in the shown Russian text: the space
  // between them non-breaking (shared/typography.js; the importers do the same). The plain text (search,
  // offsets) stays as it was: a character for a character.
  `
  UPDATE paragraphs SET html_ru = keep_numbers(html_ru) WHERE plain_ru GLOB '*[0-9] [0-9][0-9][0-9]*';
  `,
  // 39: the AI's connections (server/ai.js): whose ('app' — the application's own, the shared answers; later
  // 'user:<id>' — a reader's own), which service, its key — on the server only, never sent to a browser.
  `
  CREATE TABLE ai_keys (
    owner      TEXT PRIMARY KEY,
    provider   TEXT NOT NULL,
    secret     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) WITHOUT ROWID;
  `,
  // 40: «Я и Книга»: the paragraphs an answer in the Book's words was made from (JSON refs) — the next question in the
  // same conversation goes on from them (server/bookvoice.js)
  `
  CREATE TABLE book_answers (
    message_id INTEGER PRIMARY KEY REFERENCES public_messages(id) ON DELETE CASCADE,
    refs       TEXT NOT NULL
  );
  `,
];
