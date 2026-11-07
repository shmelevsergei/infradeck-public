function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function configuredUrl(env, key, originOnly = false) {
  const value = env[key]?.trim(); if (!value) return null;
  let url; try { url = new URL(value); } catch { throw new Error(key + " must be an absolute HTTP(S) URL"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || (originOnly && (url.pathname !== "/" || url.search || url.hash))) throw new Error(key + " must be an HTTP(S) URL without credentials");
  return escapeAttribute(originOnly ? url.origin + "/" : url.href);
}
export function createPageRenderer(env = process.env) {
  const site = configuredUrl(env, "LANDING_ORIGIN", true);
  const repository = configuredUrl(env, "LANDING_REPOSITORY_URL");
  const docs = configuredUrl(env, "LANDING_DOCS_URL");
  const license = configuredUrl(env, "LANDING_LICENSE_URL");
  const release = configuredUrl(env, "LANDING_RELEASE_URL");
  const privacy = configuredUrl(env, "LANDING_PRIVACY_URL");
  const demo = configuredUrl(env, "LANDING_DEMO_URL");
  const demoCredentials = env.LANDING_DEMO_EMAIL && env.LANDING_DEMO_PASSWORD ? '<p>' + '<strong>' + escapeAttribute(env.LANDING_DEMO_EMAIL) + '</strong><br><code>' + escapeAttribute(env.LANDING_DEMO_PASSWORD) + '</code></p>' : '';
  const enabled = env.LANDING_ENABLE_LEADS !== "false";
  const link = (url, label) => url ? '<a href="' + url + '">' + label + '</a>' : "";
  return template => {
    const ru = /<html[^>]*lang="ru"/.test(template);
    const t = (en, russian) => ru ? russian : en;
    const canonical = site ? site + (ru ? "index.ru.html" : "") : null;
    const metadata = site ? '<link rel="canonical" href="' + canonical + '"><link rel="alternate" hreflang="en" href="' + site + '"><link rel="alternate" hreflang="ru" href="' + site + 'index.ru.html"><link rel="alternate" hreflang="x-default" href="' + site + '"><meta property="og:url" content="' + canonical + '"><meta property="og:type" content="website"><meta property="og:site_name" content="InfraDeck"><meta property="og:locale" content="' + (ru ? "ru_RU" : "en_US") + '"><meta property="og:title" content="' + t("InfraDeck — infrastructure under your control", "InfraDeck — инфраструктура под вашим контролем") + '">' : "";
    return template
      .replace(/<div class="demo-placeholder">[\s\S]*?<\/div>/u, block => demo ? '<div class="demo-placeholder"><span class="roadmap-status">' + t('Live demo', 'Работающее демо') + '</span><h3>' + t('Explore a sample workspace', 'Изучите демонстрационное пространство') + '</h3><p>' + t('Projects, resources, dependencies and costs with synthetic data.', 'Проекты, ресурсы, зависимости и расходы с вымышленными данными.') + '</p><a class="button" href="' + demo + '" target="_blank" rel="noopener noreferrer">' + t('Open demo ↗', 'Открыть демо ↗') + '</a><small>' + t('A separate environment with sample data.', 'Отдельный стенд с демонстрационными данными.') + '</small>' + demoCredentials + '</div>' : block)
      .replace('<template id="demo-link"></template>', demo ? '<a class="button" href="' + demo + '" target="_blank" rel="noopener noreferrer">' + t('Try live demo ↗', 'Попробовать демо ↗') + '</a>' : '<a class="button" href="#public-demo">' + t('Explore the interface ↗', 'Посмотреть интерфейс ↗') + '</a>')
      .replace(/<form class="contact-form"[\s\S]*?<\/form>/u, form => enabled
        ? (privacy ? form.replace("</form>", '<p>' + link(privacy, t("Privacy policy", "Политика обработки данных")) + '</p></form>') : form)
        : '<div class="support-contact-placeholder"><p>' + t("Contact requests are currently unavailable.", "Приём заявок временно недоступен.") + '</p>' + link(repository, "GitHub ↗") + '</div>')
      .replace("</head>", metadata + "</head>")
      .replace('<template id="source-link"></template>', repository ? '<p class="source-link">' + link(repository, t("Get source code ↗", "Получить исходники ↗")) + ' ' + link(release, t("Download Beta 1 ↗", "Скачать Beta 1 ↗")) + '</p>' : "")
      .replace('<template id="public-links"></template>', [link(demo, t("Live demo ↗", "Демо ↗")), link(repository, t("Source code ↗", "Исходный код ↗")), link(docs, t("Documentation ↗", "Документация ↗")), link(license, t("License ↗", "Лицензия ↗")), link(release, "Beta 1 ↗")].filter(Boolean).join("\n"));
  };
}
