import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPageRenderer } from "./page.mjs";
const template = '<html lang="en"><head></head><body><template id="source-link"></template><footer><template id="public-links"></template></footer></body></html>';
test("omits unconfigured links and metadata without exposing env", () => {
 const html = createPageRenderer({ TELEGRAM_BOT_TOKEN: "private-token", TELEGRAM_CHAT_ID: "private-chat" })(template);
 assert.doesNotMatch(html, /canonical|og:|<a |<template|private-token|private-chat/u);
});
test("renders localized links, canonical and alternate language metadata", () => {
 const env = { LANDING_ORIGIN: "https://landing.example", LANDING_REPOSITORY_URL: "https://github.com/example/repo", LANDING_DOCS_URL: "https://docs.example/guide?one=1&two=2", LANDING_LICENSE_URL: "https://github.com/example/repo/blob/main/LICENSE" };
 const render = createPageRenderer(env), en = render(template), ru = render(template.replace('lang="en"','lang="ru"'));
 assert(en.includes('rel="canonical" href="https://landing.example/"'));
 assert.match(en, /og:locale" content="en_US"/u);
 assert.match(en, /Documentation/u); assert.match(en, /one=1&amp;two=2/u);
 assert(ru.includes('rel="canonical" href="https://landing.example/index.ru.html"'));
 assert.match(ru, /og:locale" content="ru_RU"/u); assert.match(ru, /Документация/u);
 assert.match(en, /hreflang="ru"/u);
});
test("rejects unsafe links and invalid origins", () => {
 for (const value of ["javascript:alert(1)", "/relative", "https://user:secret@example.com"]) assert.throws(() => createPageRenderer({LANDING_REPOSITORY_URL:value}), /LANDING_REPOSITORY_URL/u);
 assert.throws(() => createPageRenderer({LANDING_ORIGIN:"https://example.com/path"}), /LANDING_ORIGIN/u);
});
test("contact form is available by default, optional policy and explicit opt-out work", () => {
 const form = '<html lang="en"><head></head><body><form class="contact-form"><input name="contact"></form></body></html>';
 const enabled = createPageRenderer({ TELEGRAM_BOT_TOKEN:"private-token", TELEGRAM_CHAT_ID:"private-chat" })(form);
 assert.match(enabled, /<form/u); assert.doesNotMatch(enabled,/private-token|private-chat/u);
 assert.doesNotMatch(createPageRenderer({LANDING_ENABLE_LEADS:"false"})(form), /<form/u);
 assert.match(createPageRenderer({LANDING_PRIVACY_URL:"https://landing.example/privacy"})(form), /Privacy policy/u);
});
test("English is complete and both templates have working language links and forms", () => {
 const en = readFileSync(new URL("index.html", import.meta.url),"utf8");
 const ru = readFileSync(new URL("index.ru.html", import.meta.url),"utf8");
 assert.match(en, /<html lang="en">/u); assert.doesNotMatch(en,/\p{Script=Cyrillic}/u);
 assert.match(ru, /<html lang="ru">/u); assert.match(ru,/\p{Script=Cyrillic}/u);
 for (const html of [en,ru]) { assert(html.includes('href="./index.ru.html"')); assert(html.includes('href="./index.html"')); assert.match(html, /class="contact-form"/u); }
});

test("demo links and public viewer login render safely in both languages", () => {
  const fixture='<html lang="en"><head></head><body><template id="demo-link"></template><div class="demo-placeholder">Coming later</div></body></html>';
  const env={LANDING_DEMO_URL:'http://localhost:3003',LANDING_DEMO_EMAIL:'visitor@example.test',LANDING_DEMO_PASSWORD:'<sample>&"',TELEGRAM_BOT_TOKEN:'server-secret'};
  for(const lang of ['en','ru']) {
    const html=createPageRenderer(env)(fixture.replace('lang="en"','lang="'+lang+'"'));
    assert.match(html,/href="http:\/\/localhost:3003\/"/);
    assert.match(html,/visitor@example.test/);
    assert.match(html,/&lt;sample&gt;&amp;&quot;/);
    assert.doesNotMatch(html,/Coming later|server-secret|<sample>/);
  }
  assert.throws(()=>createPageRenderer({LANDING_DEMO_URL:'javascript:alert(1)'}),/LANDING_DEMO_URL/);
});
