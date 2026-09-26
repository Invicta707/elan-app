# gözüyle (eski adı Elan): Handoff ve Bağlam Aktarımı

_Son güncelleme: 26 Eylül 2026_

**Proje:** Türkiye pazarı için kısa videolu araç ilanı platformu (dikey video akışı, arama, ilan verme, favoriler, WhatsApp ile iletişim).
**Konum:** `C:\Users\Kamil\elan-app` (Windows; Git Bash + PowerShell).
**Canlı adres:** https://gozuyle.com

## 1. Mimari ve teknolojiler

- **Next.js 16.3.6** (App Router, Turbopack), React 19.2, TypeScript.
  - [AGENTS.md](AGENTS.md) gereği kod yazmadan önce `node_modules/next/dist/docs/` okunmalı.
  - `params` ve `searchParams` Promise olarak geliyor; `themeColor` metadata'da değil, `viewport` export'unda.
- **Tailwind CSS 4.3:** `@container` sorguları kullanılıyor (başlık yerleşimi).
- **Supabase:** Auth (e-posta/şifre, magic link, Google OAuth; `flowType: implicit`), Postgres + RLS, Storage (`vehicle-photos` bucket).
  - Tarayıcı istemcisi [lib/supabase.ts](lib/supabase.ts): tembel Proxy, ilk kullanımda kurulur. Env eksikse import'ta değil kullanımda hata verir; `then` erişimini ayrıca karşılar.
  - Servis istemcisi [lib/supabase-server.ts](lib/supabase-server.ts): yalnızca API route'larında kullanılıyor.
- **Cloudflare Stream:** tus ile doğrudan yükleme ([lib/tus-upload.ts](lib/tus-upload.ts)), HLS oynatma (hls.js), imzalı webhook.
- **Vercel:** team ve proje `elan-app`, Node 24. GitHub `Invicta707/elan-app` reposunun `main` dalı otomatik olarak production'a deploy ediliyor; ayrıca `npx vercel --prod` (CLI 60.x) kullanılıyor.
- **Testler:** Vitest; 21 dosya, **216 test**, hepsi `lib/*.test.ts` altında. Uç nokta testleri de burada (örnek: `lib/reports-route.test.ts`, route'u `vi.resetModules` ile her testte yeniden yükler).
- **Veri modeli:**
  - Favoriler ayrı tabloda değil; `interactions` tablosunda `type='save'` satırı olarak tutuluyor (RLS, tekil indeks, `saves_count` tetikleyicisi).
  - `reports` tablosu: RLS açık, **hiç politika yok**; yalnızca API yazabiliyor.
  - Katalog: 36 marka, 300 model.

## 2. Kritik dosyalar

| Alan | Dosyalar |
|---|---|
| Üst çubuk | [components/FeedHeader.tsx](components/FeedHeader.tsx) (hook kullanmıyor), [components/HeaderProfileButton.tsx](components/HeaderProfileButton.tsx), [components/AuthGatedLink.tsx](components/AuthGatedLink.tsx) (`AuthModalPortal` da burada) |
| Alt menü | [components/BottomNav.tsx](components/BottomNav.tsx), [lib/navigation.ts](lib/navigation.ts) |
| Logo | [components/Logo.tsx](components/Logo.tsx): `className`, `iconClassName`, `showText` seçenekleri, `currentColor` |
| Giriş | [components/AuthModal.tsx](components/AuthModal.tsx) (Google + "veya" + e-posta formu) |
| Google dönüşü | [app/auth/callback/page.tsx](app/auth/callback/page.tsx), [components/AuthCallbackView.tsx](components/AuthCallbackView.tsx), [lib/auth-redirect.ts](lib/auth-redirect.ts) |
| Webhook | [app/api/webhooks/cloudflare/route.ts](app/api/webhooks/cloudflare/route.ts), [lib/cloudflare.ts](lib/cloudflare.ts) (`verifyWebhookSignature`), [lib/video-activation.ts](lib/video-activation.ts) |
| Hesap / silme | [components/AccountView.tsx](components/AccountView.tsx), [app/api/user/delete/route.ts](app/api/user/delete/route.ts), [lib/account-deletion.ts](lib/account-deletion.ts) |
| Bildirim | [components/ReportButton.tsx](components/ReportButton.tsx), [app/api/reports/route.ts](app/api/reports/route.ts), [lib/reports.ts](lib/reports.ts) (`REPORT_RATE_LIMIT`), [lib/rate-limit.ts](lib/rate-limit.ts) |
| Katalog / arama | [lib/search.ts](lib/search.ts) (`fetchCatalog`, `compareCatalogNames`), [components/SearchView.tsx](components/SearchView.tsx), [app/sell/page.tsx](app/sell/page.tsx) |
| Akış | [components/VideoCard.tsx](components/VideoCard.tsx) (sağ sütun: Favori, Paylaş, Detaylar, Bildir, Ses), [components/vehicle/ShareButton.tsx](components/vehicle/ShareButton.tsx), [lib/share.ts](lib/share.ts) |
| Site / yasal | [lib/site-url.ts](lib/site-url.ts), [lib/legal.ts](lib/legal.ts) (`NEXT_PUBLIC_SUPPORT_EMAIL`, yoksa `destek@gozuyle.com`), [app/privacy](app/privacy/page.tsx), [app/terms](app/terms/page.tsx) |
| PWA | [public/manifest.json](public/manifest.json) (`gözüyle`, `#0A0A0A`), [scripts/generate-icons.mjs](scripts/generate-icons.mjs) (ikonları ve `app/favicon.ico`'yu üretir) |
| Veritabanı | [supabase/migrations/](supabase/migrations/): 6 migration, sonuncusu `20260925230000_reports.sql`; hepsi uzak veritabanında uygulanmış |
| Ortam değişkenleri | [.env.example](.env.example); yerelde `.env.local` ve `.env.vercel` (ikisi de git dışında) |

## 3. 25–26 Eylül 2026 oturumunda tamamlananlar

- **Üst çubuk sadeleştirmesi:**
  - Logo yalnızca göz simgesi, **36 px** (`h-9 w-9`), dikeyde ortalı.
  - Sağdaki büyüteç kaldırıldı; "Akış" ve "Ara" sekmeleri kaldı.
  - Sağ uca profil butonu eklendi: misafirde giriş penceresi, oturum açıksa baş harfli avatar → `/account`.
  - Başlıktaki ve alt menüdeki "+" misafirde giriş penceresini açıyor, girişten sonra `/sell`'e gidiyor.
  - Eşikler ölçüme dayalı: kalp `md:@min-[19.75rem]`, "+" metni `@min-[32.5rem]`, "+" gizleme `md:@max-[16.5rem]`. 8 pencere boyutunda taşma yok.
- **Tıklanamayan pencere sorunu:** akış başlığındaki `pointer-events-none` yüzünden içinde açılan pencereler tıklanamıyordu. Giriş pencereleri artık `createPortal` ile `document.body`'ye taşınıyor; yazı tipleri `AuthModalPortal` içinde veriliyor.
- **Google ile giriş:**
  - `signInWithOAuth({ provider: "google", options: { redirectTo: origin + "/auth/callback" } })` kullanılıyor.
  - Dönüş yolu Google'a gitmeden önce `sessionStorage`'da (`gozuyle:auth-return`) saklanıyor; `safeReturnPath` yalnızca site içi göreli yolları kabul ediyor.
  - `/auth/callback`, `supabase.auth.getSession()` ile URL'deki oturumu işletiyor ve `router.replace` ile geri gönderiyor.
  - İptal ya da hata gelirse Türkçe mesaj gösteriyor.
  - Supabase'in `accounts.google.com`'a yönlendirdiği (istemci kimliği mevcut) doğrulandı.
- **Cloudflare webhook:** adres `https://gozuyle.com/api/webhooks/cloudflare` oldu; secret değişmedi. Canlıda imzalı testler: yanlış imza 401, doğru imza 200; "ready" testinde `unknown_video`, yani servis anahtarı veritabanına erişiyor.
- **Aynı oturumda daha önce yapılanlar:** arama kartlarının ilan sayfasına bağlanması, favoriler, katalog, test verisinin temizlenmesi, ilan bildirimi, yasal sayfalar, PWA manifest'i, paylaş butonu, hesap silme, Elan → gözüyle marka geçişi (commit'ler `6c6ec7d`…`c0a7d21`).
- **Model sıralaması (`4e1e2a4`):**
  - `compareCatalogNames` = `Intl.Collator("tr", { numeric: true, sensitivity: "base" }).compare`.
  - Marka/model listeleri (ilan verme ve arama filtreleri) ve hızlı arama önerileri bununla sıralanıyor. Peugeot: `206, 207, 208, 301, 308, 408, 508, 2008, 3008, 5008`.
  - Türkçe kuralında "I"nın küçüğü "ı": `clio` ile `CLIO` eşit sayılmaz. Bu doğru davranış.
- **`/api/reports` istek sınırı (`4e1e2a4`):**
  - Aynı IP'den 60 saniyede en fazla 5 istek. Aşılırsa `429`, `Retry-After` başlığı ve Türkçe mesaj döner.
  - Sınır her şeyden önce uygulanır: geçersiz istekler de sayılır ve veritabanına gidilmez.
  - IP, `x-real-ip` başlığından alınır, yoksa `x-forwarded-for`'daki ilk adresten.
  - Sayaç bellekte ve **sunucu örneği başına** tutulur. Canlıda 30 istekte 5 × 400 ve ardından 25 × 429 alındı. Deploy'dan hemen sonraki ilk 8 istekte 429 gelmemişti.

## 4. Git ve dağıtım durumu

- Son kod commit'i **`4e1e2a4`** ("feat: add natural numeric sorting for models and rate limiting to reports api"). Bu dosya ondan sonra ayrı bir dokümantasyon commit'iyle güncellendi; güncel `HEAD` için `git log -1` kullanın.
- `4e1e2a4`'ün production deploy'u (`elan-dt0fvy2l8`, git'ten) **Ready** durumunda ve `gozuyle.com`'a bağlı; canlı site ile repo aynı kodu çalıştırıyor.
- **Alan adları:** `gozuyle.com` 200. `elan-app-amber.vercel.app` 307 ile `gozuyle.com`'a yönlendiriyor. `www.gozuyle.com` son kontrolde yanıt vermiyordu.
- **Vercel env (Production + Preview):**
  - Config: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://gozuyle.com`.
  - Sensitive: `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET`.
  - `NEXT_PUBLIC_*` değerleri build sırasında pakete gömülür; değiştirince yeniden deploy gerekir.
- **Supabase CLI** global kurulu değil. Kullanılan yol: `~/AppData/Local/npm-cache/_npx/aa8e5c70f9d8d161/node_modules/.bin/supabase` (`db query/push --linked`). Docker olmadığı için `db dump` çalışmıyor.

## 5. Açık işler

**Kullanıcı tarafında:**

1. **Supabase → URL Configuration:** Site URL `https://gozuyle.com` olmalı; Redirect URLs'te `https://gozuyle.com/**` bulunmalı (`/auth/callback`'i kapsar). Bu doğrulanmadı ve Google girişi buna bağlı.
2. **Uçtan uca testler** (Claude giriş yapamadığı için denenmedi): Google girişi, oturum açıkken avatar, hesap silme (DB + `vehicle-photos` + Cloudflare temizliği).
3. **`www.gozuyle.com`:** Vercel → Domains'ten SSL ve DNS durumuna bakılmalı.
4. **`destek@gozuyle.com`:** gerçek bir posta kutusu ya da yönlendirme kurulmalı, ya da `NEXT_PUBLIC_SUPPORT_EMAIL` tanımlanmalı. Adres gizlilik politikasında yayında.
5. **Vercel'deki fazla kayıt:** Preview'a ait eski `CLOUDFLARE_STREAM_WEBHOOK_SECRET` kaydı (id `TZ5cSerrSmMsQUac`) silinmeli. API ile silme izin denetimine takılmıştı.
6. **Play Store (TWA):** `/.well-known/assetlinks.json` gerekiyor; bunun için imzalama sertifikasının SHA-256 parmak izi lazım.

**Teknik ve ürün:**

- `/api/reports` için kalıcı istek sınırı: koddaki sınır sunucu örneği başına çalışıyor. Kesin bir sınır için Vercel Firewall kuralı gerekiyor.
- Mobil operatörlerde birçok kullanıcı aynı IP'yi paylaşabilir; bu kullanıcılar dakikada 5 bildirim hakkını da paylaşır. Trafik artarsa sınır gözden geçirilmeli.
- Moderasyon paneli yok; bildirimler yalnızca Supabase panelinde görünüyor.
- Yasal metinler şablon; hukuki inceleme gerekiyor.
- Google onay ekranında `supabase.co` alan adı görünebilir; istenirse Supabase'e özel alan adı bağlanabilir.

## Çalışma notları ve tuzaklar

- **Görsel doğrulama** üretim derlemesiyle yapılmalı: `npm run build`, ardından `.claude/launch.json` → `elan-prod` (port 3100). `next dev` yeni Tailwind sınıflarını bazen geç üretiyor.
- **Bayat tip çıktısı:** geliştirme sunucusu açıkken bir sayfa silinirse build düşer; önce `rm -rf .next/dev`.
- **`vercel link`:** `.gitignore`'a tekrar eden satırlar ekliyor (bunlar `.env.example` istisnasını bozuyor) ve `.env.local`'e `VERCEL_OIDC_TOKEN` yazıyor. `.gitignore` geri alınmalı; bu token Vercel'e aktarılmamalı.
- **Gizli değerler** asla sohbete yazdırılmaz; yalnızca stdin ile aktarılır, adları ya da maskeli başları gösterilir.
- **Tarayıcı paneli** ekranda çizilmediğinde ekran görüntüsü ve koordinatlı tıklama hatalı oluyor; ölçüm ve tıklama JavaScript ile yapılmalı.
- **Kontrol komutları:** `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint`, `npm run build`.
