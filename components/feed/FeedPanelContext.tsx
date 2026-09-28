"use client";

import { createContext, useContext } from "react";

// Masaüstü düzeni (1024 px ve üstü): akış kartındaki "Yorum" düğmesi alttan
// pencere açmak yerine sağdaki kalıcı paneldeki yorumlara gider. Ana sayfa
// (HomeFeed) sağlar; yalnızca masaüstünde değer vardır.

export type FeedPanel = {
  /** Yan paneldeki yorumlara kaydır ve yazma alanına odaklan */
  focusComments: (vehicleId: string) => void;
};

export const FeedPanelContext = createContext<FeedPanel | null>(null);

export function useFeedPanel(): FeedPanel | null {
  return useContext(FeedPanelContext);
}
