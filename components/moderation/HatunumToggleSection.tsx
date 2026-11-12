"use client";

import { useEffect, useState } from "react";

// /admin/reports → "Hatunum sayfası: AÇIK/KAPALI". Durum app_settings'te
// (lib/hatunum-switch.ts); varsayılan KAPALI, kapalıyken /hatunum 404 döner.
// Yetkiyi /api/admin/hatunum denetler (yönetici oturumu, Bearer token).

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; enabled: boolean; saving: boolean; notice?: string };

const BUTTON =
  "h-10 shrink-0 rounded-md px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 disabled:opacity-60";

async function callApi(token: string, init?: RequestInit) {
  const response = await fetch("/api/admin/hatunum", {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = (await response.json().catch(() => null)) as
    | { enabled?: boolean; error?: { message?: string } }
    | null;
  return { status: response.status, enabled: body?.enabled, message: body?.error?.message };
}

export default function HatunumToggleSection({
  getAccessToken,
  onUnauthorized,
}: {
  getAccessToken: () => Promise<string | null>;
  /** 401/403: panelden çıkarılır */
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = await getAccessToken();
      if (!token) return onUnauthorized();
      const result = await callApi(token).catch(() => null);
      if (!active) return;
      if (result?.status === 401 || result?.status === 403) onUnauthorized();
      else if (result?.status === 200 && typeof result.enabled === "boolean") {
        setState({ status: "ready", enabled: result.enabled, saving: false });
      } else setState({ status: "error", message: result?.message ?? "Durum okunamadı." });
    })();
    return () => {
      active = false;
    };
  }, [getAccessToken, onUnauthorized]);

  async function toggle(enabled: boolean) {
    setState((current) => (current.status === "ready" ? { ...current, saving: true, notice: undefined } : current));
    const token = await getAccessToken();
    if (!token) return onUnauthorized();
    const result = await callApi(token, { method: "POST", body: JSON.stringify({ enabled }) }).catch(() => null);
    if (result?.status === 401 || result?.status === 403) return onUnauthorized();
    setState((current) =>
      current.status !== "ready"
        ? current
        : result?.status === 200 && typeof result.enabled === "boolean"
          ? { status: "ready", enabled: result.enabled, saving: false, notice: result.enabled ? "Sayfa açıldı." : "Sayfa kapatıldı (404)." }
          : { ...current, saving: false, notice: result?.message ?? "Kaydedilemedi. Tekrar dene." },
    );
  }

  return (
    <section className="mt-10" aria-labelledby="hatunum-heading">
      <h2 id="hatunum-heading" className="text-[20px] font-semibold [font-family:var(--font-display)]">
        Hatunum sayfası:{" "}
        {state.status === "ready" ? (
          <span className={state.enabled ? "text-[#0A7A35]" : "text-[#B42318]"}>{state.enabled ? "AÇIK" : "KAPALI"}</span>
        ) : (
          <span className="text-[#5B616B]">…</span>
        )}
      </h2>
      <p className="mt-1 text-[14px] text-[#5B616B]">
        Kapalıyken <code>/hatunum</code> ve fotoğrafı herkese 404 döner.
      </p>
      {state.status === "error" && <p className="mt-3 text-[14px] text-[#B42318]">{state.message}</p>}
      {state.status === "ready" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={state.saving}
            onClick={() => void toggle(!state.enabled)}
            className={
              state.enabled
                ? `${BUTTON} border border-[#B42318] bg-white text-[#B42318]`
                : `${BUTTON} bg-[#003399] text-white`
            }
          >
            {state.saving ? "Kaydediliyor…" : state.enabled ? "Kapat" : "Aç"}
          </button>
          {state.enabled && (
            <a href="/hatunum" target="_blank" rel="noopener noreferrer" className="text-[14px] font-semibold text-[#003399] underline">
              Sayfayı aç ↗
            </a>
          )}
          <p role="status" className="text-[14px] text-[#5B616B]">
            {state.notice ?? ""}
          </p>
        </div>
      )}
    </section>
  );
}
