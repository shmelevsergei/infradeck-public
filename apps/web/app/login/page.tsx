import Link from "next/link";
import { BrandLogo } from "../../components/brand-logo";
import { Form, Field } from "../../components/forms";
import { loginAction } from "../../lib/actions";
import { LocaleProvider } from "../../components/locale";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const locale = lang === "ru" ? "ru" : "en";
  const t = (ru: string, en: string) => (locale === "en" ? en : ru);
  return (
    <LocaleProvider locale={locale}>
      <div className="auth-page">
        <div className="auth-brand">
          <BrandLogo />
        </div>
        <section className="auth-panel">
          <h1>{t("Вход", "Sign in")}</h1>
          <Form action={loginAction} submit={t("Войти", "Sign in")}>
            <Field name="email" label="Email" type="email" required />
            <Field
              name="password"
              label={t("Пароль", "Password")}
              type="password"
              required
            />
          </Form>
          <Link href={"/setup?lang=" + locale}>
            {t("Первоначальная настройка", "Setup")}
          </Link>
          <p>
            <Link href="?lang=ru">Русский</Link> ·{" "}
            <Link href="?lang=en">English</Link>
          </p>
        </section>
      </div>
    </LocaleProvider>
  );
}
