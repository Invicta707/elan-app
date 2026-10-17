"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

// "Sayfayı Kapat / 404 Yap": yalnızca ?admin=kamil ile çizilir (page.tsx). İstek
// yönetici oturumuyla gider; sunucu ADMIN_EMAILS'i denetler
// (app/api/admin/cansu-kamil/route.ts). Başarılıysa sayfa yenilenir ve 404 görünür.

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

export default function KillSwitch({ fetchImpl = fetch }: { fetchImpl?: typeof fetch }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function disablePage() {
    if (!window.confirm("Sayfa herkes için kapanacak (404). Emin misin?")) return;
    setState({ kind: "busy" });

    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setState({ kind: "error", message: "Önce yönetici hesabıyla giriş yapmalısın." });
      return;
    }

    try {
      const response = await fetchImpl("/api/admin/cansu-kamil", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: true }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setState({ kind: "error", message: body?.error?.message ?? "Sayfa kapatılamadı. Tekrar dene." });
        return;
      }
      setState({ kind: "done" });
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setState({ kind: "error", message: "Bağlantı hatası. Tekrar dene." });
    }
  }

  return (
    <div className="mt-12 flex w-full flex-col items-center gap-2">
      <button
        type="button"
        onClick={disablePage}
        disabled={state.kind === "busy" || state.kind === "done"}
        className="min-h-11 rounded-lg border border-red-500/60 bg-red-600/90 px-4 text-xs font-semibold text-white disabled:opacity-60"
      >
        {state.kind === "busy" ? "Kapatılıyor..." : "Sayfayı Kapat / 404 Yap"}
      </button>
      <p role="status" className="min-h-4 text-xs text-red-200">
        {state.kind === "done" ? "Sayfa kapatıldı." : state.kind === "error" ? state.message : ""}
      </p>
    </div>
  );
}
