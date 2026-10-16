// @ts-check
// Letters (restoring a password, confirming an address) through an ordinary mailbox — e.g. one on
// Yandex Mail with an "app password" — over SMTP. No mail server of our own and no libraries: a few
// SMTP commands over node:tls (implicit TLS, port 465) or plain node:net (tests, a local relay).
//
// Configuration (environment, e.g. deploy/mail.env — see DEPLOY.md):
//   UB_SMTP_HOST, UB_SMTP_PORT (465), UB_SMTP_USER, UB_SMTP_PASS, UB_SMTP_SECURE ('0' — no TLS),
//   UB_MAIL_FROM (the sender, by default the user), UB_MAIL_NAME (the sender's name);
//   or, for trying it out without a mailbox, UB_MAIL_OUTBOX — a folder letters are written to as .eml.
import tls from 'node:tls';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ host: string, port: number, secure: boolean, user: string, pass: string, from: string, name: string }} SmtpConfig
 * @typedef {{ outbox: string, from: string, name: string }} OutboxConfig
 * @typedef {{ to: string, subject: string, text: string }} Letter
 */

/** @param {Record<string, string | undefined>} [env] @returns {SmtpConfig | OutboxConfig | null} */
export function mailConfig(env = process.env) {
  const name = env.UB_MAIL_NAME || 'Urantia Papers Explorer';
  if (env.UB_SMTP_HOST && env.UB_SMTP_USER && env.UB_SMTP_PASS) {
    return {
      host: env.UB_SMTP_HOST, port: Number(env.UB_SMTP_PORT || 465), secure: env.UB_SMTP_SECURE !== '0',
      user: env.UB_SMTP_USER, pass: env.UB_SMTP_PASS, from: env.UB_MAIL_FROM || env.UB_SMTP_USER, name,
    };
  }
  if (env.UB_MAIL_OUTBOX) return { outbox: env.UB_MAIL_OUTBOX, from: env.UB_MAIL_FROM || 'noreply@localhost', name };
  return null;
}

/** "=?UTF-8?B?…?=" for a header with non-Latin letters. @param {string} s */
const word = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

/** The letter as a MIME message: plain text in UTF-8, base64. @param {Letter} l @param {{ from: string, name: string }} c */
export function compose(l, c) {
  const domain = c.from.split('@')[1] || 'localhost';
  const body = Buffer.from(l.text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${word(c.name)} <${c.from}>`,
    `To: <${l.to}>`,
    `Subject: ${word(l.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/**
 * One letter over SMTP: EHLO, AUTH LOGIN, MAIL FROM, RCPT TO, DATA, QUIT.
 * @param {SmtpConfig} c @param {Letter} l @returns {Promise<void>}
 */
function smtp(c, l) {
  return new Promise((resolve, reject) => {
    const socket = c.secure
      ? tls.connect({ host: c.host, port: c.port, servername: c.host })
      : net.connect({ host: c.host, port: c.port });
    socket.setEncoding('utf8');
    socket.setTimeout(20_000, () => socket.destroy(new Error('SMTP: нет ответа')));
    let buf = '';
    /** @type {((reply: { code: number, text: string }) => void) | null} */ let waiting = null;
    socket.on('data', (chunk) => {
      buf += chunk;
      // A reply ends with a line "250 text" (a space after the code); "250-text" lines go before it.
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (!m || !waiting) return;
      const reply = { code: Number(m[1]), text: buf.trim() };
      buf = '';
      const w = waiting;
      waiting = null;
      w(reply);
    });
    socket.on('error', reject);
    /** @param {string | null} line @param {number} expect */
    const step = (line, expect) =>
      new Promise((ok, fail) => {
        waiting = (r) => (r.code === expect ? ok(r) : fail(new Error(`SMTP ${r.code}: ${r.text.slice(0, 200)}`)));
        if (line !== null) socket.write(`${line}\r\n`);
      });
    const b64 = (/** @type {string} */ s) => Buffer.from(s).toString('base64');
    const data = compose(l, c).replace(/\r\n\./g, '\r\n..'); // dot-stuffing
    (async () => {
      await step(null, 220);
      await step(`EHLO ${c.from.split('@')[1] || 'localhost'}`, 250);
      await step('AUTH LOGIN', 334);
      await step(b64(c.user), 334);
      await step(b64(c.pass), 235);
      await step(`MAIL FROM:<${c.from}>`, 250);
      await step(`RCPT TO:<${l.to}>`, 250);
      await step('DATA', 354);
      await step(`${data}\r\n.`, 250);
      socket.write('QUIT\r\n');
      socket.end();
    })().then(() => resolve(), (err) => (socket.destroy(), reject(err)));
  });
}

/** @param {SmtpConfig | OutboxConfig | null} [config] */
export function createMailer(config = mailConfig()) {
  return {
    /** Letters can be sent (a mailbox or an outbox is configured). */
    enabled: config !== null,
    /** @param {Letter} l */
    async send(l) {
      if (!config) throw new Error('Почта не настроена');
      if ('outbox' in config) {
        mkdirSync(config.outbox, { recursive: true });
        writeFileSync(join(config.outbox, `${Date.now()}-${randomBytes(3).toString('hex')}.eml`), compose(l, config));
        return;
      }
      await smtp(config, l);
    },
  };
}
