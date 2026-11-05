"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
export function PublicSshKey({ value, en }: { value: string; en: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <textarea
        aria-label={en ? "Public SSH key" : "Публичный SSH-ключ"}
        value={value}
        readOnly
        rows={3}
        style={{ width: "100%", overflowWrap: "anywhere" }}
      />
      <button
        type="button"
        title={en ? "Copy public key" : "Копировать публичный ключ"}
        aria-label={en ? "Copy public key" : "Копировать публичный ключ"}
        style={{ width: 32, height: 32 }}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}
export function RemoteProgress({ busy }: { busy: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [busy, router]);
  return null;
}
