"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { STATUS_LABELS, type VehicleStatus } from "../../lib/listing-status";
import { deleteAllTestListings, fetchTestListings, formatRelativeTime, type TestListing } from "../../lib/moderation";
import { currencySymbol, formatAmount } from "../../lib/search";

// /admin/reports → "Test ilanları": vitrini gerçek veriyle denemek için açılan
// deneme ilanları (vehicles.is_test, scripts/seed-test-listings.mjs). Kartta ve
// pencerede "Test ilanı" etiketiyle görünürler. "Test ilanlarını sil" onaydan
// sonra hepsini videoları, fotoğrafları ve bağlı kayıtlarıyla kalıcı siler.
// Yetkiyi /api/admin/test-listings denetler.

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: TestListing[] };

const SECONDARY_BUTTON =
  "h-10 shrink-0 rounded-md border border-[#C9CED6] bg-white px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2 disabled:opacity-60";

export default function TestListingsSection({
  getAccessToken,
  onUnauthorized,
}: {
  getAccessToken: () => Promise<string | null>;
  /** 401/403: panelden çıkarılır */
  onUnauthorized: () => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; details?: string[] } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = await getAccessToken();
      const result = token ? await fetchTestListings(token) : ({ ok: false, status: 401, message: "" } as const);
      if (!active) return;
      if (result.ok) setLoad({ status: "ready", items: result.items });
      else if (result.status === 401 || result.status === 403) onUnauthorized();
      else setLoad({ status: "error", message: result.message });
    })();
    return () => {
      active = false;
    };
  }, [reloadKey, getAccessToken, onUnauthorized]);

  function reload() {
    setLoad({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  async function deleteAll() {
    setDeleting(true);
    const token = await getAccessToken();
    const result = token ? await deleteAllTestListings(token) : ({ ok: false, status: 401, message: "" } as const);
    setDeleting(false);
    setConfirming(false);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) onUnauthorized();
      else setNotice({ tone: "error", text: result.message });
      return;
    }
    setNotice(
      result.failures.length > 0
        ? {
            tone: "error",
            text: `${result.deleted} test ilanı silindi; ${result.failures.length} ilanın medyası silinemedi, ilan bırakıldı. Tekrar deneyebilirsin.`,
            details: result.failures,
          }
        : { tone: "success", text: `${result.deleted} test ilanı silindi.` },
    );
    reload();
  }

  const count = load.status === "ready" ? load.items.length : 0;

  return (
    <section aria-labelledby="test-listings-title" className="mt-8">
      <h2 id="test-listings-title" className="text-[20px] font-semibold [font-family:var(--font-display)]">
        Test ilanları
      </h2>

      <div role="status" aria-live="polite">
        {notice && (
          <div
            className={`mt-3 rounded-md px-3 py-2 text-[14px] ${
              notice.tone === "success" ? "bg-[#E6F6EC] text-[#1B7A3D]" : "bg-[#FDECEC] text-[#B42318]"
            }`}
          >
            <p>{notice.text}</p>
            {notice.details && (
              <ul className="mt-1 list-disc pl-5 text-[13px]">
                {notice.details.map((line) => (
                  <li key={line} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {load.status === "loading" && <div aria-hidden="true" className="mt-4 h-24 animate-pulse rounded-lg bg-[#DDE1E6]" />}

      {load.status === "error" && (
        <div role="status" className="mt-6 flex flex-col items-center gap-4 text-center">
          <p className="text-[15px] text-[#5B616B]">{load.message}</p>
          <button type="button" onClick={reload} className={SECONDARY_BUTTON}>
            Tekrar dene
          </button>
        </div>
      )}

      {load.status === "ready" && (
        <>
          <p className="mt-1 text-[14px] text-[#5B616B]">
            {count > 0
              ? `${count} test ilanı · vitrinde "Test ilanı" etiketiyle görünür`
              : "Test ilanı yok. Açmak için: node scripts/seed-test-listings.mjs"}
          </p>

          {count > 0 && (
            <>
              <ul className="mt-3 divide-y divide-[#E3E6EA] overflow-hidden rounded-lg border border-[#E3E6EA] bg-white">
                {load.items.map((item) => (
                  <TestListingRowView key={item.id} item={item} />
                ))}
              </ul>

              {confirming ? (
                <div className="mt-3 rounded-lg border border-[#F2C4C6] bg-[#FDF3F3] p-3">
                  <p className="text-[14px] text-[#15181C]">
                    {count} test ilanı videoları, fotoğrafları, yorumları ve bağlı sohbetleriyle kalıcı olarak silinecek.
                    Bu işlem geri alınamaz.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void deleteAll()}
                      disabled={deleting}
                      className="h-10 flex-1 rounded-md bg-[#C4282E] text-[14px] font-semibold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
                    >
                      {deleting ? "Siliniyor…" : "Evet, hepsini sil"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={deleting}
                      className="h-10 flex-1 rounded-md border border-[#C9CED6] bg-white text-[14px] font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
                    >
                      Vazgeç
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setConfirming(true);
                  }}
                  className="mt-3 h-10 rounded-md border border-[#C4282E] bg-white px-4 text-[14px] font-semibold text-[#C4282E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C4282E] focus-visible:ring-offset-2"
                >
                  Test ilanlarını sil ({count})
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function TestListingRowView({ item }: { item: TestListing }) {
  const status = STATUS_LABELS[item.status as VehicleStatus] ?? item.status;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md bg-[#DDE1E6]">
        {item.coverUrl && <Image src={item.coverUrl} alt="" fill sizes="48px" className="object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <a href={`/vehicles/${item.id}`} className="block truncate text-[15px] font-semibold text-[#15181C] hover:underline">
          {item.year} {item.title}
        </a>
        <span className="block truncate text-[13px] text-[#5B616B]">
          {currencySymbol(item.currency)}
          {formatAmount(item.price)} · {item.city ?? "—"} · {status} · {formatRelativeTime(item.createdAt)}
          {item.hasVideo ? "" : " · videosuz"}
        </span>
      </span>
    </li>
  );
}
