"use client";

import type { User } from "@supabase/supabase-js";
import { ChevronLeft, ChevronRight, ExternalLink, LogOut, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { clearAppCache, estimateStorageUsage, formatBytes } from "../../lib/app-cache";
import { useSupabaseSession } from "../../lib/auth";
import { LEGAL_CONTACT_EMAIL } from "../../lib/legal";
import { suggestedDisplayName } from "../../lib/profile";
import { clearCatalogCache } from "../../lib/search";
import {
  fetchBlockedUsers,
  readNotificationPrefs,
  saveNotificationPrefs,
  signInMethodLabel,
  type BlockedUser,
  type NotificationPrefs,
} from "../../lib/settings";
import { supabase } from "../../lib/supabase";
import { useAdminStatus } from "../../lib/use-admin-status";
import { resetFollowStore } from "../../lib/use-follow";
import { useMyProfile } from "../../lib/use-my-profile";
import { suggestUsername } from "../../lib/username";
import AuthModal from "../AuthModal";
import FeedHeader from "../FeedHeader";
import { ADMIN_PANEL_PATH, ADMIN_REVIEW_PATH } from "../moderation/AdminEntryCard";
import EditNameSheet from "../profile/EditNameSheet";
import UsernameSheet from "../profile/UsernameSheet";
import Avatar from "../ui/Avatar";
import BottomSheet from "../ui/BottomSheet";
import Switch from "../ui/Switch";
import BlockedUsersSheet from "./BlockedUsersSheet";
import DeleteAccountDialog from "./DeleteAccountDialog";

// /settings: hesap bilgileri, bildirim tercihleri, engellenen kullanıcılar,
// önbelleği temizleme, yasal metinler, çıkış ve hesap silme (Google Play zorunluluğu).
export default function SettingsView() {
  const { session, isLoading } = useSupabaseSession();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [deleted, setDeleted] = useState(false);

  return (
    <>
      <FeedHeader activeTab="my-listings" tone="solid" />
      <div className="mx-auto max-w-2xl px-4 pt-1 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))]">
        <div className="-ml-2 flex items-center gap-1">
          <Link
            href="/my-listings"
            aria-label="Vitrinim'e dön"
            className="flex h-11 w-11 items-center justify-center rounded-full text-[#15181C] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            <ChevronLeft aria-hidden="true" className="h-6 w-6" />
          </Link>
          <h1 className="text-[24px] font-semibold leading-tight [font-family:var(--font-display)]">Ayarlar</h1>
        </div>

        {deleted ? (
          <div role="status" className="mt-8 rounded-2xl bg-white p-6 text-center">
            <p className="text-[16px] font-semibold">Hesabın ve tüm verilerin silindi.</p>
            <p className="mt-1 text-[14px] text-[#5B616B]">gözüyle&apos;yi kullandığın için teşekkürler.</p>
            <Link
              href="/"
              className="mt-4 inline-flex h-11 items-center rounded-xl bg-[#003399] px-5 text-[15px] font-semibold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
            >
              Ana sayfaya dön
            </Link>
          </div>
        ) : isLoading ? (
          <div aria-hidden="true" className="mt-4 space-y-4">
            {[88, 200, 160].map((h) => (
              <div key={h} style={{ height: h }} className="rounded-2xl bg-[#E3E6EA] motion-safe:animate-pulse" />
            ))}
          </div>
        ) : session ? (
          <SignedInSettings user={session.user} onDeleted={() => setDeleted(true)} />
        ) : (
          <>
            <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-7 text-center">
              <p className="text-[15px] text-[#5B616B]">Hesap ayarlarını görmek için giriş yap.</p>
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="h-12 rounded-xl bg-[#003399] px-7 text-[16px] font-semibold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
              >
                Giriş yap
              </button>
              <p className="max-w-sm text-[13px] leading-relaxed text-[#5B616B]">
                Hesabına giriş yapamıyorsan, hesabının ve verilerinin silinmesini{" "}
                <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="font-semibold text-[#003399] underline">
                  {LEGAL_CONTACT_EMAIL}
                </a>{" "}
                adresinden talep edebilirsin.
              </p>
            </div>
            <AppGroup />
            <LegalGroup />
          </>
        )}
      </div>

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onAuthenticated={() => setShowAuthModal(false)} />
      )}
    </>
  );
}

function SignedInSettings({ user, onDeleted }: { user: User; onDeleted: () => void }) {
  const { profile } = useMyProfile();
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => readNotificationPrefs(user.user_metadata));
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);
  const [blockedError, setBlockedError] = useState(false);
  const [sheet, setSheet] = useState<"name" | "username" | "blocked" | "delete" | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [blockedLoad, setBlockedLoad] = useState(0);

  useEffect(() => {
    let active = true;
    fetchBlockedUsers()
      .then((list) => active && setBlocked(list))
      .catch(() => active && setBlockedError(true));
    return () => {
      active = false;
    };
  }, [blockedLoad]);

  function retryBlocked() {
    setBlockedError(false);
    setBlocked(null);
    setBlockedLoad((n) => n + 1);
  }

  async function togglePref(key: keyof NotificationPrefs, value: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setPrefsError(null);
    try {
      await saveNotificationPrefs(next);
    } catch (error) {
      setPrefs(previous);
      setPrefsError(error instanceof Error ? error.message : "Tercih kaydedilemedi.");
    }
  }

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut().catch(() => {});
    setSigningOut(false);
  }

  const name = profile?.displayName ?? null;
  const username = profile?.username ?? null;
  const email = user.email ?? null;

  return (
    <>
      <Link
        href="/my-listings"
        className="mt-3 flex items-center gap-3.5 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:bg-[#FAFBFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
      >
        <Avatar url={profile?.avatarUrl} name={name ?? email} size={56} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold">{name ?? "Adını ekle"}</span>
          <span className="block truncate text-[14px] text-[#5B616B]">
            {username ? `@${username}` : email}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[#8A9099]" />
      </Link>

      <AdminGroup />

      <Group title="Hesap">
        <Row label="Görünen ad" value={name ?? "Ekle"} onClick={() => setSheet("name")} />
        <Row label="Kullanıcı adı" value={username ? `@${username}` : "Belirle"} onClick={() => setSheet("username")} />
        <Row label="E-posta" value={email ?? "—"} />
        <Row label="Giriş yöntemi" value={signInMethodLabel(user)} />
      </Group>

      <Group
        title="Bildirimler"
        footer="Anlık bildirimler yakında açılacak. Tercihlerin şimdiden hesabına kaydediliyor; bildirimler bunlara göre gönderilecek."
      >
        <Switch
          label="Mesajlar"
          description="Biri sana mesaj gönderdiğinde"
          checked={prefs.messages}
          onChange={(value) => void togglePref("messages", value)}
        />
        <Switch
          label="Yeni takipçiler"
          description="Biri seni takip ettiğinde"
          checked={prefs.followers}
          onChange={(value) => void togglePref("followers", value)}
        />
        <Switch
          label="Takip ettiklerinin ilanları"
          description="Takip ettiğin satıcı yeni ilan yayınladığında"
          checked={prefs.followingListings}
          onChange={(value) => void togglePref("followingListings", value)}
        />
      </Group>
      {prefsError && (
        <p role="alert" className="mt-2 px-4 text-[13px] font-medium text-[#B42318]">
          {prefsError}
        </p>
      )}

      <Group title="Gizlilik ve güvenlik">
        <Row
          label="Engellenen kullanıcılar"
          value={blockedError ? "Yüklenemedi" : blocked === null ? "…" : blocked.length === 0 ? "Yok" : String(blocked.length)}
          onClick={() => {
            if (blockedError) retryBlocked();
            setSheet("blocked");
          }}
        />
      </Group>

      <AppGroup />
      <LegalGroup />

      <Group>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15.5px] font-semibold text-[#15181C] transition-colors hover:bg-[#F7F8FA] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#003399]"
        >
          <LogOut aria-hidden="true" className="h-5 w-5 text-[#5B616B]" />
          {signingOut ? "Çıkış yapılıyor…" : "Çıkış yap"}
        </button>
      </Group>

      <section aria-labelledby="delete-account" className="mt-6 rounded-2xl border border-[#F1C7C3] bg-white p-4">
        <h2 id="delete-account" className="text-[16px] font-semibold text-[#B42318]">
          Hesabı sil
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-[#4A5058]">
          Hesabın; tüm ilanların (videoları ve fotoğraflarıyla), favorilerin, mesajların, takiplerin ve iletişim
          bilgilerinle birlikte kalıcı olarak silinir. Bu işlem geri alınamaz.
        </p>
        <button
          type="button"
          onClick={() => setSheet("delete")}
          aria-haspopup="dialog"
          className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl border border-[#B42318] px-4 text-[15px] font-semibold text-[#B42318] transition-colors hover:bg-[#FDEDEC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B42318] focus-visible:ring-offset-2"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Hesabımı Sil
        </button>
      </section>

      {sheet === "name" && (
        <EditNameSheet initialName={name ?? suggestedDisplayName(user.user_metadata)} onClose={() => setSheet(null)} />
      )}
      {sheet === "username" && (
        <UsernameSheet
          mode={username ? "edit" : "onboarding"}
          initialValue={username ?? suggestUsername(name ?? suggestedDisplayName(user.user_metadata), email)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "blocked" && (
        <BlockedUsersSheet
          myId={user.id}
          users={blocked}
          failed={blockedError}
          onRetry={retryBlocked}
          onUnblocked={(id) => setBlocked((list) => (list ?? []).filter((u) => u.id !== id))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "delete" && (
        <DeleteAccountDialog
          email={email}
          onClose={() => setSheet(null)}
          onDeleted={() => {
            setSheet(null);
            onDeleted();
          }}
        />
      )}
    </>
  );
}

/** Yalnızca yöneticiye: ilan onay paneli ve bekleyen sayısı (sunucu söyler, bkz. useAdminStatus) */
function AdminGroup() {
  const status = useAdminStatus();
  if (!status?.admin) return null;
  const pending = status.pendingListings;
  return (
    <Group title="Yönetim">
      <Row
        label="İlan Onay Paneli"
        value={pending === null ? undefined : pending > 0 ? `${pending} onay bekliyor` : "Bekleyen yok"}
        href={pending ? ADMIN_REVIEW_PATH : ADMIN_PANEL_PATH}
      />
    </Group>
  );
}

/** Önbelleği temizle: geçici verileri siler, sayfayı yeniden yükler (oturum ve favoriler korunur) */
function AppGroup() {
  const [usage, setUsage] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let active = true;
    void estimateStorageUsage(navigator.storage).then((bytes) => active && setUsage(bytes));
    return () => {
      active = false;
    };
  }, []);

  async function clear() {
    setClearing(true);
    await clearAppCache({
      caches: "caches" in window ? window.caches : undefined,
      serviceWorker: navigator.serviceWorker,
      sessionStorage: window.sessionStorage,
      clearMemory: () => {
        clearCatalogCache();
        resetFollowStore();
      },
    }).catch((error) => console.error("Önbellek temizlenemedi:", error));
    window.location.reload();
  }

  return (
    <>
      <Group title="Uygulama" footer="Geçici verileri siler ve uygulamayı en güncel sürümle yeniden yükler. Oturumun ve favorilerin korunur.">
        <Row
          label="Önbelleği temizle"
          value={clearing ? "Temizleniyor…" : usage ? formatBytes(usage) : undefined}
          onClick={() => setConfirming(true)}
        />
      </Group>
      {confirming && (
        <BottomSheet
          title="Önbellek temizlensin mi?"
          onClose={() => setConfirming(false)}
          actions={[
            {
              label: "Önbelleği temizle",
              description: "Oturumun ve favorilerin korunur; uygulama yeniden yüklenir.",
              icon: <RotateCcw className="h-5 w-5" />,
              onSelect: () => {
                setConfirming(false);
                void clear();
              },
            },
          ]}
        />
      )}
    </>
  );
}

function LegalGroup() {
  return (
    <Group title="Yasal ve destek">
      <Row label="KVKK Aydınlatma Metni" href="/privacy#haklarin" />
      <Row label="Gizlilik Politikası" href="/privacy" />
      <Row label="Kullanım Koşulları" href="/terms" />
      <Row label="Destek" value={LEGAL_CONTACT_EMAIL} href={`mailto:${LEGAL_CONTACT_EMAIL}`} external />
    </Group>
  );
}

/** Gruplanmış liste: başlık, beyaz kart, satırlar arasında ince çizgi */
function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-6">
      {title && <h2 className="mb-1.5 px-4 text-[13px] font-semibold uppercase tracking-[0.04em] text-[#5B616B]">{title}</h2>}
      <div className="divide-y divide-[#EEF0F3] overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {children}
      </div>
      {footer && <p className="mt-1.5 px-4 text-[12.5px] leading-snug text-[#5B616B]">{footer}</p>}
    </section>
  );
}

const ROW_CLASS =
  "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#003399]";

/** Satır: etiket ve değer; dokunulabilirse (onClick / href) sağda ok */
function Row({
  label,
  value,
  onClick,
  href,
  external = false,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  href?: string;
  external?: boolean;
}) {
  const content = (
    <>
      <span className="shrink-0 text-[15.5px] font-semibold text-[#15181C]">{label}</span>
      {value && <span className="min-w-0 flex-1 truncate text-right text-[15px] text-[#5B616B]">{value}</span>}
      {!value && <span className="flex-1" />}
      {(onClick || href) &&
        (external ? (
          <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-[#8A9099]" />
        ) : (
          <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[#8A9099]" />
        ))}
    </>
  );

  if (href) {
    return external ? (
      <a href={href} className={`${ROW_CLASS} hover:bg-[#F7F8FA]`}>
        {content}
      </a>
    ) : (
      <Link href={href} className={`${ROW_CLASS} hover:bg-[#F7F8FA]`}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-haspopup="dialog" className={`${ROW_CLASS} hover:bg-[#F7F8FA]`}>
        {content}
      </button>
    );
  }
  return <div className={ROW_CLASS}>{content}</div>;
}
