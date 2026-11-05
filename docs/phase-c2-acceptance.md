# Приёмка C2

23.10.2026: повторная изолированная регрессия прошла на новых PostgreSQL/Redis: 14 миграций, 25 DB/domain и 7 E2E; focused C — 4 теста. Реальный archive/MinIO HTTPS/readback/restore на другом PostgreSQL-контейнере также прошёл. Исправлен обход лимита retry после повторных аварий runner: третья прерванная попытка завершается FAILED через штатный failure pipeline без четвёртого удалённого выполнения; отменённое прерванное задание становится CANCELLED. Повторная focused C-проверка с этими сценариями прошла. Это синтетическая проверка, не внешняя приёмка провайдера. [Журнал](release-preparation-status.md).

22.10.2026. Реализован ограниченный S3 executor v1. Полная внешняя приёмка
не объявляется пройденной. [Руководство](backups-s3.md), [engine](backup-engine.md).

| Сценарий | Реализация / проверка | Статус и ограничения |
| --- | --- | --- |
| Несколько серверов/хранилищ проекта | Отдельные назначения, проверка membership/project/resource, composite FK | Код и DB-тесты; secret UI только workspace OWNER/ADMIN |
| S3 доступ | HTTPS SigV4, pinned DNS, TLS verify, prefix-scoped synthetic PUT/GET/DELETE | TLS contract и настоящий MinIO upload/readback пройдены на отдельных синтетических целях; внешний provider отдельно |
| Архив | Выбранные /srv каталоги, pg_dump PostgreSQL 14–18; encrypted manifest/gzip AES-GCM | Реальный Python/PostgreSQL 18 dump/restore проверен на синтетическом контейнере; прочие ОС/PG majors требуют матрицы внешних тестов |
| Ключ восстановления | 256-bit recovery key, encrypted-at-rest, copy/ack при создании, AAD с task identity | Auth/tamper/wrong-key tests; independent key custody обязательно |
| Выполнение | Ручной запуск, отдельное интервальное UTC schedule, QUEUED/RUNNING/result | Durable DB queue, active unique index, глобальный advisory lock |
| Отказ/повтор/отмена | До 3 попыток, bounded delay, watchdog, stale RUNNING reconciliation | DB/TLS: S3 отказ/повтор/конкуренция, queued cancel и running cancel во время PUT, revoked actor, simulated stale RUNNING recovery; живая внешняя авария runner отдельно |
| Retention | Только точные own task keys, после upload/readback, максимум 100 за run | DB/TLS test; версии versioned bucket не purged |
| Restore | Temp file verification либо отдельный изолированный сервер с pg_restore в новые БД | Настоящий archive прошёл MinIO TLS и восстановлен на другом PostgreSQL 18 контейнере: file SHA-256, row count и row digest совпали; FILES_VERIFIED не создаёт RestoreVerification |
| История/уведомления/отчёты | BackupRun, RestoreVerification, safe audit, FAILED outbox, новые safe report fields | Старые snapshots/артефакты не меняются |
| Удаление | Активные jobs/schedule блокируют; сохранение безопасной истории конфигов | Удаление InfraDeck-записи не отправляет DELETE в S3 и не удаляет сервер |
| UI RU/EN, keyboard/mobile | Формы на /backups, masked inputs, offline recovery key, длинные имена | E2E результат фиксируется в implementation-status.md |

## Итог Изолированных Проверок

`typecheck`, `lint`, production build, 14 clean migrations, 23 domain/DB и 7 E2E
прошли. Focused `test:phase-c`: 4 теста. Настоящий Python/PostgreSQL 18 → AES-GCM
→ MinIO HTTPS/SigV4 → другой restore-контейнер прошёл с совпадением SHA-256 файлов
и row digest. Тестовые контейнеры/volumes/сеть удалены; рабочие данные не менялись.
E2E проверил настройки, schedule, RU/EN, клавиатуру и длинные данные на 390px.
Подробнее и границы: [implementation-status.md](implementation-status.md).

Повтор локальной синтетической приёмки (нужны Docker и OpenSSL; в Windows
используется OpenSSL из Git for Windows):

```powershell
npm.cmd run build
npm.cmd run test:phase-a
npm.cmd run test:phase-c
docker build -f deploy/Dockerfile.backup-test -t infradeck-backup-test:0.5.0-beta.1 .
npm.cmd run test:backup-engine
```

Проверка S3 доступа ставится в очередь runner: CHECK_QUEUED → CHECKING → READY/
ERROR. Удаление активной проверки заблокировано; отзыв прав до её исполнения
проверен без сетевого обращения. Это не долгая операция внутри HTTP-запроса.

## Открытая Внешняя Приёмка

Нужны разрешённые синтетические Ubuntu/Debian source и другой одноразовый restore
SERVER, тестовая PostgreSQL БД без рабочих данных, HTTPS S3 endpoint/region/bucket
и отдельный prefix с ограниченными credentials. Настройка credentials локально
в UI; private keys/пароли в чат не передавать. Подключённый рабочий сервер не
изменяется и не используется для STOP/install/backup/restore тестов.

Проверить полную связку SSH → dump → encrypted S3 upload → readback → другой host
restore → сверка fixture-файлов/строк, остановить S3 и runner, проверить retries,
cancel во время I/O, revoke после enqueue, cross-workspace/project, сохранение
старого отчёта и запрет удаления активных зависимостей. UI не обещает проверенную
работоспособность восстановленного приложения только по pg_restore exit code.
