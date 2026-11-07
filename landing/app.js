import { translateMessage } from "./messages.mjs";
const locale = document.documentElement.lang === "ru" ? "ru" : "en";
const t = message => translateMessage(message, locale);
const contactForm = document.querySelector(".contact-form");
contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (contactForm.getAttribute("aria-busy") === "true" || !contactForm.reportValidity()) return;
  const button = contactForm.querySelector('button[type="submit"]');
  const feedback = contactForm.querySelector(".form-feedback");
  if (location.protocol === "file:") {
    feedback.textContent = t("Для отправки откройте сайт через сервер, а не как локальный файл.");
    feedback.dataset.state = "error";
    return;
  }
  const fields = new FormData(contactForm);
  contactForm.setAttribute("aria-busy", "true");
  button.disabled = true;
  button.textContent = t("Отправляем…");
  feedback.textContent = "";
  try {
    const result = await fetch(contactForm.action, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": locale },
      body: JSON.stringify({
        name: fields.get("name"),
        contact: fields.get("contact"),
        service: fields.get("service"),
        message: fields.get("message"),
        website: fields.get("website"),
        consent: fields.get("consent") === "on",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await result.json();
    feedback.dataset.state = result.ok && payload.ok === true ? "success" : "error";
    feedback.textContent = payload.message || t("Не удалось отправить заявку. Попробуйте позже.");
    if (result.ok && payload.ok === true) contactForm.reset();
  } catch {
    feedback.dataset.state = "error";
    feedback.textContent = t("Не удалось получить подтверждение отправки. Проверьте соединение; при повторе возможен дубль заявки.");
  } finally {
    contactForm.setAttribute("aria-busy", "false");
    button.disabled = false;
    button.textContent = t("Отправить заявку ↗");
  }
});
document.querySelector(".copy-button").addEventListener("click", async () => {
  const commands = document.getElementById("install-commands");
  const feedback = document.querySelector(".copy-feedback");
  try {
    await navigator.clipboard.writeText(commands.textContent);
    feedback.textContent = t("Команды скопированы.");
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(commands);
    selection.removeAllRanges();
    selection.addRange(range);
    feedback.textContent = t("Команды выделены. Нажмите Ctrl+C или ⌘C для копирования.");
  }
});
