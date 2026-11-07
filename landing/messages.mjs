const en = {
  "Для отправки откройте сайт через сервер, а не как локальный файл.": "Open the site through its server to send a request.",
  "Отправляем…": "Sending…",
  "Не удалось отправить заявку. Попробуйте позже.": "Could not send your request. Please try again later.",
  "Не удалось получить подтверждение отправки. Проверьте соединение; при повторе возможен дубль заявки.": "Delivery was not confirmed. Check your connection; retrying may send a duplicate.",
  "Отправить заявку ↗": "Send request ↗",
  "Команды скопированы.": "Commands copied.",
  "Команды выделены. Нажмите Ctrl+C или ⌘C для копирования.": "Commands selected. Press Ctrl+C or ⌘C to copy.",
  "Используйте форму заявки.": "Please use the contact form.",
  "Обновите страницу и отправьте заявку с сайта.": "Refresh the page and submit the form from this site.",
  "Неподдерживаемый формат заявки.": "Unsupported request format.",
  "Слишком много попыток. Попробуйте через 10 минут.": "Too many attempts. Please try again in 10 minutes.",
  "Заявка слишком большая. Сократите описание.": "Your request is too large. Please shorten the description.",
  "Не удалось прочитать заявку. Проверьте поля.": "Could not read your request. Please check the fields.",
  "Проверьте поля заявки.": "Please check the form fields.",
  "Укажите имя, контакт, вид помощи и описание от 10 до 2000 символов. Подтвердите согласие на передачу заявки.": "Enter your name, contact details, service and a description of 10–2000 characters. Confirm your consent to send the request.",
  "Приём заявок пока не настроен. Попробуйте позже.": "The contact form is temporarily unavailable. Please try again later.",
  "Telegram не подтвердил отправку. Попробуйте позже.": "Telegram did not confirm delivery. Please try again later.",
  "Заявка отправлена! Свяжемся с вами по указанному контакту.": "Request sent! We will contact you using the details you provided.",
  "Не удалось получить подтверждение отправки. Заявка могла дойти; при повторе возможен дубль. Попробуйте позже.": "Delivery was not confirmed. Your request may have arrived; retrying could send a duplicate. Please try again later."
};
export function translateMessage(message, locale = "en") { return locale === "ru" ? message : (en[message] ?? message); }
