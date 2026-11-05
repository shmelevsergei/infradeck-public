"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section>
      <h1>Не удалось загрузить данные</h1>
      <p>Проверьте соединение с БД и права доступа.</p>
      <button className="button primary" onClick={reset}>
        Повторить / Retry
      </button>
    </section>
  );
}
