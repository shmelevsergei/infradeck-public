"use client";
import { useState, useId } from "react";
export function RecoveryKey({ en }: { en: boolean }) {
  const [key, setKey] = useState("");
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>
        {en
          ? "Recovery key (64 hex characters); save outside InfraDeck"
          : "Ключ восстановления (64 hex); сохраните вне InfraDeck"}
      </span>
      <input
        id={id}
        name="recoveryKey"
        type="password"
        autoComplete="off"
        required
        pattern="[a-f0-9]{64}"
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          setKey(
            Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(""),
          )
        }
      >
        {en ? "Generate key" : "Создать ключ"}
      </button>
      <button
        type="button"
        disabled={!key}
        onClick={() => {
          void navigator.clipboard.writeText(key);
        }}
      >
        {en ? "Copy recovery key" : "Копировать ключ восстановления"}
      </button>
    </label>
  );
}
