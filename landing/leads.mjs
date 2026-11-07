import { translateMessage } from "./messages.mjs";
const services = new Map([
  ["installation", "Установка и запуск"],
  ["configuration", "Настройка под команду"],
  ["support", "Поддержка и сопровождение"],
  ["other", "Другая задача"],
]);

function reply(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify({ ok: status === 200, message }));
}

export function createLeadHandler({ env = process.env, send = fetch, now = Date.now } = {}) {
  const attempts = new Map();
  return async (request, response) => {
    const locale = request.headers["accept-language"]?.toLowerCase().startsWith("ru") ? "ru" : "en";
    const respond = (status, message) => reply(response, status, translateMessage(message, locale));
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      respond(405, "Используйте форму заявки.");
      return;
    }
    const expectedOrigin = env.LANDING_ORIGIN || `http://${request.headers.host}`;
    if (request.headers.origin !== expectedOrigin) {
      respond(403, "Обновите страницу и отправьте заявку с сайта.");
      return;
    }
    if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
      respond(415, "Неподдерживаемый формат заявки.");
      return;
    }
    const timestamp = now();
    for (const [address, entry] of attempts) {
      if (entry.expires <= timestamp) attempts.delete(address);
    }
    const address = request.socket.remoteAddress || "unknown";
    const entry = attempts.get(address) || { count: 0, expires: timestamp + 600_000 };
    if (entry.count >= 5 || (!attempts.has(address) && attempts.size >= 10_000)) {
      response.setHeader("Retry-After", "600");
      respond(429, "Слишком много попыток. Попробуйте через 10 минут.");
      return;
    }
    entry.count += 1;
    attempts.set(address, entry);
    let body;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) {
          respond(413, "Заявка слишком большая. Сократите описание.");
          return;
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      respond(400, "Не удалось прочитать заявку. Проверьте поля.");
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      respond(400, "Проверьте поля заявки.");
      return;
    }
    const validText = (value, min, max) => typeof value === "string"
      && value.trim().length >= min && value.length <= max
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
    if (!validText(body.name, 2, 80) || !validText(body.contact, 3, 160)
      || !validText(body.message, 10, 2000) || !services.has(body.service)
      || body.consent !== true || (body.website !== undefined && body.website !== "")) {
      respond(400, "Укажите имя, контакт, вид помощи и описание от 10 до 2000 символов. Подтвердите согласие на передачу заявки.");
      return;
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      respond(503, "Приём заявок пока не настроен. Попробуйте позже.");
      return;
    }
    const text = [
      "Новая заявка с лендинга InfraDeck",
      "",
      `Имя: ${body.name.trim()}`,
      `Контакт: ${body.contact.trim()}`,
      `Помощь: ${services.get(body.service)}`,
      "",
      body.message.trim(),
    ].join("\n");
    try {
      const result = await send(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await result.json();
      if (!result.ok || payload.ok !== true) {
        respond(502, "Telegram не подтвердил отправку. Попробуйте позже.");
        return;
      }
      respond(200, "Заявка отправлена! Свяжемся с вами по указанному контакту.");
    } catch {
      respond(502, "Не удалось получить подтверждение отправки. Заявка могла дойти; при повторе возможен дубль. Попробуйте позже.");
    }
  };
}
