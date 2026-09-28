"use client";

import { useState } from "react";
import { getSellerPhone } from "../../lib/feed";

// "Ara" (masaüstü yan panel): satıcının numarası yalnızca düğmeye basılınca
// istenir (WhatsApp'la aynı RPC) ve arama bağlantısıyla gösterilir.

export type SellerPhoneState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; phone: string }
  | { status: "missing" }
  | { status: "error" };

export function useSellerPhone(vehicleId: string) {
  const [state, setState] = useState<SellerPhoneState>({ status: "idle" });

  async function reveal() {
    if (state.status === "loading" || state.status === "ready") return;
    setState({ status: "loading" });
    try {
      const phone = await getSellerPhone(vehicleId);
      setState(phone ? { status: "ready", phone } : { status: "missing" });
    } catch (error) {
      console.error("Satıcının numarası alınamadı:", error);
      setState({ status: "error" });
    }
  }

  return { state, reveal };
}
