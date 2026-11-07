import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createLeadHandler } from "./leads.mjs";

const validLead = {
  name: "Тестовый заказчик",
  contact: "test@example.com",
  service: "installation",
  message: "Нужна установка на тестовый сервер.",
  consent: true,
  website: "",
};

async function withServer(options, run) {
  const handler = createLeadHandler({
    env: { LANDING_ORIGIN: "https://landing.example", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "123" },
    ...options,
  });
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${server.address().port}/api/leads`;
  const submit = (body = validLead, headers = {}) => fetch(endpoint, {
    method: "POST",
    headers: { Origin: "https://landing.example", "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  try {
    await run(submit);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test("sends validated plain text and confirms Telegram acceptance", async () => {
  let outbound;
  await withServer({ send: async (url, options) => {
    assert.equal(url, "https://api.telegram.org/bottest-token/sendMessage");
    outbound = JSON.parse(options.body);
    return Response.json({ ok: true });
  } }, async submit => {
    const result = await submit({ ...validLead, name: "<b>Заказчик</b>" });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).ok, true);
    assert.equal(outbound.chat_id, "123");
    assert.match(outbound.text, /<b>Заказчик<\/b>/u);
    assert.match(outbound.text, /Установка и запуск/u);
    assert.equal(outbound.parse_mode, undefined);
  });
});

test("rejects invalid input, missing consent and honeypot without sending", async () => {
  await withServer({ send: () => { throw new Error("Must not send"); } }, async submit => {
    for (const body of [{ ...validLead, consent: false }, { ...validLead, message: "short" },
      { ...validLead, website: "spam" }, { ...validLead, service: "unknown" }, null]) {
      assert.equal((await submit(body)).status, 400);
    }
  });
});

test("rejects foreign origin, invalid JSON and oversized requests", async () => {
  await withServer({}, async submit => {
    assert.equal((await submit(validLead, { Origin: "https://foreign.example" })).status, 403);
    assert.equal((await submit(validLead, { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await submit("{")).status, 400);
    assert.equal((await submit("x".repeat(9000))).status, 413);
  });
});

test("limits attempts and allows requests after the window expires", async () => {
  let timestamp = 0;
  await withServer({ now: () => timestamp, send: async () => Response.json({ ok: true }) }, async submit => {
    for (let count = 0; count < 5; count += 1) assert.equal((await submit()).status, 200);
    assert.equal((await submit()).status, 429);
    timestamp = 600_001;
    assert.equal((await submit()).status, 200);
  });
});

test("missing configuration and Telegram failures never report success or leak secrets", async () => {
  await withServer({ env: { LANDING_ORIGIN: "https://landing.example" } }, async submit => {
    assert.equal((await submit()).status, 503);
  });
  for (const send of [async () => Response.json({ ok: false }), async () => { throw new Error("test-token"); }]) {
    await withServer({ send }, async submit => {
      const result = await submit();
      assert.equal(result.status, 502);
      const body = await result.text();
      assert.doesNotMatch(body, /test-token/u);
      assert.equal(JSON.parse(body).ok, false);
    });
  }
});

test("API success responses follow the selected English or Russian language", async () => {
  await withServer({ send: async () => Response.json({ ok: true }) }, async submit => {
    const en = await submit(validLead, { "Accept-Language": "en" });
    assert.match((await en.json()).message, /Request sent!/u);
    const ru = await submit(validLead, { "Accept-Language": "ru" });
    assert.match((await ru.json()).message, /Заявка отправлена!/u);
  });
});
