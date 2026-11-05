# C2: профиль выполнения v1

Решение до реализации, 22.10.2026: InfraDeck bounded archive v1, Python 3.10–3.13
на SSH-источнике, manifest JSON с base64 файлами, gzip и AES-256-GCM на runner, S3 SigV4 HTTPS
path-style, один PUT без multipart. Поддерживаемые цели: Ubuntu 22.04/24.04,
Debian 12/13, amd64/arm64. PostgreSQL 14–18: только логический `pg_dump -Fc`
соответствующей major версии через локальный Unix socket/peer postgres.
Существующий Docker/агент не меняются. Runtime инструменты должны быть установлены
владельцем; этот профиль не устанавливает пакеты и не обновляет PostgreSQL.

Профиль предназначен для небольших синтетических/малых наборов: максимум 16 MiB
несжатых данных, 1000 файлов, 5 минут на операцию, один runner job одновременно.
Размер каждой source PostgreSQL БД — до 64 MiB физически; major pg_dump должен
совпадать с server major. Эти ограничения проверяются до выполнения dump.
Каталоги баз данных, symlinks, устройства, sockets и hardlinks запрещены.
Для работающей PostgreSQL используется только pg_dump, не файловая копия PGDATA.
Каталоги приложений не имеют автоматической application consistency: владелец
выбирает неподвижные данные либо отдельно обеспечивает quiesce.

Каталоги ограничены `/srv`, имена файлов — ASCII letters/digits/`_./-`.
Архив не сохраняет исходные ownership/permissions: восстановленные файлы 600,
каталоги 700. Пустые каталоги отдельно не сохраняются. Это ограниченный engine,
не замена полноразмерному restic/Borg и не универсальное резервирование хоста.

Credentials S3 и recovery key хранятся раздельно в encrypted config. Копию recovery
key владелец хранит вне InfraDeck; потеря ключа означает потерю восстановления.
SUCCESS означает завершённый upload, не проверенное восстановление PostgreSQL.
Проверка S3 использует случайный объект только внутри выделенного namespace.
Retention оперирует только точными object keys успешных собственных заданий,
никогда не использует bucket-wide listing/prune. Retention запускается после
нового успешного upload/readback, максимум 100 старых архивов за запуск. Для
versioned buckets DELETE создаёт delete marker: версии должен обслуживать
администратор своей lifecycle-политикой. Multipart не используется.

Полный restore требует другого SERVER того же проекта, другого hostname и host
fingerprint, явно назначенного администратором как одноразовая изолированная цель.
`pg_restore --exit-on-error --single-transaction --no-owner --no-privileges`
работает только в новых `idrestore_<task>_<index>` БД. После сверки файлов и
успешного restore созданные БД/временные файлы удаляются. Приложение и права
исходного кластера этим не проверяются. Без такой цели доступна только файловая
сверка на runner; она не создаёт RestoreVerification SUCCESS.

`pg_dump` даёт согласованный логический dump одной БД, не всего кластера и не
нескольких БД в единой транзакции. Роли/tablespaces не резервируются. Секреты не
передаются в argv SSH или S3 URLs. PostgreSQL dump может содержать исполняемый
SQL: источник должен быть доверенным, restore-server действительно одноразовым.
Ориентир: [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).

Документ задаёт контракт реализации; сам по себе не является готовым C2 или
доказательством внешней приёмки. Факты: [phase-c2-acceptance.md](phase-c2-acceptance.md).
