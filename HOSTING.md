# Urantia Papers Explorer — развёртывание на хостинге (для DevOps)

Документ описывает, что представляет собой приложение с точки зрения эксплуатации и что нужно,
чтобы перенести его с домашнего Windows-компьютера (см. `DEPLOY.md`) на VPS/выделенный сервер.
Целевая платформа по умолчанию — Linux (Ubuntu/Debian) + systemd + Caddy.

## 1. Коротко

- **Один процесс Node.js** (HTTP API + раздача собранного SPA) и **один файл SQLite**. Никаких внешних
  сервисов: нет Redis, очередей, почты, внешних API, исходящих запросов.
- **Нет npm-зависимостей во время работы.** Сервер использует только встроенные модули Node
  (`node:http`, `node:sqlite`, `node:worker_threads`, `node:zlib`). `node_modules` нужен лишь для сборки
  интерфейса (Vite + Svelte).
- **Обратный прокси на той же машине** завершает TLS и проксирует на `127.0.0.1:4300`.
- **Масштабируется только вертикально.** Один экземпляр, без балансировщика (причины — в разделе 8).

## 2. Схема

```
 Браузер ──HTTPS:443──▶ Caddy / nginx ──HTTP──▶ Node (127.0.0.1:4300)
          (HTTP:80 → редирект,                    ├─ /api/*            JSON API, cookie-сессии
           ACME-проверка)                          ├─ /api/chat/stream  Server-Sent Events (долгие соединения)
                                                   ├─ /*                web/dist (SPA, fallback на index.html)
                                                   ├─ worker thread     полнотекстовый поиск (своё подключение к БД)
                                                   └─ таймеры           бэкап БД (раз в сутки), подведение итогов голосований (10 мин)
                                                          │
                                                          ▼
                                                   data/ub.db  (SQLite, режим WAL)
                                                   data/backups/ub-ГГГГ-ММ-ДД.db
```

## 3. Требования к серверу

| Ресурс | Требование |
|---|---|
| ОС | Linux x86_64/arm64 (Windows тоже работает — так сейчас и запущено) |
| Node.js | **≥ 22.13** (нужен `node:sqlite`); рекомендуется текущий LTS **Node 24**. Сейчас работает на 24.6.0 |
| CPU / RAM | Ориентир: 1 vCPU, 1 ГБ RAM для небольшой аудитории (основной процесс + поток поиска, у каждого своё подключение к БД). Точных замеров под нагрузкой не было |
| Диск | SSD. Сейчас БД ≈ 65 МБ (+ WAL до десятков МБ), каждая суточная копия ≈ размер БД, хранится 14 копий → закладывать **≥ 2 ГБ** с запасом. Локальная ФС обязательна (SQLite в WAL нельзя держать на NFS/SMB) |
| Сеть | Входящие **80/tcp** и **443/tcp** (443/udp — для HTTP/3 в Caddy, по желанию). Порт 4300 наружу **не открывать** |
| DNS | A/AAAA-запись домена на IP сервера (нужна до первого запуска — для выпуска сертификата) |

## 4. Состав поставки

Собирать на CI или на сервере (`npm ci && npm run build`). Во время работы нужны только:

```
package.json        # скрипты start/admin/import
server/             # backend
shared/             # общий код сервера и интерфейса
scripts/            # admin.js, import-book.js (+ lib/)
web/dist/           # собранный интерфейс (результат npm run build)
data/               # состояние: ub.db, ub.db-wal, ub.db-shm, backups/ — НЕ перезаписывать при обновлении
```

`node_modules/`, `web/src/`, `deploy/` (Windows-скрипты и caddy.exe) и исходник книги
`UB-USGNY-EN-RUS-001-2017.md` (≈ 20 МБ) на сервере не нужны — книга уже загружена в БД.
Исходник понадобится, только если создавать БД с нуля (`npm run import`).

## 5. Конфигурация (переменные окружения)

| Переменная | По умолчанию | Для хостинга |
|---|---|---|
| `UB_HOST` | `127.0.0.1` | оставить; приложение доверяет `X-Forwarded-*` **только** от loopback |
| `UB_PORT` | `4300` | любой свободный |
| `UB_DB` | `<проект>/data/ub.db` | вынести в каталог данных, например `/var/lib/ubsite/ub.db`; копии кладутся рядом в `backups/` |
| `UB_PUBLIC_URL` | — | **обязательно**: `https://<домен>` — из него строятся ссылки-приглашения и сброса пароля |
| `UB_SECURE_COOKIES` | — | `1` — рекомендуется на хостинге (cookie всегда с `Secure`) |
| `UB_BACKUPS` / `UB_BACKUPS_KEEP` | вкл. / `14` | `0` отключает встроенные копии |
| `UB_SEARCH_TIMEOUT_MS` | `3000` | предел одного поискового запроса |

Секретов (ключей, паролей к БД) у приложения нет. Пароли пользователей хранятся в БД в виде хэшей,
сессии — в БД, cookie `HttpOnly; SameSite=Lax`.

## 6. Требования к обратному прокси (важно)

Логика приложения опирается на несколько заголовков — при неправильной настройке прокси перестанут
работать вход, приглашения или защита от CSRF:

1. **Прокси на той же машине и подключается к `127.0.0.1`.** Только тогда приложение принимает
   `X-Forwarded-For` (реальный IP клиента — по нему работает ограничение попыток входа: 10 неудач / 15 мин),
   `X-Forwarded-Proto` и `X-Forwarded-Host`. Если прокси на другом хосте или в другом контейнере,
   все клиенты будут выглядеть как один IP прокси, и один подбирающий пароль заблокирует вход всем.
2. **Сохранять исходный `Host`.** Запросы, изменяющие данные, проверяются по `Origin` — он должен совпадать
   с `Host`/`X-Forwarded-Host`. Иначе — `403 «Запрос с чужого сайта отклонён»`.
3. **SSE `/api/chat/stream`**: без буферизации и без сжатия; таймаут чтения > 25 с (сервер шлёт ping каждые 25 с).
4. Размер тела запроса — до 1 МБ (лимит приложения); прокси может разрешать столько же или больше.
5. Заголовки безопасности (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`) ставит само приложение;
   на прокси добавить только HSTS.

### Caddy (рекомендуется — сам получает и продлевает сертификат)

`/etc/caddy/Caddyfile`:

```caddy
example.org {
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}

	@stream path /api/chat/stream
	handle @stream {
		reverse_proxy 127.0.0.1:4300 {
			flush_interval -1
		}
	}

	handle {
		encode zstd gzip
		reverse_proxy 127.0.0.1:4300
	}

	log {
		output file /var/log/caddy/ubsite-access.log {
			roll_size 10MiB
			roll_keep 5
		}
	}
}
```

Caddy по умолчанию сохраняет `Host` и ставит `X-Forwarded-*` — отдельно настраивать не нужно.

### nginx (если на сервере уже стоит он)

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name example.org;
    # ssl_certificate / ssl_certificate_key — certbot

    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 2m;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

    location = /api/chat/stream {
        proxy_pass http://127.0.0.1:4300;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:4300;
    }
}

server {
    listen 80;
    server_name example.org;
    return 301 https://$host$request_uri;
}
```

## 7. Запуск как сервис (systemd)

```sh
sudo useradd --system --home /opt/ubsite --shell /usr/sbin/nologin ubsite
sudo mkdir -p /opt/ubsite /var/lib/ubsite
sudo chown -R ubsite:ubsite /var/lib/ubsite
```

`/etc/systemd/system/ubsite.service`:

```ini
[Unit]
Description=Urantia Papers Explorer
After=network.target

[Service]
User=ubsite
WorkingDirectory=/opt/ubsite
Environment=NODE_ENV=production
Environment=UB_DB=/var/lib/ubsite/ub.db
Environment=UB_PUBLIC_URL=https://example.org
Environment=UB_SECURE_COOKIES=1
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/main.js
Restart=on-failure
RestartSec=3

# изоляция
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/ubsite

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now ubsite
journalctl -u ubsite -f        # журнал приложения (stdout/stderr)
```

Миграции схемы БД применяются автоматически при старте (`PRAGMA user_version`); отдельного шага нет.
Обработчика SIGTERM нет — остановка мгновенная, SQLite в режиме WAL к этому устойчив.

### Административные команды на сервере

Работают при запущенном сервисе; запускать от пользователя сервиса с теми же переменными:

```sh
sudo -u ubsite env UB_DB=/var/lib/ubsite/ub.db UB_PUBLIC_URL=https://example.org \
  node --disable-warning=ExperimentalWarning scripts/admin.js invite [--admin]
# также: reset <имя>; init <имя> — только для новой пустой БД
```

## 8. Ограничения масштабирования

Запускать **ровно один экземпляр** на одну БД:

- SQLite — один файл, одна машина. Несколько процессов технически могут открыть его, но:
- живые события чата (SSE) рассылаются из памяти процесса — второй экземпляр их не увидит;
- ограничитель попыток входа хранится в памяти;
- суточный бэкап и подведение итогов голосований выполняются таймерами в процессе — дублировались бы.

Рост нагрузки — за счёт более мощной машины. Для отказоустойчивости достаточно быстрого восстановления
из резервной копии (раздел 10); при необходимости — потоковая репликация файла БД (например, Litestream).

## 9. Обновление версии

```sh
# на CI или в отдельном каталоге
npm ci && npm run build && npm test
# выкладка: заменить server/ shared/ scripts/ web/dist/ package.json в /opt/ubsite (data/ не трогать)
sudo systemctl restart ubsite
curl -fsS http://127.0.0.1:4300/api/auth/me   # проверка: 200
```

Простой — несколько секунд; открытые вкладки сами переподключат канал чата (через 3 с).
Миграции необратимы: перед обновлением сделать копию БД (раздел 10). Откат версии = предыдущий код
+ копия БД, снятая до обновления.

## 10. Резервное копирование и восстановление

- Приложение раз в сутки делает согласованную копию (`VACUUM INTO`) в `<каталог UB_DB>/backups/ub-ГГГГ-ММ-ДД.db`,
  хранит 14 последних. Дата в имени — по UTC. Первая проверка — через минуту после старта, далее каждые 6 ч.
- Эти копии лежат **на том же диске** — их нужно регулярно уносить наружу (S3/объектное хранилище,
  другой сервер): `rclone`/`restic` по cron/systemd-таймеру на каталог `backups/`.
- **Нельзя** копировать «живой» `ub.db` командой `cp` — в WAL-режиме копия будет несогласованной.
  Копировать либо файлы из `backups/`, либо `ub.db` + `ub.db-wal` + `ub.db-shm` вместе при остановленном сервисе.
- Восстановление: `systemctl stop ubsite` → заменить `ub.db` копией → удалить `ub.db-wal` и `ub.db-shm` → `systemctl start ubsite`.

## 11. Перенос данных с текущего сервера

Сейчас приложение работает на домашнем Windows-компьютере, данные — в `data\ub.db`.

1. Остановить сервер там (`deploy\restart.ps1` не подходит — закрыть окно Node или `Stop-Process`).
2. Скопировать на новый сервер `data\ub.db`, `data\ub.db-wal`, `data\ub.db-shm` (все три, вместе)
   либо самую свежую копию из `data\backups\` — она самодостаточна.
3. Положить в `/var/lib/ubsite/` (как `ub.db`), выдать права пользователю `ubsite`, запустить сервис.
4. Пользователи, сессии, заметки, рабочие пространства переезжают вместе с файлом. Старые ссылки-приглашения
   указывают на прежний домен — выпустить новые с новым `UB_PUBLIC_URL`.
5. Переключить DNS / выключить старый Caddy, чтобы данные не расходились.

## 12. Мониторинг

| Что | Как |
|---|---|
| Живость | `GET /api/auth/me` → `200` (без авторизации; используется и в `restart.ps1`). Внешний пинг — `GET https://<домен>/` |
| Ошибки | stdout/stderr → journald: строки `Internal error`/стек, `Backup failed`, `Voting sweep failed`, `Search worker failed`, `Search stopped after … ms` |
| Бэкап | Свежесть файла в `backups/` (не старше ~30 ч) |
| Диск | Свободное место на разделе с `UB_DB`; размер `ub.db-wal` |
| Сертификат | Caddy продлевает сам; внешний мониторинг срока — по желанию |
| Доступ | access-лог прокси |

## 13. Чек-лист безопасности

- [ ] Порт 4300 закрыт фаерволом снаружи (сервер и так слушает только loopback), открыты 22/80/443.
- [ ] Сервис работает от непривилегированного пользователя, запись разрешена только в каталог данных.
- [ ] `UB_SECURE_COOKIES=1`, HSTS на прокси.
- [ ] Прокси на той же машине, сохраняет `Host` (раздел 6).
- [ ] Резервные копии уходят за пределы сервера, восстановление проверено.
- [ ] Автообновления безопасности ОС; Node обновляется в пределах LTS.
- [ ] SSH только по ключам.

## 14. Docker (по желанию)

Возможен, но без выигрыша: зависимостей во время работы нет. Если всё же контейнер — учесть раздел 6:
либо прокси внутри того же контейнера/пода, либо `network_mode: host` и прокси на хосте, иначе приложение
не увидит реальные IP клиентов и протокол. Каталог данных — volume на локальном диске, одна реплика.
Базовый образ — `node:24-slim`, сборку интерфейса делать отдельной стадией (multi-stage), в итоговый образ
`node_modules` не нужен.
