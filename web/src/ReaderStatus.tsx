import { useEffect, useState } from "react";
import type { Language } from "./db";
import { t } from "./i18n";

type Status = "waking" | "ready" | "busy" | "offline";
interface Health { status?: string; model_reachable?: boolean; }

export function ReaderStatus({ language }: { language: Language }) {
  const [status, setStatus] = useState<Status>("waking");
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const check = async () => {
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 130_000);
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        window.clearTimeout(timeout);
        const data = await response.json() as Health;
        if (active) setStatus(!data.model_reachable ? "offline" : data.status === "busy" ? "busy" : "ready");
      } catch {
        if (active) setStatus("offline");
      } finally {
        if (active) timer = window.setTimeout(check, 30_000);
      }
    };
    void check();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, []);

  const label = status === "ready" ? t(language, "readerReady") : status === "busy" ? t(language, "readerBusy") : status === "offline" ? t(language, "readerOffline") : t(language, "readerWaking");
  return <div className={`reader-status reader-status--${status}`} role="status" aria-live="polite"><span className="reader-status__dot" />{label}</div>;
}
