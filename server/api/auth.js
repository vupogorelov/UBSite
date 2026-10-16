// @ts-check
// Login, logout, current user, invitation links, password change, e-mail (a forgotten password by a
// letter, confirming an address). These routes work without a session.
import { HttpError, readJson } from '../http.js';
import { transaction } from '../db.js';
import {
  SESSION_COOKIE, readCookie, sessionCookie, clientIp, checkNewPassword, checkUsername, checkEmail, createLoginLimiter,
  createSignupLimiter, publicOrigin,
} from '../auth.js';

/**
 * @param {ReturnType<typeof import('../http.js').createRouter>} router
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('../auth.js').createAuth>} auth
 * @param {ReturnType<typeof import('../mail.js').createMailer>} mailer
 */
export function registerAuthRoutes(router, db, auth, mailer) {
  const limiter = createLoginLimiter();
  const signups = createSignupLimiter();
  // Letters: per address of the asker, and per account they go to.
  const lettersByIp = createSignupLimiter(5, 'Слишком много писем, попробуйте через час');
  const lettersByUser = createSignupLimiter(3, 'Письмо уже отправлено несколько раз — проверьте почту и папку «Спам» или попробуйте через час');

  /** A letter confirming `email` for the account. @param {import('node:http').IncomingMessage} req @param {import('../auth.js').User} user @param {string} email */
  async function sendConfirmation(req, user, email) {
    lettersByUser.check(`u${user.id}`);
    const url = `${publicOrigin(req)}/verify-email/${auth.createEmailToken(user.id, email)}`;
    await mailer.send({
      to: email,
      subject: 'Подтвердите почту — Urantia Papers Explorer',
      text: `Здравствуйте, ${user.displayName ?? user.username}!\n\n`
        + `Этот адрес указан для учётной записи «${user.username}» в Urantia Papers Explorer. Подтвердите его — `
        + `тогда по нему можно будет восстановить забытый пароль:\n\n${url}\n\n`
        + 'Ссылка действует сутки. Если вы не указывали этот адрес, просто не отвечайте на письмо.\n',
    });
    lettersByUser.record(`u${user.id}`);
  }
  /** @param {unknown} err */
  const mailFailed = (err) => {
    console.error('Mail:', err);
    return new HttpError(502, 'Не удалось отправить письмо, попробуйте позже');
  };
  /** @param {import('node:http').IncomingMessage} req */
  const body = async (req) => /** @type {Record<string, unknown>} */ ((await readJson(req)) ?? {});

  /** Current user or 401 (these routes run before the global session check). @param {import('node:http').IncomingMessage} req */
  const current = (req) => {
    const user = auth.userForToken(readCookie(req, SESSION_COOKIE));
    if (!user) throw new HttpError(401, 'Требуется вход');
    return user;
  };

  router.on('POST', '/api/auth/login', async ({ req, res }) => {
    const b = await body(req);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const key = `${clientIp(req)}|${username.toLowerCase()}`;
    limiter.check(key);
    limiter.check(clientIp(req));
    const user = auth.login(username, typeof b.password === 'string' ? b.password : '');
    if (!user) {
      limiter.fail(key);
      limiter.fail(clientIp(req));
      throw new HttpError(401, 'Неверное имя или пароль');
    }
    limiter.reset(key);
    res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(user.id)));
    return { user };
  });

  router.on('POST', '/api/auth/logout', ({ req, res }) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) auth.endSession(token);
    res.setHeader('Set-Cookie', sessionCookie(req, null));
    return { ok: true };
  });

  // { user: null } when signed out: "not signed in" is a normal answer here, not an error.
  router.on('GET', '/api/auth/me', ({ req }) => ({ user: auth.userForToken(readCookie(req, SESSION_COOKIE)) }));

  router.on('POST', '/api/auth/password', async ({ req, res }) => {
    const user = current(req);
    const b = await body(req);
    if (!auth.login(user.username, typeof b.current === 'string' ? b.current : '')) throw new HttpError(400, 'Текущий пароль неверен');
    auth.setPassword(user.id, checkNewPassword(b.next)); // also ends all sessions
    res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(user.id)));
    return { ok: true };
  });

  // `mail`: letters can be sent — "Забыли пароль?" and the e-mail field are shown.
  router.on('GET', '/api/auth/registration', () => ({ open: auth.registrationOpen(), mail: mailer.enabled }));

  // Open sign-up: a plain participant with a personal workspace, signed in right away.
  router.on('POST', '/api/auth/register', async ({ req, res }) => {
    if (!auth.registrationOpen()) throw new HttpError(403, 'Регистрация закрыта: доступ по приглашению администратора');
    const ip = clientIp(req);
    signups.check(ip);
    const b = await body(req);
    // Hidden from people; bots that fill every field get a plain refusal.
    if (typeof b.website === 'string' && b.website) throw new HttpError(400, 'Не удалось создать учётную запись');
    const username = checkUsername(b.username);
    const password = checkNewPassword(b.password);
    const displayName = auth.checkDisplayName(b.displayName);
    const email = mailer.enabled ? checkEmail(b.email) : null;
    const userId = transaction(db, () => {
      const id = auth.createUser(username, displayName, password, false);
      if (email) auth.setEmail(id, email);
      return id;
    });
    signups.record(ip);
    res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(userId)));
    const user = /** @type {import('../auth.js').User} */ (auth.userById(userId));
    // The account is there either way; a letter that did not go can be sent again from "Аккаунт".
    let emailSent = false;
    if (email) {
      try {
        await sendConfirmation(req, user, email);
        emailSent = true;
      } catch (err) {
        console.error('Mail:', err);
      }
    }
    return { user, emailSent };
  });

  // { email, password } — sets (or, with an empty email, removes) the address; a new one is to be confirmed.
  // The password guards it: whoever controls the address controls the account.
  router.on('PUT', '/api/auth/email', async ({ req }) => {
    const user = current(req);
    if (!mailer.enabled) throw new HttpError(400, 'Почта на платформе не настроена');
    const b = await body(req);
    if (!auth.login(user.username, typeof b.password === 'string' ? b.password : '')) throw new HttpError(400, 'Пароль неверен');
    const email = checkEmail(b.email);
    auth.setEmail(user.id, email);
    const fresh = /** @type {import('../auth.js').User} */ (auth.userById(user.id));
    if (email) {
      try {
        await sendConfirmation(req, fresh, email);
      } catch (err) {
        throw err instanceof HttpError ? err : mailFailed(err);
      }
    }
    return { user: fresh };
  });

  // { displayName } — the name others see; empty — the login
  router.on('PUT', '/api/auth/profile', async ({ req }) => {
    const user = current(req);
    auth.setDisplayName(user.id, (await body(req)).displayName);
    return { user: /** @type {import('../auth.js').User} */ (auth.userById(user.id)) };
  });

  // The confirmation letter again, for the current (unconfirmed) address.
  router.on('POST', '/api/auth/email/resend', async ({ req }) => {
    const user = current(req);
    if (!mailer.enabled || !user.email) throw new HttpError(400, 'Сначала укажите почту');
    if (user.emailVerified) return { ok: true };
    try {
      await sendConfirmation(req, user, user.email);
    } catch (err) {
      throw err instanceof HttpError ? err : mailFailed(err);
    }
    return { ok: true };
  });

  // The link from the letter (no session needed: the link is the proof).
  router.on('POST', '/api/auth/verify-email/:token', ({ params }) => {
    const t = auth.verifyEmail(params.token);
    if (!t) throw new HttpError(404, 'Ссылка недействительна, устарела или адрес уже изменён');
    return { email: t.email };
  });

  // { login } — a username or an e-mail. Letters with a one-hour link go to every matching account with a
  // confirmed address; the answer is the same either way (no hint whether such an account exists).
  router.on('POST', '/api/auth/forgot', async ({ req }) => {
    if (!mailer.enabled) throw new HttpError(400, 'Восстановление по почте не настроено — обратитесь к администратору');
    const ip = clientIp(req);
    lettersByIp.check(ip);
    const b = await body(req);
    const login = typeof b.login === 'string' ? b.login.slice(0, 254) : '';
    lettersByIp.record(ip);
    for (const user of auth.accountsFor(login).slice(0, 5)) {
      try {
        lettersByUser.check(`u${user.id}`);
        const url = `${publicOrigin(req)}/invite/${auth.createInvite({ kind: 'reset', userId: user.id, hours: 1 })}`;
        await mailer.send({
          to: /** @type {string} */ (user.email),
          subject: 'Восстановление пароля — Urantia Papers Explorer',
          text: `Здравствуйте, ${user.displayName ?? user.username}!\n\n`
            + `Кто-то — возможно, вы — попросил восстановить пароль учётной записи «${user.username}» в Urantia Papers Explorer.\n\n`
            + `Чтобы задать новый пароль, откройте ссылку (она действует 1 час и только один раз):\n\n${url}\n\n`
            + 'Если это были не вы, просто не отвечайте на письмо — пароль останется прежним.\n',
        });
        lettersByUser.record(`u${user.id}`);
      } catch (err) {
        console.error('Mail (forgot):', err); // the answer stays the same
      }
    }
    return { ok: true };
  });

  // What the invitation link is for (shown before the user fills in the form).
  router.on('GET', '/api/auth/invite/:token', ({ params }) => {
    const inv = auth.invite(params.token);
    if (!inv) throw new HttpError(404, 'Ссылка недействительна или уже использована');
    return { kind: inv.kind, username: inv.username ?? null, workspaceName: inv.workspaceName ?? null, role: inv.role ?? null };
  });

  // Accepts an invitation: creates the account (or sets a new password) and signs in.
  router.on('POST', '/api/auth/invite/:token', async ({ req, res, params }) => {
    const inv = auth.invite(params.token);
    if (!inv) throw new HttpError(404, 'Ссылка недействительна или уже использована');
    const b = await body(req);
    const password = checkNewPassword(b.password);
    const userId = transaction(db, () => {
      let id = inv.userId;
      if (inv.kind === 'account') {
        const displayName = auth.checkDisplayName(b.displayName);
        id = auth.createUser(checkUsername(b.username), displayName, password, Boolean(inv.isAdmin));
        if (inv.workspaceId) auth.addMember(inv.workspaceId, id, inv.role ?? 'viewer');
      } else {
        auth.setPassword(id, password);
      }
      auth.useInvite(params.token);
      return /** @type {number} */ (id);
    });
    res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(userId)));
    return { user: auth.userById(userId) };
  });
}
