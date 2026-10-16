// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMailer } from './mail.js';

/** A fake SMTP server: answers the dialogue and keeps what it was given. */
function fakeSmtp() {
  /** @type {{ lines: string[], data: string }} */
  const got = { lines: [], data: '' };
  const server = net.createServer((s) => {
    let buf = '';
    let inData = false;
    s.write('220 fake ESMTP\r\n');
    s.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            s.write('250 queued\r\n');
          } else got.data += `${line}\r\n`;
          continue;
        }
        got.lines.push(line);
        if (line.startsWith('EHLO')) s.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') s.write('334 VXNlcm5hbWU6\r\n');
        else if (got.lines.length === 3) s.write('334 UGFzc3dvcmQ6\r\n');
        else if (got.lines.length === 4) s.write(Buffer.from(line, 'base64').toString() === 'secret' ? '235 ok\r\n' : '535 bad\r\n');
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) s.write('250 ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          s.write('354 go\r\n');
        } else if (line === 'QUIT') s.end('221 bye\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, got, port: /** @type {any} */ (server.address()).port })));
}

test('mail: a letter over SMTP — AUTH LOGIN, MIME in UTF-8, the body intact', async () => {
  const { server, got, port } = /** @type {any} */ (await fakeSmtp());
  const mailer = createMailer({ host: '127.0.0.1', port, secure: false, user: 'box@example.ru', pass: 'secret', from: 'box@example.ru', name: 'Urantia Papers Explorer' });
  assert.equal(mailer.enabled, true);
  const text = 'Здравствуйте!\n.точка в начале строки\nСсылка: https://upexplorer.ddns.net/invite/abc';
  await mailer.send({ to: 'reader@example.org', subject: 'Восстановление пароля', text });
  server.close();
  assert.equal(Buffer.from(got.lines[2], 'base64').toString(), 'box@example.ru');
  assert.ok(got.lines.includes('MAIL FROM:<box@example.ru>'));
  assert.ok(got.lines.includes('RCPT TO:<reader@example.org>'));
  assert.match(got.data, /Subject: =\?UTF-8\?B\?/);
  assert.match(got.data, /Content-Transfer-Encoding: base64/);
  const body = got.data.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString(), text.replace(/\n/g, '\r\n'));
});

test('mail: a wrong password is an error; no configuration — not enabled', async () => {
  const { server, port } = /** @type {any} */ (await fakeSmtp());
  const mailer = createMailer({ host: '127.0.0.1', port, secure: false, user: 'box@example.ru', pass: 'wrong', from: 'box@example.ru', name: 'x' });
  await assert.rejects(mailer.send({ to: 'a@b.c', subject: 's', text: 't' }), /SMTP 535/);
  server.close();
  assert.equal(createMailer(null).enabled, false);
});
