import { BrandLogo } from "../../components/brand-logo";
import { Form, Field } from "../../components/forms";
import Link from "next/link";
import { LocaleProvider } from "../../components/locale";
import { acceptInvitationAction } from "../../lib/access-actions";
export default async function Invite({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; lang?: string }>;
}) {
  const { token, lang } = await searchParams;
  const locale = lang === "ru" ? "ru" : "en";
  const t = (ru: string, en: string) => (locale === "en" ? en : ru);
  return (
    <LocaleProvider locale={locale}>
      <main className="auth-page">
        <div className="auth-brand"><BrandLogo /></div>
        <section className="auth-panel">
          <h1>{locale === "en" ? "Invitation" : "Приглашение"}</h1>
          <Form action={acceptInvitationAction} submit={t("Принять", "Accept")}>
            <input type="hidden" name="token" value={token ?? ""} />
            <Field
              name="email"
              label={t("Email получателя", "Recipient email")}
              type="email"
              required
            />
            <Field name="name" label={t("Имя", "Name")} />
            <Field
              name="password"
              label={t("Пароль нового пользователя", "New user password")}
              type="password"
            />
          </Form>
          <Link href={"/login?lang=" + locale}>
            {locale === "en"
              ? "Sign in to an existing account"
              : "Войти в существующий аккаунт"}
          </Link>
          <p>
            <Link href={"?token=" + (token ?? "") + "&lang=ru"}>Русский</Link> ·{" "}
            <Link href={"?token=" + (token ?? "") + "&lang=en"}>English</Link>
          </p>
        </section>
      </main>
    </LocaleProvider>
  );
}
