import { db } from "@infradeck/db";
import { redirect } from "next/navigation";
import { BrandIcon } from "../../components/brand-icon";
import { Form, Field } from "../../components/forms";
import { setupAction } from "../../lib/actions";
import { LocaleProvider } from "../../components/locale";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function Setup({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  if (await db.installation.count()) redirect("/login");
  const locale = (await searchParams).lang === "ru" ? "ru" : "en";
  const t = (ru: string, en: string) => (locale === "en" ? en : ru);
  return (
    <LocaleProvider locale={locale}>
      <div className="auth-page">
        <div className="auth-brand">
          <BrandIcon />
          InfraDeck
        </div>
        <section className="auth-panel">
          <h1>{t("Первоначальная настройка", "Setup")}</h1>
          <p>
            {t(
              "Создание рабочего пространства и владельца",
              "Create a workspace and its owner",
            )}
          </p>
          <Form
            action={setupAction}
            submit={t("Создать рабочее пространство", "Create workspace")}
          >
            <input type="hidden" name="locale" value={locale} />
            <Field
              name="token"
              label="Bootstrap token"
              type="password"
              required
            />
            <Field name="workspace" label="Компания / Workspace" required />
            <Field name="name" label="Имя владельца / Owner name" required />
            <Field name="email" label="Email" type="email" required />
            <Field
              name="password"
              label="Пароль / Password (12+)"
              type="password"
              required
            />
            <Field
              name="timezone"
              label="Timezone"
              value="Europe/Moscow"
              required
            />
          </Form>
          <p>
            <Link href="?lang=ru">Русский</Link> ·{" "}
            <Link href="?lang=en">English</Link>
          </p>
        </section>
      </div>
    </LocaleProvider>
  );
}
