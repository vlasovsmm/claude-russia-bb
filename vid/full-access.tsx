// Полный доступ по умолчанию: каждому полю ответа (чату) ставит полный режим один раз, когда видит его впервые.
// Дальше режим выбирает человек переключателем у поля, и плагин его выбор не трогает.
// Живёт поверх всего приложения, потому что значки поля в свёрнутом виде не работают, а отправить можно и оттуда.
import { useComposers } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";

const FULL = "full";
const STORE = "vid.polnyj-dostup.pole";
const KEEP = 500;

/** Поля, которым полный режим уже поставлен; помним в браузере, чтобы перезапуск bb не стёр выбор человека. */
class Seen {
  private readonly keys: string[] = Seen.read();

  has(key: string): boolean { return this.keys.includes(key); }

  add(key: string): void {
    this.keys.push(key);
    this.keys.splice(0, Math.max(0, this.keys.length - KEEP));
    try { localStorage.setItem(STORE, JSON.stringify(this.keys)); } catch { /* браузер не даёт хранить: забудем при перезапуске */ }
  }

  private static read(): string[] {
    try {
      const got = JSON.parse(localStorage.getItem(STORE) ?? "[]");
      return Array.isArray(got) ? got.filter((one) => typeof one === "string") : [];
    } catch {
      return [];
    }
  }
}

export function FullAccess() {
  const composers = useComposers();

  useEffect(() => {
    const seen = new Seen();
    for (const composer of composers) {
      const mode = composer.selection?.permissionMode;
      if (!mode || seen.has(composer.key)) continue;
      seen.add(composer.key);
      if (mode !== FULL) void composer.setSelection({ permissionMode: FULL });
    }
  });

  return null;
}
