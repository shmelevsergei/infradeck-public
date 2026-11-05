# InfraDeck

Первая бета: обычный SSH/Sentinel доступен; автоматические S3-бэкапы и ротация
SSH-ключей выключены по умолчанию. Явное включение для тестовых целей описано в
[эксплуатации](docs/operations.md#beta-experimental-operations).

[English](README.md) · [Документация](docs/README.md) · [Лицензия](LICENSE) · [Участие](CONTRIBUTING.md) · [Безопасность](SECURITY.md)

**0.5.0-beta.1 — кандидат первой беты.** [Состав и результаты приёмки](docs/releases/0.5.0-beta.1.md). Поддерживаемый путь установки — сборка из исходников. Публичные registry-образы пока не опубликованы. S3-исполнение и ротация SSH-ключей защищены серверными experimental-gates и выключены по умолчанию.

Самостоятельное open source приложение для реестра и наблюдения за IT-инфраструктурой. AGPL-3.0-only. Компания, timezone и профиль настраиваются. Облако автора не требуется. [SSH и установка Sentinel из карточки сервера](docs/managed-servers.md) доступны с первоначальным разрешением доступа владельцем сервера.

## Запуск Docker Compose

Требуются Docker Engine + Compose и Node.js 24.18.0 для установочного скрипта.

```powershell
npm.cmd ci
npm.cmd run install:local
```

Скрипт создаёт случайные секреты в приватном `.env`, сохраняет существующую конфигурацию и запускает сборку Compose. Открыть http://localhost:3000/setup, ввести `BOOTSTRAP_TOKEN` из локального `.env`, создать workspace и владельца. Публичной регистрации и начального пароля нет. В Linux использовать `npm` вместо `npm.cmd` и ограничить права `.env` до 600; в Windows ограничить ACL владельцем.

### Автоматическая Инициализация Администратора

Для установки без мастера сначала выполните `npm.cmd run install:local -- --prepare`, затем явно задайте в приватном `.env` обе переменные `INFRADECK_INIT_ADMIN_EMAIL` и `INFRADECK_INIT_ADMIN_PASSWORD`. Пароль: 12–128 символов, без пробелов в начале/конце; стандартного пароля нет. После этого выполните `npm.cmd run install:local`.

Необязательные настройки: `INFRADECK_INIT_ADMIN_NAME` (по умолчанию Administrator), `INFRADECK_INIT_WORKSPACE_NAME` (InfraDeck), `INFRADECK_INIT_TIMEZONE` (UTC), `INFRADECK_INIT_LOCALE` (ru или en, по умолчанию ru).

После миграций, до старта web/worker, создаются один workspace и первый администратор с ролью **OWNER** и правом экспорта. Откройте http://localhost:3000 и войдите с заданными данными. `/setup` после этого закрыт. Без обеих переменных сохраняется обычный мастер настройки; при частично заданных credentials на новой БД запуск останавливается с ошибкой без создания аккаунта.

Инициализация одноразовая: повторное развёртывание не меняет пароль, email и роли существующих пользователей. Непустая БД без маркера установки не принимается за новую: требуется восстановление, а не автоматический захват существующей установки. Пароль хешируется и не выводится в логи. INIT-переменные передаются только контейнеру `migrate`, не web/worker. После успешной настройки удалите обе INIT-переменные с credentials из `.env` и пересоздайте контейнер `migrate`, чтобы убрать их и из его окружения; не удаляйте остальные секреты.

Ручной запуск:

```powershell
npm.cmd run install:local -- --prepare
docker compose up -d --build
docker compose ps
```

Web и worker запускаются после `prisma migrate deploy`. PostgreSQL 18.6 и Redis 7.2.11 хранят данные в named volumes и не публикуют порты. Web по умолчанию доступен только на localhost. Для доступа извне настройте HTTPS reverse proxy и `BETTER_AUTH_URL`; Compose не монтирует Docker socket.

## Локальная разработка

```powershell
npm.cmd ci
npm.cmd run install:local -- --prepare --local
docker compose -f compose.yaml -f deploy/compose.local.yaml up -d postgres redis
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd exec playwright install chromium
npm.cmd run dev
```

В других терминалах: `npm.cmd run worker` и `npm.cmd run runner` (SSH-задания). Compose запускает runner автоматически. Локальный PostgreSQL опубликован только на `127.0.0.1:15432`. `--local` корректирует URL локальной БД, но не меняет секреты. Production Compose использует внутренний порт 5432.

## Проверки

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run db:verify-migrations
npm.cmd run test:phase-a
```

Тесты БД требуют применённых миграций. E2E требует работающие web, worker, Chromium и свободный localhost:17891. E2E создаёт только синтетические данные; используйте отдельную тестовую установку. Пароль тестового владельца случайный, хранится исключительно в игнорируемом `data/e2e-credentials.json`. Не запускать E2E на рабочей корпоративной БД.

Текущее состояние и результаты: [docs/implementation-status.md](docs/implementation-status.md). Архитектура: [docs/architecture.md](docs/architecture.md). Эксплуатация: [docs/operations.md](docs/operations.md). [English](README.md).

`test:phase-a` создаёт отдельную случайно именованную БД и отдельную очередь, проверяет пустую установку, сохранение секретов установщика, тесты и E2E на порту 3001, затем удаляет только свою тестовую БД. Требуются работающие PostgreSQL/Redis, Chromium и предварительный `npm.cmd run build`. Текущие записи не удаляются. Миграции добавляют таблицы/поля и расширяют allowlist без удаления данных; используйте `npm.cmd run db:migrate` перед запуском обновлённого приложения.

Приёмка: [docs/phase-a-acceptance.md](docs/phase-a-acceptance.md). Правила удаления: [docs/deletion.md](docs/deletion.md). Приглашения и реализованные scopes API: [docs/access.md](docs/access.md). Production setup пустой и не запускает E2E или demo-seed.

C2: [реальные ограниченные S3-бэкапы и изолированный restore](docs/backups-s3.md).
Настройка `/backups`, engine/ОС/лимиты зафиксированы; Manual результат и webhook
по-прежнему не запускают бэкап. Внешняя приёмка B/C1/C2 остаётся отдельной.

Фаза B: [проектные права, бюджеты, Prometheus, TLS, Alertmanager и каналы уведомлений](docs/phase-b.md). Пошаговая [инструкция пользователя](docs/user-guide.md). C1: [SSH/Sentinel и ротация](docs/managed-servers.md). Backup-webhook передаёт завершённый результат, но не запускает бэкап и не подтверждает восстановление. Отдельный C2 executor выполняет ограниченный профиль S3. Регрессионный `test:phase-a` также запускает проверки B/C1/C2 на отдельной базе; `test:phase-c` — focused domain/DB проверки. Продуктовые cloud-коннекторы требуют выбора конкретных продуктов/API.

Установка без Node.js на хосте через опубликованные release-образы остаётся отдельной задачей подготовки публичного релиза. Текущий поддерживаемый путь использует npm и локальную сборку Docker Compose.
