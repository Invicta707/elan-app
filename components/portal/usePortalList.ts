"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalPage, PortalVehicle } from "../../lib/portal";

// Vitrin ızgarasının listesi: anahtar (filtrelerin sorgu metni ya da takip
// akışı) değişince ilk sayfa yeniden istenir; o sırada eski kartlar soluk
// kalır, ekran boşalmaz. Geç gelen eski yanıt yenisinin üstüne yazılmaz.
// "Daha fazla" sonraki sayfayı ekler (offset sayfalamada araya yeni ilan
// girerse tekrar eden kart atlanır).

type ListState = {
  /** Listenin hangi anahtarla yüklendiği */
  key: string | null;
  items: PortalVehicle[];
  hasMore: boolean;
  /** İlk sayfası yüklenemeyen anahtar */
  errorKey: string | null;
  more: "idle" | "loading" | "error";
};

export type PortalList = {
  items: PortalVehicle[];
  /** Anahtarın ilk sayfası bekleniyor (eski kartlar varsa gösterilir) */
  loading: boolean;
  /** Hiç yüklenmedi: iskelet */
  initial: boolean;
  failed: boolean;
  hasMore: boolean;
  more: "idle" | "loading" | "error";
  /** Sonraki sayfa; listeye yeni eklenen kartlar döner */
  loadMore: () => Promise<PortalVehicle[]>;
  retry: () => void;
};

export function usePortalList<C>(key: string | null, fetchPage: (cursor: C | null) => Promise<PortalPage<C | null>>): PortalList {
  const [state, setState] = useState<ListState>({ key: null, items: [], hasMore: false, errorKey: null, more: "idle" });
  const [attempt, setAttempt] = useState(0);
  const cursorRef = useRef<C | null>(null);
  const requestRef = useRef(0);
  const moreRef = useRef<Promise<PortalVehicle[]> | null>(null);
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (key === null) return;
    const request = ++requestRef.current;
    moreRef.current = null;
    fetchRef.current(null).then(
      (page) => {
        if (request !== requestRef.current) return;
        cursorRef.current = page.next;
        setState({ key, items: page.items, hasMore: page.hasMore, errorKey: null, more: "idle" });
      },
      (error) => {
        if (request !== requestRef.current) return;
        console.error("Vitrin ilanları yüklenemedi:", error);
        setState((current) => ({ ...current, errorKey: key }));
      },
    );
  }, [key, attempt]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (moreRef.current) return moreRef.current;
    if (!current.hasMore || current.key === null || current.key !== key) return Promise.resolve([]);
    const request = requestRef.current;
    setState((value) => ({ ...value, more: "loading" }));
    const promise = fetchRef.current(cursorRef.current).then(
      (page) => {
        moreRef.current = null;
        if (request !== requestRef.current) return [];
        cursorRef.current = page.next;
        const seen = new Set(stateRef.current.items.map((item) => item.id));
        const fresh = page.items.filter((item) => !seen.has(item.id));
        setState((value) => ({ ...value, items: [...value.items, ...fresh], hasMore: page.hasMore, more: "idle" }));
        return fresh;
      },
      (error) => {
        moreRef.current = null;
        if (request !== requestRef.current) return [];
        console.error("Vitrinin sonraki sayfası yüklenemedi:", error);
        setState((value) => ({ ...value, more: "error" }));
        return [];
      },
    );
    moreRef.current = promise;
    return promise;
  }, [key]);

  const retry = useCallback(() => {
    setState((value) => ({ ...value, errorKey: null }));
    setAttempt((value) => value + 1);
  }, []);

  const failed = key !== null && state.errorKey === key;
  const loading = key !== null && state.key !== key && !failed;
  return {
    items: state.items,
    loading,
    initial: loading && state.key === null,
    failed,
    hasMore: state.key === key && state.hasMore,
    more: state.more,
    loadMore,
    retry,
  };
}
