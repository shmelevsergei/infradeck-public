"use client";
import Link from "next/link";
import Image from "next/image";
import { BrandLogo } from "./brand-logo";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  Server,
  Network,
  Globe,
  Radio,
  DatabaseZap,
  RefreshCw,
  Bell,
  List,
  History,
  Wallet,
  CalendarDays,
  FileDown,
  Plug,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronRight,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { logoutAction, switchWorkspace } from "../lib/actions";
const navigation = [
  ["dashboard", "Обзор", "Overview", LayoutDashboard],
  ["projects", "Проекты", "Projects", FolderKanban],
  ["infrastructure", "Инфраструктура", "Infrastructure", Server],
  ["topology", "Карта связей", "Topology", Network],
  ["domains", "Домены", "Domains", Globe],
  ["api-services", "API и endpoints", "API & endpoints", Radio],
  ["monitoring", "Мониторинг", "Monitoring", Activity],
  ["host-metrics", "Метрики серверов", "Host metrics", Activity],
  [
    "notification-settings",
    "Каналы уведомлений",
    "Notification channels",
    Bell,
  ],
  ["backups", "Бэкапы", "Backups", DatabaseZap],
  ["updates", "Обновления", "Updates", RefreshCw],
  ["alerts", "Оповещения", "Alerts", Bell],
  ["events", "События", "Events", List],
  ["audit", "Аудит", "Audit", History],
  ["costs", "Расходы", "Costs", Wallet],
  ["roadmap", "Дорожная карта", "Roadmap", CalendarDays],
  ["imports", "Импорт", "Import", FileDown],
  ["reports", "Отчёты", "Reports", FileDown],
  ["integrations", "Источники", "Sources", Plug],
  ["settings", "Настройки", "Settings", Settings],
  ["access", "Доступы", "Access", ShieldCheck],
  [
    "project-settings",
    "Проектные права и бюджеты",
    "Project access and budgets",
    FolderKanban,
  ],
  ["records", "Дополнительные записи", "Additional records", List],
  ["deletion-history", "История удаления", "Deletion history", History],
] as const;
export function Shell({
  children,
  workspace,
  user,
  workspaces,
  workerOnline,
}: {
  children: React.ReactNode;
  workspace: {
    id: string;
    name: string;
    timezone: string;
    locale: string;
    logoUrl: string | null;
  };
  user: { name: string; email: string };
  workspaces: { id: string; name: string }[];
  workerOnline: boolean;
}) {
  const pathname = usePathname(),
    en = workspace.locale === "en";
  const [open, setOpen] = useState(false),
    [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Intl.DateTimeFormat(en ? "en" : "ru", {
          timeZone: workspace.timezone,
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "short",
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [workspace.timezone, en]);
  const section = pathname.split("/")[1];
  const item = navigation.find((n) => n[0] === section);
  return (
    <div className="app-shell">
      {open && (
        <button
          aria-label="Close navigation"
          className="drawer-overlay"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={"sidebar " + (open ? "is-open" : "")}>
        <Link href="/dashboard" className="brand">
          <BrandLogo />
        </Link>
        <button
          className="mobile-close"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
        <div className="workspace-name">
          {workspace.logoUrl && (
            <Image
              src={workspace.logoUrl}
              width={24}
              height={24}
              alt=""
              unoptimized
            />
          )}
          {workspace.name}
        </div>
        <nav>
          {navigation.map(([route, ru, english, Icon]) => (
            <Link
              onClick={() => setOpen(false)}
              key={route}
              href={"/" + route}
              className={section === route ? "nav-item active" : "nav-item"}
            >
              <Icon size={18} />
              <span>{en ? english : ru}</span>
              {section === route && <span className="active-dot" />}
            </Link>
          ))}
        </nav>
        <div className="worker-status">
          <span
            className={
              workerOnline ? "status-dot success" : "status-dot unknown"
            }
          />
          <strong>
            {workerOnline
              ? en
                ? "Worker online"
                : "Worker подключён"
              : en
                ? "Worker offline"
                : "Worker не подключён"}
          </strong>
          <small>{en ? "Database · PostgreSQL" : "Данные · PostgreSQL"}</small>
          <Link href="/integrations">
            {en ? "Data sources" : "Источники данных"}
            <ChevronRight size={14} />
          </Link>
        </div>
        <Link className="source-link" href="/about">
          InfraDeck 0.5.0 Beta 1 · AGPL
        </Link>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </button>
          <div className="breadcrumbs">
            <span>{workspace.name}</span>
            <ChevronRight size={14} />
            <strong>{item ? (en ? item[2] : item[1]) : "InfraDeck"}</strong>
          </div>
          <div className="topbar-right">
            <time>{time}</time>
            <form action={switchWorkspace}>
              <select
                name="workspaceId"
                aria-label="Workspace"
                defaultValue={workspace.id}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </form>
            <Link href="/settings" className="profile">
              <span className="avatar">
                {user.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                {user.name}
                <small>{user.email}</small>
              </span>
            </Link>
            <form action={logoutAction}>
              <button
                className="icon-button ghost"
                title={en ? "Sign out" : "Выйти"}
                aria-label={en ? "Sign out" : "Выйти"}
              >
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
