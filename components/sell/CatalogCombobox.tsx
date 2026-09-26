"use client";

import { Check, ChevronDown, CircleAlert, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  catalogKey,
  catalogNameError,
  cleanCatalogName,
  findExactOption,
  searchCatalog,
  type CatalogOption,
} from "../../lib/catalog-search";
import { controlClass } from "./FormControls";

// Aramalı ve serbest metin destekli seçim kutusu (marka / model).
//
// Yazdıkça liste yazım hatasına dayanıklı arama ile süzülür (lib/catalog-search).
// Listede olmayan ad için en altta '"…" olarak kullan' seçeneği çıkar.
// Seçim (katalog kaydı ya da yeni ad) ancak listeden seçilince ya da Enter'la
// kesinleşir. Alan terk edilince yazılan ad birebir bir seçenekse o seçilir;
// değilse metin kaybolmaz, "bekleyen" olarak kalır ve form onu hata metninde söyler.
//
// ARIA combobox deseni: odak kutuda kalır, etkin seçenek aria-activedescendant.

type Item = { kind: "option"; option: CatalogOption } | { kind: "create"; name: string };

/** Seçilen değer: katalog kaydıysa id, yeni adsa name; ikisi de boşsa seçim yok */
export type CatalogValue = { id: string; name: string };

const MAX_VISIBLE = 60;

export function CatalogCombobox({
  id,
  options,
  selectedId,
  customName,
  maxLength,
  placeholder,
  emptyHint,
  disabled = false,
  invalid,
  describedBy,
  onChange,
  onPendingChange,
  onBlur,
}: {
  id: string;
  options: readonly CatalogOption[];
  selectedId: string;
  customName: string;
  maxLength: number;
  placeholder: string;
  /** Seçenek yokken (ör. yeni markanın modeli) listede görünen ipucu */
  emptyHint: string;
  disabled?: boolean;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: CatalogValue) => void;
  /** Yazılıp henüz seçilmemiş metin (yoksa null) */
  onPendingChange?: (text: string | null) => void;
  onBlur?: () => void;
}) {
  const listId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /** null: yazılmıyor, seçili değer gösterilir */
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [maxHeight, setMaxHeight] = useState(288);

  const committedLabel = selectedId ? (options.find((o) => o.id === selectedId)?.name ?? "") : customName;
  const text = editing ?? committedLabel;
  const query = editing ?? "";
  const trimmed = cleanCatalogName(query);

  const items = useMemo<Item[]>(() => {
    const found = searchCatalog(options, query).slice(0, MAX_VISIBLE);
    const list: Item[] = found.map((option) => ({ kind: "option", option }));
    if (trimmed && !findExactOption(options, trimmed) && !catalogNameError(trimmed, maxLength)) {
      list.push({ kind: "create", name: trimmed });
    }
    return list;
  }, [options, query, trimmed, maxLength]);

  const createError = trimmed && !findExactOption(options, trimmed) ? catalogNameError(trimmed, maxLength) : null;

  /** Listenin boyu: mobilde klavye açıkken görünür alanın altına taşmasın */
  const measure = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const space = bottom - input.getBoundingClientRect().bottom - 16;
    setMaxHeight(Math.max(144, Math.min(320, Math.floor(space))));
  }, []);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [open, measure]);

  // Etkin seçenek listede görünür kalsın
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId sabit bir biçim; yalnızca active ve open'a bağlı
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  function openList() {
    if (disabled) return;
    setOpen(true);
    measure();
  }

  function setPending(value: string | null) {
    onPendingChange?.(value && cleanCatalogName(value) ? value : null);
  }

  function choose(item: Item) {
    onChange(item.kind === "option" ? { id: item.option.id, name: "" } : { id: "", name: item.name });
    setEditing(null);
    setPending(null);
    setOpen(false);
    setActive(-1);
  }

  function handleFocus() {
    openList();
    const selectedIndex = items.findIndex((item) => item.kind === "option" && item.option.id === selectedId);
    setActive(selectedIndex);
    // Mobilde klavye açılınca kutu ekranın üstüne gelsin: liste için yer kalır
    if (window.matchMedia("(max-width: 767px)").matches) {
      setTimeout(() => {
        wrapperRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        setTimeout(measure, 350);
      }, 250);
    }
  }

  function handleInput(value: string) {
    setEditing(value);
    setPending(value);
    setActive(cleanCatalogName(value) ? 0 : -1);
    openList();
  }

  function handleBlur() {
    setOpen(false);
    setActive(-1);
    onBlur?.();
    if (editing === null) return;

    const value = cleanCatalogName(editing);
    const exact = value ? findExactOption(options, value) : undefined;
    if (!value) {
      // Metin silindiyse seçim de kalkar
      if (selectedId || customName) onChange({ id: "", name: "" });
      setEditing(null);
      setPending(null);
    } else if (exact) {
      choose({ kind: "option", option: exact });
    } else if (catalogKey(value) === catalogKey(committedLabel)) {
      setEditing(null);
      setPending(null);
    } else {
      // Listede yok ve seçilmedi: metin kalır, seçim kalkar; form "… olarak kullan" der
      if (selectedId || customName) onChange({ id: "", name: "" });
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) openList();
        if (items.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length));
        return;
      }
      case "Enter": {
        // Yazılırken Enter formu göndermez ("Devam et"); seçimi kesinleştirir
        if (open && active >= 0 && items[active]) {
          event.preventDefault();
          choose(items[active]);
        } else if (editing !== null && trimmed) {
          event.preventDefault();
          const exact = findExactOption(options, trimmed);
          if (exact) choose({ kind: "option", option: exact });
          else if (!createError) choose({ kind: "create", name: trimmed });
          else openList();
        }
        return;
      }
      case "Escape":
        if (open || editing !== null) {
          event.preventDefault();
          setOpen(false);
          setEditing(null);
          setPending(null);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  }

  function clear() {
    onChange({ id: "", name: "" });
    setEditing("");
    setPending(null);
    setActive(-1);
    inputRef.current?.focus();
    openList();
  }

  const expanded = open && !disabled;

  return (
    <div ref={wrapperRef} className="relative scroll-mt-20">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onFocus={handleFocus}
        onClick={() => !open && openList()}
        onChange={(event) => handleInput(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={controlClass(invalid, `h-12 pl-3.5 ${text && !disabled ? "pr-[4.5rem]" : "pr-10"}`)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2.5">
        {text && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Seçimi temizle"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full text-[#8A9099] hover:bg-[#F2F3F5] hover:text-[#15181C]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 text-[#5B616B] transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </span>

      {expanded && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={placeholder}
          // Tıklamada kutu odağı kaybetmesin (blur seçimden önce çalışmasın)
          onMouseDown={(event) => event.preventDefault()}
          style={{ maxHeight }}
          className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-y-auto overscroll-contain rounded-xl border border-[#E3E6EA] bg-white py-1 shadow-[0_12px_32px_rgba(16,24,40,0.16)]"
        >
          {items.length === 0 && (
            <li className="flex items-start gap-2 px-3.5 py-3 text-[14px] text-[#5B616B]">
              {createError ? (
                <>
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#B42318]" />
                  <span className="text-[#B42318]">{createError}</span>
                </>
              ) : options.length === 0 ? (
                emptyHint
              ) : (
                "Eşleşen bulunamadı."
              )}
            </li>
          )}
          {items.map((item, index) => {
            const isActive = index === active;
            if (item.kind === "create") {
              return (
                <li
                  key="create"
                  id={optionId(index)}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => choose(item)}
                  onMouseEnter={() => setActive(index)}
                  className={`mt-1 flex min-h-12 cursor-pointer items-center gap-2.5 border-t border-[#EEF0F3] px-3.5 py-2.5 ${
                    isActive ? "bg-[#EAEFF7]" : ""
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAEFF7] text-[#003399]">
                    <Plus aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-[#003399]">
                      “{item.name}” olarak kullan
                    </span>
                    <span className="block text-[12.5px] text-[#5B616B]">Listede yok; ilanda bu adla görünür</span>
                  </span>
                </li>
              );
            }
            const selected = item.option.id === selectedId;
            return (
              <li
                key={item.option.id}
                id={optionId(index)}
                role="option"
                aria-selected={isActive}
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(index)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-[15px] ${
                  isActive ? "bg-[#EAEFF7] text-[#003399]" : "text-[#15181C]"
                } ${selected ? "font-semibold" : ""}`}
              >
                <span className="truncate">{item.option.name}</span>
                {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[#003399]" />}
              </li>
            );
          })}
          {items.length > 0 && createError && (
            <li className="flex items-start gap-2 border-t border-[#EEF0F3] px-3.5 py-2.5 text-[13px] text-[#B42318]">
              <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              {createError}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
