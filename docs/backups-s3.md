# Реальные бэкапы S3 v1

22.10.2026. [Engine и границы](backup-engine.md), [приёмка](phase-c2-acceptance.md).
Ручные политики/результаты A и входящие webhook B сохранены отдельно. Создание
Manual результата никогда не запускает архивирование. Рабочие серверы в этой
сессии не изменялись; новые миграции к рабочей установке не применялись.

## Настройка

1. OWNER/ADMIN связывает SERVER с проектом, подключает SSH с явным public-key
   onboarding и подтверждённым host key. Установить поддерживаемые Python/pg tools
   через доверенное администрирование. Sentinel для backup не требуется.
2. Создать отдельную backup policy для этого сервера. Retention берётся из неё.
   Не назначать этому профилю действующий backup-webhook. Поле старого ручного
   schedule не является расписанием исполнителя.
3. `/backups` → «Добавить S3-хранилище проекта»: HTTPS endpoint без path/query,
   region, bucket, выделенный prefix с завершающим `/`, отдельные credentials.
   Проект допускает несколько серверов/хранилищ/профилей. Bucket уже существует.
   В private network требуется явное согласие; cloud metadata/link-local запрещены.
4. Нажать проверку: PUT/GET/DELETE случайного синтетического объекта под
   `<prefix>infradeck/<workspace>/probe-...`. Нет bucket listing/сканирования.
   Минимальные права credentials: GetObject/PutObject/DeleteObject только в
   выделенном prefix. Bucket administration и ListBucket приложению не нужны.
5. Назначить политику, SSH-источник и READY-хранилище одного проекта. Указать
   неподвижные каталоги `/srv`, имена PostgreSQL БД по одному на строку. Данные
   работающей PostgreSQL копируются исключительно через pg_dump, не PGDATA.
   Выбранные каталоги требуют application consistency со стороны владельца.
6. Создать recovery key, скопировать и сохранить отдельно от InfraDeck, отметить
   подтверждение. Сохранённый ключ не читается обратно через UI. Его копия в БД
   зашифрована ENCRYPTION_KEY; backup БД и ENCRYPTION_KEY хранить раздельно.
7. Запустить вручную либо явно включить расписание. Оно интервальное в UTC,
   1–8760 часов, первый запуск через заданный интервал. Это не cron и не старое
   ручное поле политики. Выполняет `npm run runner`, Compose уже содержит runner.

## Состояния и восстановление

Storage: UNTESTED/CHECK_QUEUED/CHECKING/READY/ERROR. Проверку тоже исполняет
runner, Server Action только ставит её в durable очередь; активная проверка
блокирует удаление хранилища, права повторно проверяются до сетевого доступа.
Task: QUEUED → RUNNING → SUCCESS/RESTORED/
FILES_VERIFIED; при отказе до трёх попыток с задержкой 30/60 секунд, затем FAILED.
Отмена: CANCELLED. Retention: EXPIRED. Watchdog проверяет актуальные права,
связи проекта, enabled/version SSH и отмену каждую секунду и перед этапами.
Глобальный advisory lock ограничивает C2 одним заданием между всеми runner;
partial unique index запрещает два активных задания профиля. Resource locks
согласованы с удалением/SSH. После crash RUNNING старше 10 минут возвращается
в очередь; object key детерминирован по task ID, повтор не создаёт новый result.
На source/restore сервере дополнительный nonblocking flock в собственном
`/tmp/infradeck-...<workspace-resource>.lock` не позволяет новому engine процессу
перекрыть ещё не завершившийся после обрыва процесс. Пустой lock-файл сохраняется;
он не содержит ключей/данных, проверяется owner/no-symlink/single-link.

SUCCESS означает encrypted upload + GET с проверкой SHA-256. Не означает restore.
Для полной проверки назначить отдельный доверенный одноразовый SERVER этого же
проекта с другим hostname/host key и PostgreSQL совместимой версии. Подтвердить
разрешение записи на эту цель. Restore создаёт только новые временные БД и
временный каталог, сверяет файлы, выполняет pg_restore, проверяет таблицы, затем
удаляет созданные тестовые данные. После успеха появляется независимая запись
RestoreVerification; проверка работоспособности приложения остаётся отдельной.
Без отдельного сервера кнопка выполняет только FILES_VERIFIED в приватном temp
runner, включая целостность dump-файла, без развёртывания БД и без SUCCESS restore.

Отмена/отзыв закрывают SSH/HTTPS. Уже выполненный remote шаг не откатывается
закрытием сокета: после crash могут остаться собственные temp-БД/каталоги или
S3-объект с task ID. Ошибка явно сообщает о частичном состоянии. Нельзя считать
такой job успешным. Проверять/удалять остатки только по известному ID; не делать
bucket-wide prune или DROP по wildcard. При сетевой неопределённости retry
перезаписывает только собственный task object, не чужой архив.

## История, удаление и ограничения

Результаты попадают в BackupRun, события, FAILED notifications существующего
outbox и новые отчёты (в том числе Executor/Task XLSX sheets). Ключи, credentials,
remote output не входят в отчёты/аудит/deletion history. Старые snapshots и файлы
отчётов не изменяются. Секретная настройка недоступна проектным ролям.

Сначала отключить schedule и завершить/отменить задания. Удаление профиля требует
его ID, сохраняет безопасную историю и прекращает retention, не удаляя архивы.
Затем можно удалить запись хранилища. Профили/назначения блокируют удаление
проекта, политики и задействованных серверов; FK защищают и гонки. Удаление
InfraDeck-записи никогда не удаляет сервер, bucket или внешние архивы. До удаления
сохраните recovery key, workspace/executor/task ID: они нужны как AES-GCM AAD.

Лимиты: 16 MiB данных, 1000 файлов, 8 каталогов/8 БД, 5 минут, single PUT до
24 MiB wire; не предназначено для больших production datasets. TLS проверяется,
redirects не следуются, DNS/IP фиксируются на каждый запрос. Paths/symlinks/
special files проверяются; неизвестные имена/форматы отвергаются. Ошибки безопасны,
raw logs не доступны. Новый engine требует последующей внешней приёмки.

English: `/backups` contains the localized setup. Authorize the initial SSH public
key using trusted access, assign project S3 storage and test only its own prefix,
save the recovery key offline, then create a bounded profile and enable execution
explicitly. SUCCESS is upload/readback; FILES_VERIFIED is file integrity only.
RESTORED requires a separate disposable host and successful pg_restore. Never
reuse a production restore target. Record deletion preserves external archives.
