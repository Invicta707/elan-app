# gözüyle (eski adı Elan): Handoff ve Bağlam Aktarımı

_Son güncelleme: 27 Eylül 2026_

**Proje:** Türkiye pazarı için kısa videolu araç ilanı platformu (dikey video akışı, arama, ilan verme, favoriler, WhatsApp ve ilan üzerinden mesajlaşma, kullanıcı adı ve takip sistemi, "Takip Edilenler" akışı).
**Konum:** `C:\Users\Kamil\elan-app` (Windows; Git Bash + PowerShell).
**Canlı adres:** https://gozuyle.com

## 1. Mimari ve teknolojiler

- **Next.js 16.3.6** (App Router, Turbopack), React 19.2, TypeScript.
  - [AGENTS.md](AGENTS.md) gereği kod yazmadan önce `node_modules/next/dist/docs/` okunmalı.
  - `params` ve `searchParams` Promise olarak geliyor; `themeColor` metadata'da değil, `viewport` export'unda.
- **Tailwind CSS 4.3:** `@container` sorguları kullanılıyor (başlık yerleşimi).
- **Supabase:** Auth (e-posta/şifre, magic link, Google OAuth; `flowType: implicit`), Postgres + RLS, Storage (uygulama `vehicle-photos` bucket'ını kullanıyor: 10 MB, jpeg/png/webp; `vehicle-images` bucket'ı da var ama kullanılmıyor).
  - Tarayıcı istemcisi [lib/supabase.ts](lib/supabase.ts): tembel Proxy, ilk kullanımda kurulur. Env eksikse import'ta değil kullanımda hata verir; `then` erişimini ayrıca karşılar.
  - Servis istemcisi [lib/supabase-server.ts](lib/supabase-server.ts): yalnızca API route'larında kullanılıyor.
- **Cloudflare Stream:** tus ile doğrudan yükleme ([lib/tus-upload.ts](lib/tus-upload.ts)), HLS oynatma (hls.js), imzalı webhook.
- **Vercel:** team ve proje `elan-app`, Node 24. GitHub `Invicta707/elan-app` reposunun `main` dalı otomatik olarak production'a deploy ediliyor; ayrıca `npx vercel --prod` (CLI 60.x) kullanılıyor.
- **Testler:** Vitest; 55 dosya, **1170 test**, hepsi `lib/*.test.ts(x)` altında. Bileşen testleri `lib/ui-components.test.tsx`'te: dosyanın başındaki `// @vitest-environment happy-dom` yorumu happy-dom'u açıyor (devDependency'ler: `happy-dom`, `@testing-library/react`, `@testing-library/dom`); `next/image` ve `next/link` sade HTML öğeleriyle taklit ediliyor. Uç nokta testleri de burada (örnek: `lib/reports-route.test.ts`, route'u `vi.resetModules` ile her testte yeniden yükler).
  - **Veritabanı güvenlik testleri** ([lib/listing-rls.test.ts](lib/listing-rls.test.ts)): migration dosyalarını gerçek bir Postgres'te (PGlite, WASM; devDependency `@electric-sql/pglite`) çalıştırır. Satıcı, anonim kullanıcı, servis anahtarı ve yönetici istekleri `set local role` ile `request.jwt.claims` üzerinden taklit edilir. Başlangıç şeması, uzak veritabanından okunmuş tanımların asgari kopyasıdır; RLS/tetikleyici değişince oradaki `BASE_SCHEMA` da güncellenmeli.
- **Veri modeli:**
  - Favoriler ayrı tabloda değil; `interactions` tablosunda `type='save'` satırı olarak tutuluyor (RLS, tekil indeks, `saves_count` tetikleyicisi).
  - `reports` tablosu: RLS açık, **hiç politika yok**; yalnızca API yazabiliyor. Kapanan bildirimde `resolved_at` ve `resolved_by` dolar. İlan şikayetleri (sohbet menüsünden gelenler dahil) buraya gidiyor.
  - **`profiles`:** `whatsapp_number`, `display_name` (2–30 karakter, `<>` yok), `avatar_url`, `username`, `username_changed_at`, `followers_count`, `following_count`. Satırı **yalnızca sahibi okuyor.** Başkalarının profili `get_public_profile` / `get_public_profiles` ve mesajlaşma RPC'lerinden geliyor; numara yalnızca `get_seller_whatsapp` ile. `avatar_url`'ı yalnızca sunucu, `username`'i yalnızca `set_username`, sayaçları yalnızca `follows` tetikleyicisi yazabiliyor. `display_name` uygulamada `update_profile_display_name` RPC'siyle yazılıyor. Sütun yetkileri: INSERT yalnızca `id, whatsapp_number, display_name`, UPDATE bunlara ek olarak `updated_at`. **Dikkat:** istemci profiles'a `updated_at` içeren upsert yaparsa INSERT yetkisi olmadığı için 42501 alır; ad kaydetme hatası buydu.
  - **Kullanıcı adı:** benzersiz, küçük harf, `^[a-z0-9_]{3,20}$`. Rezerve: sistem sayfaları ve uygulama sözcükleri (`fn_reserved_usernames`, 99 sözcük), `gozuyle` içeren adlar, `admin`/`moderator`/`destek`/`support` ile başlayanlar. Kural `profiles_username_valid` CHECK kısıtında (`fn_is_valid_username`): servis anahtarı dahil her yazımda geçerli. TS aynası [lib/username.ts](lib/username.ts); eşitliği testler denetliyor.
  - **`follows`:** `id`, `follower_id`, `following_id` (ikisi de `profiles.id`'ye, CASCADE), `created_at`. `(follower_id, following_id)` benzersiz, kendini takip CHECK ile yasak. Herkes okur; yalnızca kendi adına ekler/siler, güncelleme yok; aralarında engel varsa takip edilemez, engellenince iki yöndeki takip silinir. Takip edenin saatte 100, toplamda 5000 sınırı var. Profil satırı olmayan kullanıcı takip ederse satır tetikleyiciyle açılır.
  - **Mesajlaşma:** `conversations` (ilanlı: ilan + alıcı tekil; doğrudan: `listing_id` boş, iki kişi arasında tek konuşma, `conversations_direct_pair_key`), `messages`, `user_blocks`, `user_reports`. RLS: yalnızca iki taraf okuyor/yazıyor, engel varsa gönderilemiyor. `is_read` ve `created_at` istemciden yazılamıyor. Gönderen başına dakikada 30 mesaj. `messages` Realtime yayınında.
  - **Storage `avatars`:** herkese açık okunuyor, 1 MB, webp/jpeg/png (png 27 Eylül 2026'da eklendi). Yazma yalnızca sunucudan (`/api/profile/avatar`, servis anahtarı).
  - **İlan durumu:** `draft`, `pending_video`, `pending_moderation` (içerik denetiminde ya da şüpheli, akışta görünmez), `pending_approval` (otomatik tarama temiz, **yönetici onayı bekliyor**, akışta görünmez), `active`, `sold`, `archived`, `rejected` (moderasyonla kaldırıldı ya da içerik denetiminden geçmedi). Satıcının geçişleri tek tabloda: `set_vehicle_status` RPC'si, `trg_vehicles_guard_owner_status` tetikleyicisi ve [lib/listing-status.ts](lib/listing-status.ts) `OWNER_TRANSITIONS`. Testler üçünün aynı kaldığını denetliyor. Satıcı `pending_moderation` ve `pending_approval` durumlarına ne girebilir ne çıkabilir.
  - **Yayın şartı:** ilan yalnızca işlenmiş bir videosu varsa (`videos.status = 'ready'` ve `hls_url` dolu) **ve içerik denetimi onaylıysa** (`moderation_status = 'approved'`) `active` olabilir. Kural isteği kim yaparsa yapsın geçerli; fotoğraf tek başına yetmez. **`approved`'ı yalnızca yöneticinin /admin/reports'taki "Onayla" kararı yazar**; otomatik denetim hiçbir ilanı yayına almaz.
  - **İçerik denetimi alanları:** `vehicles.moderation_status` (`pending` | `approved` | `rejected`), `moderation_reason` (ör. `sexual`, `review:gore,unavailable`, `manual`), `moderated_at`. Yalnızca sunucu yazar (`trg_vehicles_guard_content`). İlan denetime girdikten sonra satıcı açıklamayı değiştiremez, fotoğraf ya da video ekleyemez. Kararlar `content_moderation_events`'e yazılıyor (yalnızca servis anahtarı; metnin ya da görselin kendisi saklanmıyor).
  - **Fotoğraf adresi:** `vehicle_images.image_url` yalnızca `https://<proje>.supabase.co/storage/v1/object/public/vehicle-photos/<ilan>/<sıra>.<uzantı>` olabilir (`fn_is_vehicle_photo_url`). Proje adresi migration'a sabit yazıldı.
  - Katalog: 36 marka, 300 model (kürate edilmiş, `is_user_created = false`).
  - **Kullanıcının yazdığı marka/model:** kataloğa `is_user_created = true` ve `created_by` ile eklenir.
    - Ekleme yalnızca `resolve_listing_catalog` RPC'siyle yapılıyor: giriş şart, ad denetleniyor, kullanıcı başına 24 saatte 10 yeni kayıt sınırı var.
    - Aynı adın farklı yazımları tek kayıttır: `fn_catalog_key` ile büyük/küçük harf, Türkçe/aksanlı harf ve noktalama önemsiz; benzersiz indeks bunu zorluyor.
    - Bu kayıtlar arama filtrelerine ve seçim kutusuna girmiyor, ilanda adıyla görünüyor. `vehicles.brand_id` / `model_id` yabancı anahtarları değişmedi.

## 2. Kritik dosyalar

| Alan | Dosyalar |
|---|---|
| Üst çubuk | [components/FeedHeader.tsx](components/FeedHeader.tsx) (hook kullanmıyor; `center` verilince ortadaki "Akış | Ara" yerine o çizilir ve sağ üste büyüteç eklenir; ana sayfada mobilde büyüteç profil düğmesinin yerini alır), [components/HeaderProfileButton.tsx](components/HeaderProfileButton.tsx), [components/AuthGatedLink.tsx](components/AuthGatedLink.tsx) (`AuthModalPortal` da burada) |
| Alt menü | [components/BottomNav.tsx](components/BottomNav.tsx), [lib/navigation.ts](lib/navigation.ts) |
| Logo | [components/Logo.tsx](components/Logo.tsx): `className`, `iconClassName`, `showText` seçenekleri, `currentColor` |
| Giriş | [components/AuthModal.tsx](components/AuthModal.tsx) (Google + "veya" + e-posta formu) |
| Google dönüşü | [app/auth/callback/page.tsx](app/auth/callback/page.tsx), [components/AuthCallbackView.tsx](components/AuthCallbackView.tsx), [lib/auth-redirect.ts](lib/auth-redirect.ts) |
| Webhook | [app/api/webhooks/cloudflare/route.ts](app/api/webhooks/cloudflare/route.ts), [lib/cloudflare.ts](lib/cloudflare.ts) (`verifyWebhookSignature`), [lib/video-activation.ts](lib/video-activation.ts) |
| Ayarlar / hesap silme | [app/settings/page.tsx](app/settings/page.tsx), [lib/app-cache.ts](lib/app-cache.ts) (önbelleği temizle), [components/settings/SettingsView.tsx](components/settings/SettingsView.tsx), [components/settings/DeleteAccountDialog.tsx](components/settings/DeleteAccountDialog.tsx), [components/settings/BlockedUsersSheet.tsx](components/settings/BlockedUsersSheet.tsx), [components/ui/Switch.tsx](components/ui/Switch.tsx), [lib/settings.ts](lib/settings.ts) (bildirim tercihleri, engellenenler), [app/account/page.tsx](app/account/page.tsx) (308 → `/settings`), [app/api/user/delete/route.ts](app/api/user/delete/route.ts), [lib/account-deletion.ts](lib/account-deletion.ts) |
| Bildirim | [components/ReportButton.tsx](components/ReportButton.tsx), [app/api/reports/route.ts](app/api/reports/route.ts), [lib/reports.ts](lib/reports.ts) (`REPORT_RATE_RULES`, `REPORT_BURST_LIMIT`), [lib/rate-limit.ts](lib/rate-limit.ts) (bellek içi, `rateLimitSubject`), [lib/rate-limit-server.ts](lib/rate-limit-server.ts) (kalıcı sayaç, HMAC anahtarı), [lib/rate-limit-db.test.ts](lib/rate-limit-db.test.ts) (PGlite) |
| Moderasyon | [app/admin/reports/page.tsx](app/admin/reports/page.tsx), [components/ModerationView.tsx](components/ModerationView.tsx), [app/api/admin/reports/route.ts](app/api/admin/reports/route.ts), [lib/moderation.ts](lib/moderation.ts), [lib/moderation-server.ts](lib/moderation-server.ts) (`authorizeAdmin`: `ADMIN_EMAILS`, onaylı e-posta) |
| İçerik denetimi | [lib/content-moderation.ts](lib/content-moderation.ts) (kategoriler, %60 / %40 eşikleri, karar, video kareleri, kullanıcı metinleri), [lib/moderation-providers.ts](lib/moderation-providers.ts) (Sightengine, Rekognition, OpenAI; ortam değişkeniyle seçim), [lib/aws-sigv4.ts](lib/aws-sigv4.ts), [lib/content-moderation-server.ts](lib/content-moderation-server.ts) (görsel/metin denetimi, avatar kararı, kayıt), [lib/listing-moderation.ts](lib/listing-moderation.ts) (ilan hattı, Supabase deposu, elle karar), [lib/text-moderation.ts](lib/text-moderation.ts) (Türkçe kelime filtresi; SQL aynası migration'da), [lib/video-activation.ts](lib/video-activation.ts) (karantina), [app/api/admin/listings/route.ts](app/api/admin/listings/route.ts), [components/moderation/PendingListingsSection.tsx](components/moderation/PendingListingsSection.tsx), [app/api/messages/route.ts](app/api/messages/route.ts), [lib/content-moderation-rls.test.ts](lib/content-moderation-rls.test.ts) (PGlite) |
| Vitrinim / durum | [components/showcase/ShowcaseView.tsx](components/showcase/ShowcaseView.tsx) (profil başlığı + 3 sütunlu dikey ızgara), [components/showcase/ShowcaseTile.tsx](components/showcase/ShowcaseTile.tsx), [components/showcase/ListingManageSheet.tsx](components/showcase/ListingManageSheet.tsx) (durum değiştirme), [lib/my-listings.ts](lib/my-listings.ts), [lib/showcase.ts](lib/showcase.ts), [lib/listing-status.ts](lib/listing-status.ts), [lib/listing-rls.test.ts](lib/listing-rls.test.ts) |
| Profil | [components/profile/AvatarPicker.tsx](components/profile/AvatarPicker.tsx), [components/profile/EditNameSheet.tsx](components/profile/EditNameSheet.tsx), [lib/profile.ts](lib/profile.ts), [lib/use-my-profile.ts](lib/use-my-profile.ts) (paylaşılan profil deposu), [lib/avatar.ts](lib/avatar.ts), [lib/avatar-image.ts](lib/avatar-image.ts) (tarayıcıda kare kırpma ve WebP), [lib/avatar-server.ts](lib/avatar-server.ts), [app/api/profile/avatar/route.ts](app/api/profile/avatar/route.ts); görsel tür kuralları ve açma, `/sell` ile ortak: [lib/image-file.ts](lib/image-file.ts), [lib/image-decode.ts](lib/image-decode.ts) |
| Mesajlaşma | [app/messages/page.tsx](app/messages/page.tsx), [app/messages/[id]/page.tsx](app/messages/[id]/page.tsx), [components/messages/InboxView.tsx](components/messages/InboxView.tsx), [components/messages/ChatView.tsx](components/messages/ChatView.tsx) (Realtime, klavye), [components/messages/ChatParts.tsx](components/messages/ChatParts.tsx), [components/messages/ReportUserSheet.tsx](components/messages/ReportUserSheet.tsx), [components/vehicle/MessageSellerButton.tsx](components/vehicle/MessageSellerButton.tsx), [components/social/MessageUserButton.tsx](components/social/MessageUserButton.tsx) (profilden doğrudan mesaj), [lib/messages.ts](lib/messages.ts) (`startConversation`, `startDirectConversation`), [lib/use-unread-count.ts](lib/use-unread-count.ts), [lib/messaging-rls.test.ts](lib/messaging-rls.test.ts) (PGlite) |
| Kullanıcı adı | [lib/username.ts](lib/username.ts) (kural, rezerve liste, Türkçe harf süzme, öneri), [lib/use-username-check.ts](lib/use-username-check.ts) (400 ms bekleyen canlı kontrol), [components/profile/UsernameField.tsx](components/profile/UsernameField.tsx), [components/profile/UsernameSheet.tsx](components/profile/UsernameSheet.tsx), [components/profile/UsernameOnboarding.tsx](components/profile/UsernameOnboarding.tsx) (layout'ta), `checkUsernameAvailability` / `saveUsername` [lib/profile.ts](lib/profile.ts)'te |
| Takip / profil sayfası | [app/u/[username]/page.tsx](app/u/[username]/page.tsx) (`/@ad` → rewrite, [next.config.ts](next.config.ts)), [components/social/ProfileHeader.tsx](components/social/ProfileHeader.tsx), [components/social/FollowButton.tsx](components/social/FollowButton.tsx), [components/social/SellerRow.tsx](components/social/SellerRow.tsx) (akış kartı), [components/social/SellerCard.tsx](components/social/SellerCard.tsx) (ilan sayfası), [lib/follows.ts](lib/follows.ts) (RPC'ler, dönüşümler), [lib/use-follow.ts](lib/use-follow.ts) (takip durumu ve satıcı profilleri deposu), [lib/social-rls.test.ts](lib/social-rls.test.ts) (PGlite) |
| Ana sayfa akışı | [components/HomeFeed.tsx](components/HomeFeed.tsx) (Keşfet / Takip Edilenler), [components/social/FeedTabs.tsx](components/social/FeedTabs.tsx), [components/social/FollowingEmpty.tsx](components/social/FollowingEmpty.tsx), [components/VideoFeed.tsx](components/VideoFeed.tsx) (`source`, `visible`, `emptyState`), [lib/feed.ts](lib/feed.ts) (`fetchFeedPage(cursor, size, source)`) |
| Ortak arayüz | [components/ui/BottomSheet.tsx](components/ui/BottomSheet.tsx), [components/ui/Avatar.tsx](components/ui/Avatar.tsx), [components/ui/UnreadBadge.tsx](components/ui/UnreadBadge.tsx); animasyonlar `app/globals.css`'te (`sheet-up`, `badge-pop`, `bubble-in`, `fade-in`) |
| Katalog / arama | [lib/search.ts](lib/search.ts) (`fetchCatalog`, `fetchCatalogCached` (10 dk önbellek), `compareCatalogNames`), [app/search/loading.tsx](app/search/loading.tsx) (anında iskelet), [components/SearchView.tsx](components/SearchView.tsx), [app/sell/page.tsx](app/sell/page.tsx) |
| İlan verme (`/sell`) | [app/sell/page.tsx](app/sell/page.tsx): adım durumu, doğrulama, gönderim (`runSubmit`, `uploadPhotos`). [app/sell/layout.tsx](app/sell/layout.tsx): yazı tipleri ve başlık. [components/sell/FormControls.tsx](components/sell/FormControls.tsx): `Field`, `TextInput`, `GroupedNumberInput`, `SelectInput`, `ChoiceGroup`. [components/sell/CatalogCombobox.tsx](components/sell/CatalogCombobox.tsx): marka/model seçim kutusu. [components/sell/MediaPickers.tsx](components/sell/MediaPickers.tsx): `VideoDropzone`, `PhotoDropzone`. [components/sell/SellChrome.tsx](components/sell/SellChrome.tsx): `SellStepper`, `FormCard`, `SubmitProgress`, `SellActionBar`, `SellSuccess`. [lib/listing.ts](lib/listing.ts): `LISTING_STEPS`, `listingFieldErrors`, `stepFieldErrors`, `groupThousands`, `caretAfterDigits`. [lib/sell-progress.ts](lib/sell-progress.ts): gönderim aşamaları ve yüzde |
| Akış | [components/VideoCard.tsx](components/VideoCard.tsx) (sağ sütun: Favori, Paylaş, Detaylar, Bildir, Ses), [components/vehicle/ShareButton.tsx](components/vehicle/ShareButton.tsx), [lib/share.ts](lib/share.ts) |
| Site / yasal | [lib/site-url.ts](lib/site-url.ts), [lib/legal.ts](lib/legal.ts) (`NEXT_PUBLIC_SUPPORT_EMAIL`, yoksa `destek@gozuyle.com`), [app/privacy](app/privacy/page.tsx), [app/terms](app/terms/page.tsx) |
| Marka | [lib/brand-mark.ts](lib/brand-mark.ts) (göz hattı + oynat üçgeni, tek kaynak), [components/brand/EyePlayMark.tsx](components/brand/EyePlayMark.tsx), [components/Logo.tsx](components/Logo.tsx); duraklatma simgesi [components/VideoCard.tsx](components/VideoCard.tsx) |
| PWA / TWA | [public/manifest.json](public/manifest.json) (`gözüyle`, `#121212`), [scripts/generate-icons.mjs](scripts/generate-icons.mjs) (ikonları ve `app/favicon.ico`'yu `lib/brand-mark.ts`'ten üretir: `node scripts/generate-icons.mjs`), [public/.well-known/assetlinks.json](public/.well-known/assetlinks.json) (Android paketi `com.gozuyle.twa`) |
| Veritabanı | [supabase/migrations/](supabase/migrations/): 21 migration, sonuncusu `20260928120000_vehicle_status_pending_approval.sql`; hepsi uzak veritabanında uygulanmış (son dördü 27 Eylül 2026'da `db push --linked` ile, her biri kod push'undan hemen önce) |
| Storage | [lib/listing.ts](lib/listing.ts) (`PHOTO_MIME_TYPES`, `MAX_PHOTO_BYTES`, `MAX_PHOTOS`, `PHOTO_SIZE_ERROR`, `photoUpload`), seçim denetimi [lib/image-decode.ts](lib/image-decode.ts) `inspectImageFile` ve [lib/image-file.ts](lib/image-file.ts), [lib/storage-rls.test.ts](lib/storage-rls.test.ts) (bucket sınırları ve `fn_can_upload_vehicle_photo`, PGlite), [lib/avatar-bucket.test.ts](lib/avatar-bucket.test.ts) |
| Ortam değişkenleri | [.env.example](.env.example); yerelde `.env.local` ve `.env.vercel` (ikisi de git dışında) |

## 3. 25–27 Eylül 2026 oturumlarında tamamlananlar

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
- **`/api/reports` istek sınırı: iki katman.** Aşılırsa `429`, `Retry-After` ve Türkçe mesaj döner. Geçersiz istekler de sayılır.
  - **1. Bellek içi ön sınır** (`4e1e2a4`, [lib/rate-limit.ts](lib/rate-limit.ts)): sunucu örneği başına IP'den dakikada 30 istek (`REPORT_BURST_LIMIT`). Ani seriyi veritabanına ve oturum doğrulamaya gitmeden keser.
  - **2. Kalıcı sayaç** (migration `20260926190000_rate_limits.sql`, [lib/rate-limit-server.ts](lib/rate-limit-server.ts)): `public.rate_limits` tablosu ve `fn_rate_limit_hit` fonksiyonu. Sabit pencereli sayaç, bütün sunucu örnekleri için ortak. Tek RPC çağrısında bütün kurallar sayılır.
  - **Kurallar** (`REPORT_RATE_RULES`, [lib/reports.ts](lib/reports.ts)):
    - Anonim: IP'den dakikada 5, saatte 20.
    - Giriş yapmış: kullanıcı başına dakikada 5, günde 30; IP'den dakikada 30. IP sınırı, aynı IP'yi paylaşan mobil kullanıcılar (CGNAT) birbirini engellemesin diye gevşek.
  - **IP:** `x-real-ip` başlığından alınır, yoksa `x-forwarded-for`'daki ilk adresten. IPv6 /64 önekine göre sayılır (`rateLimitSubject`), çünkü adres her istekte değiştirilebilir.
  - **Gizlilik (KVKK/GDPR):** IP ve kullanıcı id'si veritabanına düz yazılmaz. Anahtar `reports:<ip|user>:<HMAC-SHA256>`, özet anahtarı sunucudaki Supabase gizli anahtarı. Süresi dolan satırlar (en geç 24 saat) her çağrıda silinir.
  - **Erişim:** tablo ve fonksiyon yalnızca `service_role`'e açık; tabloda RLS açık, politika yok.
  - **Sayaç okunamazsa istek geçer** ve hata loglanır. Bellek içi sınır yine çalışır; veritabanına ulaşılamıyorsa bildirim de zaten kaydedilemez.
- **Moderasyon paneli (`614476d`):** `/admin/reports` bildirilen ilanları listeler. "Kaldır" ilanı `rejected` yapar ve ilanın tüm açık bildirimlerini kapatır; "Yoksay" yalnızca bildirimleri kapatır. `rejected` durumuna girmek de çıkmak da yalnızca sunucudan yapılır (`trg_vehicles_guard_moderated_status`). Migration'ları artık uygulandı.
- **İlan yazma kurallarındaki üç açık kapatıldı (`270d328`, migration `20260926170000_harden_listing_rls.sql`):**
  1. **Durum atlatma:** satıcı `set_vehicle_status`'u atlayıp tabloya doğrudan yazarak (tablo yetkisi + yalnızca sahipliğe bakan `vehicles_update_own`) örneğin satılmış ilanı yeniden yayına alabiliyordu. Artık kullanıcı isteklerinde durum yalnızca geçiş tablosuna göre değişiyor. Yeni ilan yalnızca `draft`/`pending_video` açılıyor; servis anahtarı ve yönetici etkilenmiyor.
  2. **Fotoğraf adresi:** adres denetimi olmayan `vehicle_images_insert_own` politikası, OR ile birleştiği için katı politikayı etkisiz bırakıyordu. Katı politikanın `%/vehicle-images/...` deseni de her sunucuyu kabul ediyordu ve kullanılmayan bucket'ı tarif ediyordu. UPDATE politikası aynı açığa sahipti. Artık yalnızca uygulamanın `getPublicUrl` ile ürettiği adres geçiyor. Migration, adres denetimi olmayan bir yazma politikası kalırsa ya da mevcut bir satır kurala uymazsa hiçbir şey uygulamadan duruyor.
  3. **Videosuz yayın:** videosu işlenmemiş ilan `pending_video → archived → active` yoluyla yalnızca fotoğrafla yayına alınabiliyordu. Artık yayın için işlenmiş video şart. "İlanlarım"da videosu hazır olmayan ilanın "Yayına al" butonu gizli ve nedeni yazıyor.
  - Kanıt: 84 yeni test (82'si [lib/listing-rls.test.ts](lib/listing-rls.test.ts)'te). Düzeltmeler olmadan çalıştırılan kontrolde ilk iki açık için 35, video kuralı için 9 test başarısız oldu. Uzak veritabanında tetikleyiciler, politikalar ve fonksiyon tanımları sorguyla doğrulandı.
- **İlan verme (`/sell`) yeniden tasarlandı (`869865a`).** Veri doğrulama, RLS ve yükleme mantığı değişmedi.
  - **Üç adım:** Araç Bilgileri (marka, model, yıl, km, kasa, yakıt, vites, hasar) → Medya & Video → Fiyat & Detaylar (fiyat, şehir, açıklama, WhatsApp, özet kartı).
  - **Adım göstergesi:** tamamlanan adımlarda ✓ var ve bunlara dönülebiliyor. Alttaki sabit çubukta adım bilgisi, ilerleme çizgisi ve Geri / Devam et / İlanı oluştur düğmeleri var; mobilde alt menünün üstünde duruyor.
  - **Doğrulama:** "Devam et" yalnızca o adımın alanlarını denetliyor ve ilk hatalı alana odaklanıyor; son adımda eksik kalırsa ilk eksik adıma dönülüyor. Hata metni alanın altında, ikonlu ve `aria-describedby` ile alana bağlı.
  - **Medya:** video ve fotoğraf için sürükle-bırak. Kapak fotoğrafı ızgarada 2×2 kare ve rozetli; silme düğmeleri köşelerde. Sınırlar ikonlu mikro metinlerle gösteriliyor.
  - **Gönderim:** aşama rozetleri ve video yüzde çubuğu var. Başarı ekranında Cloudflare işlemesi "İşleniyor" olarak görünüyor. Yükleme sürerken sayfadan çıkılırsa tarayıcı uyarıyor.
  - **Girdiler:** fiyat ve km binlik ayraçlı (`₺`, `km` ekleri); imleç yerinde kalıyor, ayraca Backspace önündeki rakamı siliyor. Kasa, yakıt, vites ve hasar gerçek radyo grupları (ok tuşlarıyla gezilebiliyor).
  - **Yapı:** `app/sell/page.tsx` durum ve gönderim mantığını tutuyor (`runSubmit`, `uploadPhotos`). Görsel parçalar `components/sell/` altında. Yazı tipleri ve sayfa başlığı `app/sell/layout.tsx`'ten geliyor.
  - **Doğrulama (üretim derlemesi):** 320, 375 ve 1280 px'te taşma yok, konsol temiz. Adım doğrulaması, odak, binlik ayraç ve imleç, PNG kabul / GIF ret, tarayıcıda üretilen dikey video ve oturumsuz gönderimde giriş penceresi denendi.
- **Marka/model seçim kutusu (`82b4fc7`, migration `20260926200000_user_catalog_entries.sql`):** marka ve model artık aramalı, serbest metin destekli seçim kutusu (`CatalogCombobox`).
  - **Arama:** yazım hatasına dayanıklı. Sıra: birebir > adın başı > kelimenin başı > seri eşleşmesi ("320" → 3 Serisi, "c200" → C Serisi) > adın içinde > 1–2 harf yazım hatası (4+ harfte). Eşitlerde doğal sıra.
  - **Serbest metin:** listede birebir yoksa en altta **"… olarak kullan"** çıkıyor. Seçim ancak listeden seçilince ya da Enter'la kesinleşiyor. Alan terk edilince birebir eşleşen ad otomatik seçiliyor; eşleşme yoksa metin kalıyor ve hata "Listeden seç ya da “…” olarak kullan." diyor. Esc geri alıyor.
  - **Erişilebilirlik ve mobil:** ARIA combobox (ok tuşları, `aria-activedescendant`). Mobilde odakta kutu ekranın üstüne kaydırılıyor; liste yüksekliği `visualViewport`'a göre (klavye açıkken taşmıyor). Seçenekler en az 44 px. Mobilde marka ve model tam genişlik.
  - **Veri:** taslakta `brandId` / `brandName` ve `modelId` / `modelName` var. Listeden seçildiyse id'ler doğrudan yazılıyor; yeni adda gönderimde `resolve_listing_catalog` id'leri buluyor ya da ekliyor, sonra ilan açılıyor. Yeni markanın modeli de yeni olmak zorunda.
  - **Testler:** `lib/catalog-search.test.ts` (sıralama, yazım hatası, ad kuralları) ve `lib/catalog-rls.test.ts` (PGlite: RPC, tekilleştirme, günlük sınır, yetkiler, TS ve SQL kurallarının birebir aynılığı).
  - **Canlıda doğrulandı:** `/sell`'de 36 marka listeleniyor; "mercedes benz" → Mercedes-Benz, "c200" → C Serisi. `/search` filtreleri 36 markayla yükleniyor, konsol temiz.

- **Vitrinim, profil ve ilan üzerinden mesajlaşma (`15c9455`, migration `20260926210000_profiles_and_messaging.sql`):**
  - **Ad değişikliği:** "İlanlarım" her yerde "Vitrinim" oldu. `/my-listings` bir profil sayfası: avatar, görünen ad, sayılar (ilan, yayında, izlenme), Mesajlar ve Hesap butonları.
  - **Izgara:** Reels/TikTok profili gibi 3 sütunlu 9:16 kareler; kapak önce video kapağından geliyor.
    - Fiyat sol altta cam efektli hapta (1 milyonun üstü "₺1,25 Mn"). Görüntülenme sayısı sağ altta; dar karede fiyatın üstüne çıkıyor (kare bir @container), böylece fiyat hiç kesilmiyor.
    - Pasif ilan kararıyor ve ortada "Yayında Değil" etiketi çıkıyor. Dokununca `active:scale-95`.
    - Yayındaki kare ilan sayfasına gidiyor. Pasif karenin herkese açık sayfası olmadığı için dokununca yönetim menüsü açılıyor; köşedeki "⋯" her durumda bu menüyü açıyor (durum değiştirme, satıldı onayı, video bekleme notu, akışta gör).
  - **Avatar:** tarayıcıda ortadan kare kırpılıyor, 512 px WebP'ye (desteklenmiyorsa JPEG) sıkıştırılıyor, yuvarlak önizlemeyle onaylanıyor.
    - `/api/profile/avatar` (POST/DELETE) dosyanın gerçek türünü ilk baytlarından denetliyor, en fazla 1 MB kabul ediyor ve kullanıcı başına saatte 20 istek sınırı var. Eski dosyalar siliniyor.
    - Hesap silinince avatar da siliniyor.
  - **Mesajlaşma:** ilan sayfasında ve akıştaki detay çekmecesinde "gözüyle'den Mesaj Gönder" var; WhatsApp'la eşit genişlikte, paylaş yalnızca simge.
    - Etiketler satır genişliğine göre değişiyor: 320–414 px'te "Mesaj" / "WhatsApp", geniş ekranda tam ad (ölçüldü: 320, 375, 414, 768, 1280 px, kesilme yok).
    - Buton kendi ilanında gizli; misafirde önce giriş penceresi açılıyor.
    - `start_conversation` yalnızca yayındaki ilan için konuşma açıyor (kendi ilanına açılamıyor, engel varsa açılamıyor); mevcut konuşma varsa onu dönüyor.
  - **Gelen kutusu (`/messages`):** avatar ve üstünde küçük ilan kapağı, son mesaj ("Sen: …"), zaman, okunmamış sayısı. Realtime ile yenileniyor.
  - **Sohbet (`/messages/[id]`):** tam ekran; alt menü gizli.
    - **Başlık:** avatar, ad, rol ve ilan özet kartı (yayındaysa ilana bağlantı).
    - **Balonlar:** benimkiler sağda koyu mavi, onunkiler solda gri. Aynı kişinin 5 dakika içindeki mesajları gruplanıyor; gün ayraçları, saat damgası, tek tik (gönderildi) / mavi çift tik (okundu) / saat (gönderiliyor) var. Gönderilemeyen mesaj tekrar denenebiliyor.
    - **Yazma:** iyimser gönderim, otomatik büyüyen yazma alanı (masaüstünde Enter gönderir, dokunmatikte yeni satır).
    - **Mobil klavye:** kutu `visualViewport`'a oturuyor, klavye açılınca yazma alanı üstte kalıyor, yeni mesajda otomatik alta kayıyor.
    - **Menü (⋯):** ilanı şikayet et (mevcut `reports` akışı), kullanıcıyı şikayet et (`user_reports`), engelle / engeli kaldır.
  - **Rozet:** okunmamış sayısı alt menüdeki "Vitrinim"de ve üst çubuktaki profil fotoğrafında; 99'dan sonra "99+". Tek bir Realtime kanalıyla güncelleniyor (`lib/use-unread-count.ts`). Üst çubuktaki profil butonu artık Vitrinim'e gidiyor ve avatarı gösteriyor.
  - **Güvenlik düzeltmesi:** "Public profiles are viewable by everyone" politikası yüzünden bütün satıcıların WhatsApp numaraları API'den herkese açıktı. Politika kaldırıldı.
    - Sütun düzeyinde kısıtlama denenmedi, çünkü PostgREST upsert'ü (`ON CONFLICT … excluded.whatsapp_number`) canlıdaki ilan vermeyi bozardı; bunu testler yakaladı.
    - Uzak veritabanında `profiles`'ı okuyan başka (invoker) fonksiyon olmadığı sorguyla doğrulandı.
  - **Testler:** `lib/messaging-rls.test.ts` (25, PGlite: profil yetkileri ve canlı upsert, konuşma açma, iki taraf kuralı, sahtecilik, engel, hız sınırı, okundu, gelen kutusu, şikayet, Realtime yayını).
    - Ayrıca `lib/messages.test.ts`, `lib/showcase.test.ts`, `lib/avatar.test.ts`, `lib/avatar-server.test.ts` ve bileşen testleri (`lib/ui-components.test.tsx`: kare, balon, yazma alanı, rozet).
    - Testlerin yakaladığı iki gerçek hata: profil upsert'ü ve karışık zaman damgası biçimlerinde yanlış mesaj sırası.
  - **Canlıda doğrulandı:** sayfalar `200`; avatar API'si oturumsuz `401`, 1,1 MB gövdede `413`; yeni kod pakette; uzak veritabanında RLS, yetkiler, bucket ve Realtime sorguyla kontrol edildi.
  - **Görsel doğrulama:** giriş gerektiren ekranlar (ızgara, sohbet) geçici bir önizleme sayfasında sahte veriyle çizilip kontrol edildi (commit'lenmedi).

- **Kullanıcı adı, takip sistemi ve "Takip Edilenler" akışı (`5e30c64`, migration `20260927120000_usernames_and_follows.sql`, 27 Eylül 2026):**
  - **Veritabanı** (kurallar 1. bölümde):
    - Kullanıcı adı yalnızca `set_username` RPC'siyle yazılıyor. Profil satırı yoksa açılıyor. İlk belirleme ve ilk değişiklik serbest (yazım hatası düzeltilebilsin); sonraki değişiklik için son değişiklikten itibaren 7 gün bekleniyor. Eski ad hemen boşa çıkıyor.
    - `check_username` şu değerlerden birini dönüyor: `invalid`, `reserved`, `current`, `taken`, `available`. Yalnızca giriş yapmış kullanıcı çağırabiliyor.
    - Sayaçlar (`followers_count`, `following_count`) `follows` tetikleyicisiyle güncelleniyor. İki profil satırı id sırasıyla kilitleniyor; karşılıklı eşzamanlı takipte kilitlenme (deadlock) olmuyor. Hesap silinince takipler CASCADE ile gidiyor ve karşı tarafın sayacı düşüyor.
    - `get_public_profile(ad)` hem misafire hem üyeye açık. Kullanıcı adı, görünen ad, avatar, takipçi, takip edilen, yayındaki ilan sayısı ve oturumdaki kullanıcı için `is_me` / `is_following` dönüyor. WhatsApp numarası asla dönmüyor.
    - `get_public_profiles(ids)` en fazla 50 kimlik alıyor ve yalnızca herkese açık yüzü olanları dönüyor: kullanıcı adı olan ya da yayında ilanı olan kullanıcılar. Diğer üyelerin adı id ile sorgulanamıyor.
    - `following_feed()` yalnızca giriş yapmış kullanıcıya açık. `setof vehicles` döndüğü için PostgREST üstüne akış sorgusunun süzgeç, sıralama, imleç ve `videos` birleştirmesini uyguluyor.
    - **Bilinen PostgREST sınırı:** RPC sonucunda gömülü kaynağa `is` süzgeci uygulanamıyor. `videos.hls_url=not.is.null` "column pgrst_call.hls_url does not exist" hatası veriyor (canlıda denendi). Takip akışı bu süzgeci göndermiyor; `hls_url`'si boş video `toFeedVehicle`'da eleniyor.
  - **`/@kullanici_adi`:** `next.config.ts` rewrite'ı sayfayı `app/u/[username]`'e yönlendiriyor. `app/@...` klasörü paralel rota yuvası sayıldığı için rewrite gerekti.
    - Sunucu sayfayı anonim çiziyor. Büyük harfli adres 308 ile küçük harfe yönleniyor. Geçersiz ya da olmayan ad kendi 404 sayfasına düşüyor.
    - Başlıkta avatar, ad, @ad, İlan | Takipçi | Takip Edilen sayıları ve Takip Et / Takibi Bırak düğmesi var. Kendi profilinde düğme yerine "Profili Düzenle" (→ Vitrinim) çıkıyor. Yanında "Profili paylaş" düğmesi var.
    - Altında yalnızca yayındaki ilanların 3 sütunlu ızgarası var (Vitrinim karesi, köşe menüsü yok). Metadata'da canonical `/@ad`, OG görseli avatar.
  - **Takip et / bırak iyimser:** sayı ve düğme hemen değişiyor, sunucu reddederse geri alınıp Türkçe hata gösteriliyor.
    - Aynı satıcının akıştaki bütün kartları, ilan sayfası ve profil sayfası tek bir depodan okuyor ([lib/use-follow.ts](lib/use-follow.ts)). Depo oturumdaki kullanıcıya bağlı; çıkışta sıfırlanıyor.
    - Misafir takip etmek isterse önce giriş penceresi açılıyor, girişten sonra takip ediliyor.
  - **Kullanıcı adı penceresi:** giriş yapmış ama kullanıcı adı olmayan kullanıcıya bir kez açılıyor (layout'ta, 0,9 sn gecikmeyle).
    - Öneri görünen addan ya da Google adından geliyor, olmazsa e-postanın başından (Türkçe harfler çevriliyor).
    - Yazarken alan kurala göre süzülüyor (Ş → s, boşluk → _, büyük harf → küçük). Biçim ve rezerve kontrolü anında, alınmış olup olmadığı 400 ms sonra sunucudan geliyor. Yeşil tik / kırmızı çarpı / dönen halka gösteriliyor.
    - "Daha sonra" 3 gün boyunca tekrar sormuyor (localStorage). İlan verme, sohbet, giriş dönüşü, yönetim ve yasal sayfalarda açılmıyor.
    - Kaydedince "Vitrinimi gör" ekranı çıkıyor.
  - **Vitrinim:** adın altında @kullanıcı_adı var (dokununca değiştirilebiliyor); yoksa "Kullanıcı adı belirle" düğmesi çıkıyor. Ayrıca "Herkese açık vitrinim" bağlantısı eklendi.
    - Sayılar artık İlan | Takipçi | Takip | İzlenme. "Yayında" sayısı "İlanlar" başlığının yanına taşındı.
  - **Ana sayfa:** başlığın altında cam efektli "Takip Edilenler | Keşfet" sekmeleri var (ARIA sekme deseni, ok tuşları).
    - Sekme değişince diğer akış silinmiyor, gizleniyor; Keşfet'e dönünce kalınan yerden devam ediliyor ve gizli akışta video oynamıyor. Ses iki akışta ortak.
    - "Takip Edilenler" ilk açılışta kuruluyor; bu arada takip listesi değiştiyse yeniden kuruluyor.
    - Boş durumlar: misafire giriş kartı; kimseyi takip etmeyene "Henüz kimseyi takip etmiyorsun. İlgini çeken satıcıları vitrinlerinden takip et!" ve "Keşfet'e dön"; takip ettiklerinin videosu olmayana ayrı bir metin.
    - `/?feed=following` sekmeyle açılıyor.
  - **Akış kartı ve ilan sayfası:** kartın sol üstünde satıcının avatarı ve @adı (vitrine gidiyor) ile "Takip et" var. Takip edilen satıcıda düğme yok, yalnızca "Takiptesin" işareti çıkıyor; akışta yanlışlıkla takip bırakılamıyor. Satıcı profilleri akış sayfalarıyla birlikte tek RPC'de isteniyor.
    - İlan sayfasında "Satıcı" kartı var: avatar, ad, "Vitrini gör", Takip Et / Takibi Bırak.
  - **Testler (+133):**
    - [lib/social-rls.test.ts](lib/social-rls.test.ts): 67 test, PGlite, gerçek migration'lar. Kapsadıkları: biçim, küçük harf, rezerve sözcükler ve TS–SQL eşitliği, benzersizlik, 7 gün kuralı, sütun yetkileri, canlıdaki upsert, kendini takip, çift takip, başkası adına takip, engel, saatlik sınır, sayaçlar ve CASCADE, RPC'lerin misafir/üye çıktısı ve numara sızmaması, `following_feed`.
    - Kontrol çalıştırması: kurallar bozulmuş migration'la 10 test başarısız oldu.
    - Ayrıca `lib/username.test.ts`, `lib/follows.test.ts`, `lib/use-follow.test.ts` (iyimser takip ve geri alma), `lib/feed.test.ts` (takip akışı sorgusu) ve bileşen testleri (sekmeler, boş durum, takip düğmesi, kullanıcı adı alanı ve canlı kontrol, profil sayıları).
  - **Doğrulama:**
    - Üretim derlemesinde 320×568, 390×844 ve 1280×720 boyutlarında taşma yok. Boş durum kartı sekmelerin altında kalıyor.
    - Giriş gerektiren ve veri isteyen ekranlar (profil başlığı, ızgara, akış kartı satıcı satırı, kullanıcı adı alanının bütün durumları) geçici önizleme sayfasında sahte veriyle kontrol edildi (commit'lenmedi).
    - Uzak veritabanında sütunlar, kısıtlar, politikalar, tetikleyiciler ve fonksiyon yetkileri sorguyla doğrulandı.
    - Canlı PostgREST: misafir `get_public_profile` / `get_public_profiles` → 200; `check_username`, `following_feed` ve `follows`'a yazma → 401. İstemcinin kuracağı takip akışı sorgusu (imleçli ve imleçsiz) → 200.

- **Ad kaydetme hatası, arama hızı, akış başlığı ve Ayarlar (`6a9767a` + `ec770f6`, migration `20260927150000_profile_name_and_blocked_list.sql`, 27 Eylül 2026):**
  - **"Ad kaydedilemedi" hatası (canlı testte bulundu):**
    - Neden: `saveDisplayName` profiles'a `{id, display_name, updated_at}` upsert ediyordu. `authenticated` rolünün INSERT yetkisi yalnızca `(id, whatsapp_number, display_name)` sütunlarında. Upsert'in INSERT kısmı satır var olsa bile denetlendiği için her kayıt 42501 ile reddediliyordu.
    - Önceki testler bunu yakalamadı: testteki sorgu `updated_at` içermiyordu. Yeni PGlite testi eski sorguyu birebir çalıştırıp 42501'i kanıtlıyor.
    - Çözüm: `update_profile_display_name(p_name)` RPC'si (security definer). Kuralı sunucuda denetliyor, `updated_at`'i sunucu atıyor, profil satırı yoksa açıyor ve yalnızca oturumdaki kullanıcının adını değiştiriyor. Sütun yetkileri değişmedi; ilan verme upsert'i etkilenmedi.
  - **"Ara" gecikmesi:**
    - Canlıda ölçüm: "Ara"ya dokunduktan sonra adres ve içerik 1278–1417 ms'de değişiyordu, arada hiçbir geri bildirim yoktu. Neden: `/search` sunucuda katalog (marka ve model tablosu, her biri iki ardışık istek) ve ilk sonuç sayfası hazırlanana kadar gezinmeyi bekletiyordu.
    - Çözüm 1: `app/search/loading.tsx` iskeleti. Next.js iskeleti önceden indiriyor ve dokunulduğu an çiziyor.
    - Çözüm 2: `fetchCatalogCached`, modül düzeyinde 10 dakikalık önbellek. Aynı anda gelen istekler tek sorguyu paylaşıyor; hata önbelleğe alınmıyor. `/sell` de kullanıyor.
    - Çözüm 3: katalog tablosu başına tek istek. Eksik gelen parça son parça sayılıyor; eskiden boş parça için ikinci bir istek atılıyordu.
    - Çözüm 4 (`ec770f6`): alt menü `/search`'ü açılışta ve her sayfa geçişinde `router.prefetch` ile açıkça önden indiriyor. Canlıda ölçüldü: `<Link>`'in görünürlüğe bağlı önden indirmesi tetiklenmediğinde dokunuş, iskelet için hâlâ bir sunucu gidiş-dönüşü (~300 ms, soğuk başlangıçta ~1 sn) bekliyordu.
    - **Canlıda sonuç (`elan-gijopf5vj`):** "Ara"ya dokununca iskelet ve adres 20–32 ms'de geliyor; önce 1278–1417 ms'ydi ve arada hiçbir şey görünmüyordu. Sonuçlar 536–1514 ms'de doluyor; bu sunucu verisi, Vercel soğuk başlangıcına göre değişiyor.
  - **Akış başlığı:** "Akış | Ara" satırı ve altındaki ikinci sekme satırı kaldırıldı. En üst satırda doğrudan "Takip Edilenler | Keşfet" var: metin sekmeleri, seçili olan kalın ve altı çizgili. Dar ekranda (≤336 px) 16 px'e iniyor.
    - Masaüstünde (md+) akış başlığı tam genişlik: sekmeler videonun tam ortasında, sağda büyüteç ("Ara"nın yerine), favoriler, İlan Ver ve profil var.
    - Diğer sayfalarda başlık değişmedi.
    - Ölçüldü: 320×568, 390×844, 768×1024, 1024×430, 1280×720 ve 1366×650 boyutlarında çakışma ve taşma yok. 1366×650'de sekmelerin ve videonun merkezi aynı (683 px).
  - **Ayarlar (`/settings`):** Vitrinim'deki dişli buraya gidiyor. Sayfada gruplanmış listeler var:
    - **Hesap:** görünen ad ve kullanıcı adı (düzenlenebilir), e-posta, giriş yöntemi.
    - **Bildirimler:** üç anahtar (mesajlar, yeni takipçiler, takip edilenlerin ilanları). Tercihler auth kaydında (`user_metadata.notification_prefs`) tutuluyor; gönderim henüz yok ve sayfa bunu açıkça yazıyor.
    - **Gizlilik ve güvenlik:** engellenen kullanıcılar penceresi (`list_blocked_users` RPC'si ve "Engeli kaldır"). Liste yüklenemezse boş sanılmıyor; hata ve "Tekrar dene" çıkıyor.
    - **Yasal ve destek:** KVKK Aydınlatma Metni (`/privacy#haklarin`), Gizlilik Politikası, Kullanım Koşulları, destek e-postası.
    - **Çıkış yap** ve kırmızı çerçeveli **Hesabımı Sil** (onay kutusu işaretlenmeden silme düğmesi kapalı).
    - Misafire giriş düğmesi, e-postayla silme talebi bilgisi (Google Play) ve yasal bağlantılar gösteriliyor.
    - `/account` 308 ile `/settings`'e yönleniyor: Play Console'a verilmiş eski silme adresi çalışmaya devam ediyor. Yasal metinlerdeki bağlantılar "Ayarlar"a çevrildi. `AccountView` kaldırıldı; silme penceresi `components/settings/DeleteAccountDialog.tsx`'e taşındı.
  - **Testler (+30):** PGlite'ta eski hatanın kaydı, RPC'nin kuralları ve yetkileri, `list_blocked_users` (yalnızca kendi engelleri, numara sızmıyor). Ayrıca `lib/profile.test.ts`, `lib/settings.test.ts`, katalog önbelleği ve istek sayısı testleri, `Switch` ve engellenenler penceresi bileşen testleri.

- **Profilden doğrudan mesaj (`e09a119`, migration `20260927180000_direct_conversations.sql`, 27 Eylül 2026):**
  - **Veritabanı** (geriye dönük uyumlu):
    - `conversations.listing_id` artık boş olabiliyor. Doğrudan konuşma için kısmi benzersiz indeks var: `(least(buyer_id, seller_id), greatest(...)) where listing_id is null`. Kim başlatırsa başlatsın iki kişi arasında tek doğrudan konuşma açılıyor; ilanlı konuşmalar bundan ayrı.
    - `start_direct_conversation(p_user_id)` yalnızca giriş yapmış kullanıcıya açık. Kendine yazılamıyor. Hedefin kullanıcı adı (herkese açık profili) olmalı, yani rastgele kimliklere yazılamıyor. Engel varsa yeni konuşma açılmıyor; mevcut konuşma dönüyor ama mesaj RLS'e takılıyor. Saatte en fazla 20 yeni doğrudan konuşma açılabiliyor.
    - `get_conversation` / `list_conversations` artık `kind` (`listing` | `direct`) dönüyor; `fn_public_profile` karşı tarafın `username`'ini de veriyor. Mesaj gönderme RLS'i değişmedi, iki taraf kuralı geçerli.
    - Uygulamadan önce canlıdaki `get_conversation`, `list_conversations` ve `fn_public_profile` gövdelerinin migration kaynağıyla aynı olduğu md5 ile doğrulandı.
  - **Arayüz:** `/@ad`'da Takip Et / Takibi Bırak'ın yanında beyaz ikincil "Mesaj" düğmesi var (`MessageUserButton`); misafire önce giriş penceresi açılıyor, kendi profilinde düğme yok.
    - 320 px'te Takip Et, Mesaj ve Paylaş aynı satıra sığıyor ("Takibi Bırak" 76 px, alan 100 px).
    - Doğrudan sohbette başlıkta ilan kartı ve Alıcı/Satıcı rolü yok; adın altında @kullanıcı_adı var. Ad ve avatar her sohbette vitrine bağlanıyor (kullanıcı adı varsa).
    - Boş sohbet metni ilandan söz etmiyor. Gelen kutusunda "@ad · Doğrudan mesaj" yazıyor. "İlanı şikayet et" yalnızca ilanlı sohbette çıkıyor.
  - **Akış başlığı:** büyüteç mobilde de sağ üstte. Orada profil düğmesinin yerini alıyor, çünkü 320 px'e ikisi birden sığmıyor; avatar ve okunmamış rozeti alt menüdeki "Vitrinim"de.
  - **Testler (+17):** PGlite'ta 10 test: tekil konuşma (iki yönden), ilanlı ve doğrudan konuşmanın bir arada durması, veritabanı tekilliği, kendine yazma, misafir, kullanıcı adı şartı, engel, iki taraf kuralı, `kind`/`username` yanıtı, spam sınırı ve eski `start_conversation`. Ayrıca dönüşüm testleri, eski yanıt biçimi, `ChatHeader` ve "Mesaj" düğmesi bileşen testleri.

- **Görsel dil, marka işareti, ad gösterimi ve önbellek (`a70d80e`, migration `20260927200000_direct_dm_requires_username.sql`, 27 Eylül 2026):**
  - **Tasarım dili (kural):** neon, renkli ışıma (`shadow` içinde renkli rgba), parlayan halka ve yapay gradyan kullanılmaz. Koyu yüzeyler mat nötr: `#121212` (akış, alt menü, tema rengi), `#18181B` (kart), `#27272A` (ikincil düğme, çizgi). Açık sayfalar nötr gri ve beyaz; vurgu rengi düz `#003399`. Cam etkisi yalnızca hafif (`bg-black/35–55` + `backdrop-blur-[6px]`).
    - Temizlenenler: arama kartındaki kırmızı neon "Video" rozeti (koyu buzlu cam oldu); "İlan Ver" ve Takip Et'teki mavi ışıma; boş durum ikonundaki mavi gradyan ve ışıma; gradyan avatar (düz `#3F3F46`); profil fotoğrafının gradyan halkası; gradyan sohbet balonu (düz mavi); kullanıcı adı başarısındaki konfeti ve zıplama (sade onay işareti).
  - **Marka işareti:** badem biçimli ince göz hattı ve göz bebeğinin yerinde oynat üçgeni; tek renk, `currentColor`. Tek kaynak `lib/brand-mark.ts`: üst çubuktaki logo, duraklatma simgesi ve uygulama ikonları aynı çizimi kullanıyor. İkonlar (`public/icons/*`, `app/favicon.ico`) mat `#121212` zeminde yeniden üretildi; `manifest` ve `themeColor` `#121212` oldu.
  - **Duraklatma simgesi:** yuvarlak oynat düğmesi yerine yarı saydam koyu buzlu dairede ince beyaz göz hattı ve oynat üçgeni. Duraklatınca solarak ve %90'dan %100'e büyüyerek beliriyor (150 ms gecikme: oynatma başlarken yanıp sönmesin), oynatınca solarak kayboluyor. Hareket azaltma tercihinde büyüme yok. Parlama yok.
  - **Ad gösterimi:** "gözüyle üyesi" kaldırıldı. Başlıkta görünen ad, yoksa `@kullanıcı_adı` gösteriliyor; ad varsa altında küçük gri `@kullanıcı_adı` var. İkisi de yoksa (ilandan yazan, kullanıcı adı almamış alıcı) karşı tarafın rolü ("Alıcı" / "Satıcı") yazıyor, bağlam yoksa "Kullanıcı". Bu kural sohbet başlığında, ilk mesaj uyarısında, gelen kutusunda, engellenenler listesinde, satıcı kartında ve akış satırında uygulanıyor (`partnerName`, `partnerHandle`, `lib/messages.ts`).
  - **Profilden mesaj:** "Mesaj", Takip Et'le eşit genişlikte (320 px'te 112'şer px). Doğrudan sohbet başlatmak için başlatanın da kullanıcı adı olmalı: arayüz önce kullanıcı adı penceresini açıyor, kaydedince sohbete geçiyor; `start_direct_conversation` da bunu şart koşuyor (`DIRECT_USERNAME_REQUIRED`). Böylece doğrudan sohbette iki taraf da gerçek bir adla görünüyor. İlandan mesaj gönderme sürtünmesiz kaldı; orada kullanıcı adı şartı yok.
  - **Ayarlar → Önbelleği temizle:** Cache Storage, service worker kayıtları, sessionStorage ve bellek içi önbellekler (katalog, takip ve satıcı profilleri) siliniyor, sayfa yeniden yükleniyor. Oturum ve favoriler (localStorage) korunuyor. Satırda tarayıcının depolama tahmini gösteriliyor (0 ise gizli). Üretim derlemesinde denendi: Cache Storage ve sessionStorage boşaldı, favoriler kaldı, sayfa yeniden yüklendi.
  - **Testler (+9):** marka işareti (tek renk, gradyan ve filtre yok), ad kuralları, sohbet başlığı (`@ad` başlık, tekrar yok, rol yedeği), önbellek temizleme, PGlite'ta kullanıcı adı şartı (`DIRECT_USERNAME_REQUIRED` veritabanı mesajıyla birebir aynı).

- **Otomatik içerik denetimi: karantina, görsel/metin filtresi ve inceleme kuyruğu (`2938b50`, migration'lar `20260928100000_vehicle_status_pending_moderation.sql` + `20260928100100_content_moderation.sql`, 27 Eylül 2026):**
  - **Neden:** testlerde cinsel içerikli ve şiddet içeren video/görseller yüklenebildi. Bu, Google Play / App Store kullanıcı içeriği (UGC) politikası için sıfır toleranslı bir risk. Kod dondurması bunun için kaldırıldı.
  - **Karantina:** Cloudflare videoyu işleyince ilan artık doğrudan `active` olmuyor, önce `pending_moderation`'a geçiyor ([lib/video-activation.ts](lib/video-activation.ts)). Bu durumdaki ilan akışta, aramada, herkese açık profilde ve ilan sayfasında görünmüyor (hepsi `status = 'active'` arıyor, RLS de öyle).
  - **Denetim hattı** ([lib/listing-moderation.ts](lib/listing-moderation.ts)): webhook yanıtı gönderildikten sonra `after()` ile çalışıyor (`maxDuration = 60`). Denetlenenler:
    - açıklama ve şehir: temel filtre, ardından varsa OpenAI;
    - video kareleri: kapak + videonun 5 eşit parçasının ortası, Cloudflare `thumbnail.jpg?time=Ns&height=480`;
    - fotoğraflar.
    - Aynı anda en fazla 4 istek. Bir görsel reddedilince yenisi başlatılmıyor; sağlayıcı hatası bir kez yeniden deneniyor.
  - **Kararlar:**
    - **Ret** (cinsel içerik / çıplaklık ya da şiddet / kan / silah **> %60**): ilan ve denetim `rejected` oluyor. Cloudflare videoları, `vehicle-photos/<ilan>/` klasöründeki bütün dosyalar ve video/fotoğraf kayıtları siliniyor. Vitrinim'de "Yüklenen içerik topluluk kurallarına uymadığı için yayınlanmadı" uyarısı çıkıyor (üstte kırmızı şerit, karede "Yayınlanmadı", yönetim menüsünde açıklama).
    - **İnceleme** (%40–60, "müstehcen" > %60, ya da sağlayıcı yok / hata verdi): ilan beklemede kalıyor. `moderation_reason = 'review:…'` yazılıyor; ilan /admin/reports → "İçerik denetimi"nde bir insanın kararını bekliyor. Kapalı başarısızlık: denetlenmemiş içerik yayına girmez.
    - **Temiz:** ~~ilan onaylanıp aynı güncellemede yayına alınıyor~~ → **`59e7c86`'dan beri ilan `pending_approval`'a geçiyor, yayına yalnızca yönetici onayıyla giriyor** (aşağıda "Zorunlu yönetici onayı").
    - Reşit olmayanlarla ilgili cinsel içerikte (OpenAI) ret eşiği %20.
  - **Sağlayıcılar** ([lib/moderation-providers.ts](lib/moderation-providers.ts)), ortam değişkeniyle seçiliyor (bkz. `.env.example`): `MODERATION_IMAGE_PROVIDER` = `sightengine` | `rekognition` | `openai` | `none`; boşsa anahtarı tanımlı ilk sağlayıcı kullanılıyor.
    - **Sightengine:** `nudity-2.1`, `weapon`, `violence`, `gore-2.0` modelleri; adres modu (GET) ve bayt modu (multipart).
    - **AWS Rekognition:** `DetectModerationLabels`, SDK'sız SigV4 ([lib/aws-sigv4.ts](lib/aws-sigv4.ts); AWS dokümanındaki örnek imzayı birebir üretiyor). Değişkenler `REKOGNITION_*`, çünkü `AWS_*` Vercel'de ayrılmış. Görsel en fazla 5 MB. "Crashes" (kaza) etiketi sayılmıyor: hasarlı araç ilanı bu platformun olağan içeriği.
    - **OpenAI Moderation** (`omni-moderation-latest`, ücretsiz): metin ve görsel; silah kategorisi yok.
    - İstenen modellerden biri yanıtta yoksa ya da yanıt başarısızsa hata sayılıyor; eksik yanıt "temiz" sayılmıyor.
  - **Avatar:** `/api/profile/avatar` fotoğrafı kaydetmeden önce denetliyor. Yalnızca temiz fotoğraf kabul ediliyor; ret ve şüphe 422, denetlenemezse 503 (inceleme kuyruğu yok).
  - **Metin filtresi** ([lib/text-moderation.ts](lib/text-moderation.ts)): küfür, taciz/tehdit, nefret söylemi ve yasa dışı teklif (uyuşturucu, silah satışı, sahte plaka/belge, yasa dışı bahis) için 90 terimlik liste.
    - Sadeleştirme: Türkçe harfler, leetspeak (`s1kt1r`), ayrı yazılmış harfler (`a.m.k`, `s i k t i r`) ve tekrar eden harfler (`siiiktir`) yakalanıyor.
    - Kısa kökler yalnızca tam sözcük olarak aranıyor; böylece "sık sık", "sıkıntısız", "canımı sıktı", "Golf Mk 7", "Ford Escort", "esrarengiz", "öldürecek fiyat" takılmıyor.
    - Olumsuzlamaya açık ifadeler ("çalıntı değildir", "change değil") bilerek listede yok; onları OpenAI yakalar.
    - **SQL aynası** (`fn_moderation_normalize`, `fn_moderation_terms`, `fn_moderation_text_category`) tetikleyicilerle uygulanıyor:
      - `messages` (`trg_messages_text_filter`);
      - ilan açıklaması, şehir ve renk (`trg_vehicles_guard_content`);
      - kullanıcının yazdığı marka/model adları (`trg_brands_name_filter`, `trg_models_name_filter`).
    - TS ve SQL'in 600 rastgele metinde aynı sonucu verdiği PGlite'ta sınanıyor. **Listeyi değiştiren migration'daki listeyi de değiştirmeli.**
    - `/sell` açıklama, şehir ve yazılan marka/model adında hatayı anında gösteriyor.
  - **DM:** mesajlar artık `/api/messages` üzerinden gidiyor: temel filtre, ardından varsa OpenAI (taciz, tehdit, nefret, cinsel içerik).
    - OpenAI'ye ulaşılamazsa mesaj geçiyor; taban kural veritabanında da var.
    - Mesaj kullanıcının kendi oturumuyla yazılıyor (`getSupabaseForUser`), yani RLS, engel, 30 mesaj/dk sınırı ve Realtime aynen geçerli.
    - Sohbette filtreye takılan mesaj balon olarak eklenmiyor, metin kutuda kalıyor.
    - Reddedilen mesajın metni saklanmıyor; yalnızca karar kaydediliyor.
  - **Satıcının atlatma yolları kapatıldı:**
    - denetim alanlarına yazamıyor (42501);
    - arşivden "Yayına al" ile denetimsiz yayınlayamıyor (yayın şartı);
    - denetime girmiş ilanın açıklamasını değiştiremiyor;
    - yeni fotoğraf ekleyemiyor ya da adresini değiştiremiyor (`vehicle_images` politikaları `draft` / `pending_video` şartı);
    - yeni video yükleyemiyor (`/api/upload/video` yalnızca `draft` / `pending_video`).
    - Onaydan sonra bir video yine de hazır olursa karar sıfırlanıyor ve ilan yeniden denetime giriyor.
  - **Yönetim paneli:** /admin/reports'un başlığı "Moderasyon" oldu; en üstte "İçerik denetimi" kuyruğu var ([components/moderation/PendingListingsSection.tsx](components/moderation/PendingListingsSection.tsx), [app/api/admin/listings/route.ts](app/api/admin/listings/route.ts)).
    - Her kartta nedenler, açıklama, video kareleri ve fotoğraflar var. Görseller varsayılan olarak bulanık; "Görselleri göster" açıyor.
    - Aksiyonlar: **Onayla ve yayınla**, **Reddet ve sil** (onaylı), **Tekrar denetle** (ör. sağlayıcı anahtarı sonradan eklendiyse). Elle kararlar yöneticiyle birlikte `content_moderation_events`'e yazılıyor.
  - **Geriye dönük uyum:** mevcut ilanlar (yayında, arşivde, satılmış, kaldırılmış) `approved` sayıldı. Migration önce uzak veritabanında geri alınan bir transaction'da denendi.
  - **Testler (+240):** yeni dosyalar:
    - [lib/content-moderation-rls.test.ts](lib/content-moderation-rls.test.ts): 43 test, PGlite, gerçek migration'lar; kontrol çalıştırmalı gevşek politika dahil;
    - `lib/text-moderation.test.ts`, `lib/content-moderation.test.ts`, `lib/moderation-providers.test.ts` (sağlayıcı yanıt biçimleri ve istekler);
    - `lib/aws-sigv4.test.ts`, `lib/content-moderation-server.test.ts`;
    - `lib/listing-moderation.test.ts` (safe / flagged / rejected, temizlik, elle karar, Supabase deposu sorguları);
    - `lib/messages-route.test.ts`.
    - Ayrıca güncellenenler: `video-activation`, `listing`, `listing-status`, `moderation`, `showcase` ve bileşen testleri.
  - **Görsel doğrulama:** Vitrinim kareleri ("İnceleniyor", "Yayınlanmadı", uyarı şeridi), yönetim menüsü uyarıları ve panel kuyruğu (bulanık görseller, ret onayı, kartın kalkması) üretim derlemesinde geçici önizleme sayfasında 375 px'te kontrol edildi (commit'lenmedi). Konsol temiz.
  - **Sağlayıcı canlıda: Sightengine (27 Eylül 2026).** Kullanıcı `SIGHTENGINE_API_USER` ve `SIGHTENGINE_API_SECRET`'i Vercel'e ekleyip yeniden deploy etti (`elan-3ajm0ibrc`). `OPENAI_API_KEY` tanımlı değil: metin tarafında yalnızca kelime filtresi çalışıyor.
    - **Canlı sağlayıcı testleri (hepsi geçti):** Vercel'deki anahtar değerleriyle, üretimdeki kodun kendisi (`moderationProvidersFromEnv`, `evaluateListing`, `moderateAvatarUpload`, `moderateText`) gerçek Sightengine'e karşı çalıştırıldı. Karar hesaplandı, veritabanına hiçbir şey yazılmadı.
      - Anahtar geçerli; ham yanıt HTTP 200 `success`.
      - Canlıdaki yayında ilan (37 sn video → kapak + 5 kare, 2 fotoğraf): **safe**. En yüksek puan cinsel içerik 0,08, diğerleri 0,001; toplam 2,5 sn.
      - Açık kaynaklı tabanca fotoğrafı (Wikimedia Commons, "Glock 17"): **rejected**, silah 0,99.
      - Avatar yolu (bayt, multipart): JPEG ve WebP ikisi de **kabul** (safe).
      - Metin: "s1kt1r git" → küfür, "seni öldürürüm" → tehdit, "Satılık tabanca var" → yasa dışı, üçü de **rejected**; "Araç hâlâ satılık mı? Sıkıntısız mı?" → **safe**.
      - Müstehcen örnekle bilerek denenmedi; o yol, Sightengine'in belgelenmiş yanıt biçimiyle birim testlerinde.
    - **Yöntem:** `vercel env pull --environment=development` proje dışına (scratchpad) çekildi, geçici `lib/zz-*.test.ts` ile çalıştırıldı; ikisi de silindi, hiçbir değer yazdırılmadı.
    - **Uçtan uca canlı doğrulama (avatar, 27 Eylül 2026 19:50 TSİ, deploy `elan-dr3462ykz`):** kullanıcı (@kamil_jafarov) profil fotoğrafını değiştirdi. Canlı sunucunun kendisi Sightengine'i çağırdı; zincirin tamamı çalışıyor: tarayıcı → `/api/profile/avatar` → Sightengine → karar → kayıt → Storage.
      - `content_moderation_events`'e ilk satır yazıldı: `subject_type = 'avatar'`, `provider = 'sightengine'`, `decision = 'safe'`, otomatik karar (`moderator_id` boş). Puanlar: cinsel içerik, müstehcen görünüm, şiddet, kan, silah; hepsi 0,001.
      - Sıra doğru: kayıt 16:50:22.19Z'de, profil güncellemesi 0,4 sn sonra (16:50:22.59Z). Yani fotoğraf kaydedilmeden önce denetlendi.
      - Yeni avatar Storage'da (`avatars/<kullanıcı>/…webp`, 38 KB, `image/webp`), adresi 200 dönüyor. Klasörde yalnızca bu dosya var, eski avatar silinmiş.

- **Görsel dosya türü düzeltmesi: profil fotoğrafı (`47a384a`, migration `20260928110000_avatars_allow_png.sql`) ve `/sell` ilan fotoğrafları (`e11af9d`), 27 Eylül 2026:**
  - **Şikayet:** kullanıcılar geçerli PNG yüklerken "JPEG ya da PNG bir fotoğraf seç" hatası aldı.
  - **Neden (avatar):** tarayıcıda fotoğraf `createImageBitmap(file, { imageOrientation: "from-image" })` ile açılıyordu. Bu değeri tanımayan tarayıcılar (eski Safari/Chrome, bazı uygulama içi tarayıcılar) çağrıyı TypeError ile reddediyor. Her açma hatası "yanlış tür" diye gösteriliyordu. Kullanıcının tarayıcısı bilinmiyor; tarayıcıda bu davranış taklit edilerek doğrulandı.
  - **Neden (`/sell`):** üç sorun vardı.
    - `photoRejection` yalnızca `file.type`'ın birebir listede olmasına bakıyordu; `image/x-png`, `image/jpg`, boş tür ve `application/octet-stream` reddediliyordu.
    - `image/jpg` bildiren dosya `<ilan>/<n>.jpg` yoluna gidecekti; `fn_can_upload_vehicle_photo` yalnızca `jpeg|png|webp` kabul ediyor, yükleme reddedilirdi.
    - Supabase Storage multipart yüklemede parçanın türünü dosyanın kendi `type`'ından alıyor ve bucket onu denetliyor (`@supabase/storage-js` kaynağında doğrulandı).
  - **Ortak kural** ([lib/image-file.ts](lib/image-file.ts)); profil fotoğrafı ve `/sell` aynı kodu kullanıyor:
    - Tarayıcının bildirdiği tür yalnızca ön süzgeç: `image/png`, `image/x-png`, `image/jpeg`, `image/jpg`, `image/pjpeg`, `image/webp`; büyük/küçük harf ve `; charset=…` önemsiz.
    - Tür boş ya da `application/octet-stream` / `binary/octet-stream` ise `.png` `.jpg` `.jpeg` `.webp` uzantısına bakılıyor. İkisi de yoksa karar imzaya kalıyor. Başka bir tür bildirilmişse (GIF, HEIC, video, PDF) reddediliyor.
    - **Gerçek tür yalnızca ilk baytlardan:** PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `RIFF….WEBP`. `.png` adlı GIF ya da PDF reddediliyor; `.png` adlı JPEG, JPEG olarak kabul ediliyor.
    - Tek hata metni: "Yalnızca JPG, PNG veya WebP yükleyebilirsiniz."
  - **Açma yedekleri** ([lib/image-decode.ts](lib/image-decode.ts) `decodeImage`): önce EXIF yönüyle `createImageBitmap`, olmazsa seçeneksiz `createImageBitmap`, o da olmazsa `<img>.decode()`. Hepsi başarısızsa "Bu fotoğraf açılamadı; başka bir fotoğraf dene."
  - **Profil fotoğrafı:** tür ve imza denetimi, sonra açma ve 512 px kırpma. Çıktı WebP; olmazsa JPEG, en son PNG.
    - Sunucu (`lib/avatar-server.ts`) türü yine imzadan belirliyor ve artık PNG'yi de `.png` / `image/png` olarak kaydediyor.
    - `avatars` bucket'ına `image/png` eklendi (migration; 1 MB aynı). `lib/avatar-bucket.test.ts`, bucket türlerinin `AVATAR_TYPES` ile aynı olduğunu PGlite'ta sınıyor.
  - **`/sell`:** her seçilen fotoğraf sırayla denetleniyor (`inspectImageFile`): beyan, imza, 10 MB sınırı ve tarayıcıda gerçekten açılabildiği. Açılan görüntü hemen serbest bırakılıyor.
    - Sıralı denetim bilinçli: büyük telefon fotoğrafları aynı anda açılıp belleği doldurmasın. Bu sırada seçici kapalı ve "Fotoğraflar kontrol ediliyor…" görünüyor. 10 fotoğraf sınırı korunuyor.
    - Yükleme yolu ve gövdesi imzadan gelen türle ([lib/listing.ts](lib/listing.ts) `photoUpload`): `image/x-png` → `….png` / `image/png`, `image/jpg` ve `image/pjpeg` → `….jpeg` / `image/jpeg`. Gerekirse dosya doğru türle yeniden sarılıyor (`new Blob([file], { type })`).
    - `photoRejection` kaldırıldı. `photoStoragePath` aynı kaldı (`storage-rls` testleri ona rastgele türler vererek SQL kuralını sınıyor); uygulama ona artık yalnızca imzadan gelen türü veriyor.
  - **Seçici `accept`:** iki seçicide de `image/*` bırakıldı; Android'de kamera seçeneği ve iPhone'da HEIC → JPEG dönüşümü bununla çalışıyor.
  - **Testler (+80):** `lib/image-file.test.ts`, `lib/image-decode.test.ts`, `lib/avatar-bucket.test.ts`; ayrıca `avatar`, `avatar-image`, `avatar-server` ve `listing` testleri. Kapsananlar:
    - MIME türleri: `image/x-png`, `IMAGE/PNG`, `image/pjpeg`, `image/jpg`, WebP;
    - boş ya da `octet-stream` türde uzantı yedeği;
    - imza kontrolü: yeniden adlandırılmış GIF, PDF, HEIC;
    - bozuk PNG, boyut sınırı, açma yedeklerinin sırası;
    - `photoUpload` yolu ve gövde türü.
  - **Tarayıcıda doğrulama** (üretim derlemesi, geçici önizleme sayfası; commit'lenmedi):
    - **Avatar:** 10 senaryonun hepsi beklendiği gibi çıktı. Beş PNG varyantı, WebP, `pjpeg` ve iki eski tarayıcı taklidi önizlemeye ulaştı; çıktı WebP. `.png` adlı GIF reddedildi.
    - **`/sell`:** tek seçimde 10 dosyadan 8'i kabul edildi, `.png` adlı GIF ve bozuk PNG reddedildi. Yollar ve gövde türleri gerçek türden geldi. Eski tarayıcı taklidi çalıştı; 11 fotoğrafta sayı 10'da durup uyarı çıktı.
    - Konsol temiz.

- **Zorunlu yönetici onayı (`59e7c86`, migration `20260928120000_vehicle_status_pending_approval.sql`, 27 Eylül 2026):**
  - **Olay:** kullanıcının uygunsuz içerikli test videosu (`c2113680…`, @amil_abiyev, 15 sn) Sightengine'den geçip yayına girdi. Kapak ve 1., 4., 7., 10., 13. saniyelerdeki beş kategorinin hepsi 0,001 çıktı; sahne örnek kareler arasındaydı. Kullanıcı videoyu Cloudflare'den sildi.
    - İlan aynı gün servis anahtarıyla `rejected` / `moderation_status = 'rejected'` / `moderation_reason = 'manual'` yapıldı. Denetim kaydına `provider = 'manual'` satırı yazıldı; hiçbir şey silinmedi.
    - Doğrulama: misafir API'si ilanı dönmüyor, ilan sayfası 404. Satıcı Vitrinim'de "yayınlanmadı" uyarısını görür.
  - **Yeni kural:** yapay zekâ ilanı hiçbir zaman yayına almaz.
    - Otomatik tarama temizse ilan `pending_approval`'a geçer (`moderation_reason = 'ai:safe'`, `moderation_status` `pending` kalır).
    - Şüpheli ya da denetlenemeyen ilan `pending_moderation`'da kalır. Açık ihlal yine otomatik reddedilir ve medyası silinir.
    - Yayına **yalnızca** /admin/reports → "İçerik denetimi"ndeki **Onayla** alır (`decideListingManually` → `approve`: `moderation_status = 'approved'` ve `status = 'active'` tek güncellemede).
    - Yayın şartı (`fn_check_vehicle_publishable`) `approved`'ı her rol için istediğinden sunucu da onaysız yayına alamaz. "Tekrar denetle" de yayına almaz.
  - **Yönetim paneli:** kuyruk artık `status in (pending_moderation, pending_approval)` ya da `moderation_reason` dolu ilanları getiriyor.
    - Onay bekleyen kartta yeşil "Otomatik tarama temiz · videoyu izleyip onayla" etiketi var.
    - Her kartta **"Videonun tamamını izle ↗"** bağlantısı var (Cloudflare Stream izleme sayfası `…/<uid>/watch`, yalnızca `*.cloudflarestream.com` HLS adresinden üretiliyor). Örnek kareler onay için yeterli değil; yönetici videoyu baştan sona izlemeli.
  - **Satıcı tarafı:**
    - Karede "Onay bekliyor" etiketi.
    - Vitrinim'in üstünde ve yönetim menüsünde "İlanınız onay bekliyor, yönetici incelemesinden sonra yayına alınacaktır." metni.
    - Açıklama, fotoğraf ve video kilitli. Satıcı ilanı bu durumdan çıkaramıyor, geri de çekemiyor.
    - `/sell` başarı ekranı: "içerik denetiminden ve yönetici onayından geçip yayına alınacak".
  - **Testler (+33):**
    - hiçbir otomatik sonuç ilanı onaylamıyor ya da yayına almıyor (temiz, şüpheli, ihlal, müstehcen, sağlayıcı yok);
    - yönetici onayı yayına alan tek yol;
    - depo sorguları (`awaitApproval` `approved` / `active` yazmıyor);
    - PGlite'ta `pending_approval` kuralları: herkese görünmez, satıcı çıkaramaz, sunucu `approved` olmadan yayına alamaz, metin ve fotoğraf kilitli;
    - kuyruk süzgeci, izleme adresi ve arayüz metinleri.
  - **Tarayıcıda doğrulama** (üretim derlemesi, geçici önizleme; commit'lenmedi): kare, panel kartı (etiket, izleme bağlantısı, "Onayla ve yayınla") ve yönetim menüsü metni doğru; "Yayına al" ve "İlanı geri çek" yok. Konsol temiz.
  - **Açık:** bugünkü iki ilan (`b2f00ade…`, `f753934d…`, @gozumkamil) `review:unavailable` ile panelde bekliyor. Sightengine bu ilanların en az bir karesini denetleyemedi; nedeni henüz araştırılmadı (5. bölüm).

## 4. Git ve dağıtım durumu

- Son kod commit'i **`59e7c86`** ("feat(moderation): mandatory admin approval before any listing goes live"); ondan önce `e11af9d` (`/sell` fotoğraf türleri), `47a384a` (avatar tür düzeltmesi) ve `2938b50` (içerik denetimi). Kodun deploy'u **`elan-g25du1gbz`** (27 Eylül 2026 20:59 TSİ). Ardından gelen doküman push'u (`bed1e64`) aynı kodu **`elan-4bia4hl1b`** ile yeniden deploy etti; oturum kapanırken `gozuyle.com` buna bağlıydı (`/`, `/my-listings`, `/admin/reports`, `/sell` → 200). Her doküman push'u yeni bir deploy kimliği üretir; güncel olanı `npx vercel inspect gozuyle.com` gösterir.
- İçerik denetimi (`2938b50`) ilk olarak `elan-hur1fzyh5` ile yayına girdi. Sightengine anahtarları eklenince kullanıcı yeniden deploy etti: `elan-3ajm0ibrc` (27 Eylül 2026 19:38 TSİ); sağlayıcı doğrulaması bununla yapıldı. Bu dosya ondan sonra ayrı dokümantasyon commit'leriyle güncellendi; her push aynı ortam değişkenleriyle yeniden deploy eder. Güncel `HEAD` için `git log -1`, güncel deploy için `npx vercel inspect gozuyle.com` kullanın.
- `origin/main`'e push edilen her commit'in production deploy'unu GitHub entegrasyonu başlatıyor. Durumu görmek için: `npx vercel ls elan-app`.
- Veritabanı kodla uyumlu: 21 migration'ın hepsi uzak veritabanında uygulanmış durumda (`npx supabase migration list --linked` ile kontrol edilebilir). **Sıra önemli:**
  - İçerik denetimi migration'ı koddan önce uygulanmalıydı (yeni kod `moderation_status` sütununu okuyor); uygulandı, hemen ardından push edildi. Geçiş anında video bekleyen ilan yoktu.
  - `20260928110000_avatars_allow_png.sql` da `47a384a`'nın push'undan önce uygulandı. Canlıda `avatars` → 1 MB, `{image/webp,image/jpeg,image/png}`.
- **Canlı doğrulama (27 Eylül 2026, `elan-g25du1gbz`, zorunlu yönetici onayı):**
  - `20260928120000_vehicle_status_pending_approval.sql` push'tan önce uygulandı. Canlı enum: `{draft,pending_video,active,sold,archived,rejected,pending_moderation,pending_approval}`.
  - `/`, `/my-listings`, `/admin/reports`, `/sell` → 200; oturumsuz `/api/admin/listings` → 401. Yayındaki pakette yeni satıcı metni, "Videonun tamamını izle" ve "Otomatik tarama temiz" var.
  - Yönetim kuyruğu sorgusu (`or(status.in.(pending_moderation,pending_approval),moderation_reason.not.is.null)`) canlı PostgREST'te birebir çalıştırıldı: hatasız, 2 ilan döndü (`b2f00ade…`, `f753934d…`).
- **Canlı doğrulama (27 Eylül 2026, `elan-j8byphjew`, görsel tür düzeltmeleri):**
  - `/`, `/sell`, `/my-listings` → 200; oturumsuz `/api/profile/avatar` → 401.
  - Canlıdaki `/sell` paketinde yeni denetim ("Fotoğraflar kontrol ediliyor…") ve yeni hata metni var, eski "Fotoğraflar JPEG, PNG ya da WebP biçiminde olmalı" metni yok.
  - Önceki `elan-9kz1aauep` deploy'unun avatar paketinde de yeni metin vardı, eski "JPEG ya da PNG bir fotoğraf seç" yoktu.
  - Gerçek bir hesapla PNG yükleme Claude tarafından denenmedi (giriş yok); 5. bölüm, madde 0.
- **Canlı doğrulama (27 Eylül 2026, `elan-3ajm0ibrc`, Sightengine anahtarlarıyla):**
  - `npx vercel inspect gozuyle.com` → `elan-3ajm0ibrc`. `vercel env ls`: `SIGHTENGINE_API_USER` ve `SIGHTENGINE_API_SECRET` Production, Preview ve Development'ta tanımlı.
  - `/`, `/my-listings`, `/admin/reports`, `/@nihad`, `/sell` → 200. Oturumsuz `/api/admin/listings`, `/api/messages`, `/api/profile/avatar` → 401.
  - Sağlayıcı testleri geçti; ayrıntılar 3. bölümde ("Sağlayıcı canlıda").
  - Docs push'uyla gelen `elan-dr3462ykz` (aynı kod ve ortam değişkenleri) üzerinde gerçek avatar yüklemesi Sightengine'den `safe` aldı ve kaydedildi (3. bölüm).
  - Veritabanı: denetimi bekleyen ilan yok, 3 ilan `approved`.
- **Canlı doğrulama (27 Eylül 2026, `elan-hur1fzyh5`, sağlayıcı anahtarı yokken):**
  - `/`, `/my-listings`, `/admin/reports`, `/@nihad`, `/search`, `/sell` → 200. Oturumsuz `/api/admin/listings` (GET/POST), `/api/messages`, `/api/profile/avatar` → 401; webhook yanlış imzada 401.
  - Uzak veritabanı: 3 mevcut ilan `approved`, enum'da `pending_moderation`, dört yeni tetikleyici, `vehicle_images` yazma politikalarında durum şartı. `content_moderation_events`'te RLS açık; anon/authenticated erişemiyor.
  - Canlı PostgREST'te yeni sorgular birebir çalıştırıldı: misafir vitrin sorgusu (`moderation_status` dahil) 200, misafir `pending_moderation` ilan göremiyor, yönetim kuyruğu sorgusu (`or(... not.is.null)`) ve denetim deposunun okuma sorgusu hatasız.
  - `/@nihad` tarayıcıda ızgarasıyla çiziliyor, konsol temiz.
- **Önceki canlı doğrulama (`elan-41lzfqr7q`):**
  - `/`, `/settings`, `/search`, `/@nihad`, `/manifest.json`, `/icons/icon-512.png` → 200. Canlıdaki ikon repodakiyle bayt bayt aynı; manifest `theme_color` `#121212`.
  - Ana sayfada yeni logo var (göz hattı 4.5), alt menü mat `#121212`, video durdurulunca göz-oynat simgesi beliriyor, taşma yok. Ayarlar'da "Uygulama → Önbelleği temizle" var.
  - Konsolda yalnızca `ERR_NETWORK_IO_SUSPENDED` göründü: gizli tarayıcı panelinin askıya aldığı isteklerden (büyük olasılıkla video parçaları); sayfanın kendi istekleri 200.
- **Önceki canlı doğrulama (`elan-4yennuwg1`):**
  - `/`, `/settings`, `/search`, `/messages` → 200; `/account` → 308; `/@yok_boyle_biri` → 404. Misafir `start_direct_conversation` → 401.
  - Gerçek profil `/@nihad`: Takip Et, Mesaj ve Paylaş aynı satırda; misafirde "Mesaj" giriş penceresini açıyor. Takipçi sayısı 1 görünüyor: takip gerçek kullanımda da çalışmış.
  - Mobil ana sayfada sağ üstte büyüteç var. "Ara" iskeleti 41 ms'de geliyor. Konsol temiz.
  - Canlıda 1 konuşma vardı; migration sonrası yerinde.
- **Önceki canlı doğrulama (`elan-gijopf5vj`):** `/settings` 200, `/account` → 308 `/settings`. `/privacy`'de `id="haklarin"` ve `/settings` bağlantısı var. Ana sayfada "Takip Edilenler | Keşfet" en üst satırda; eski "Akış | Ara" satırı yok, taşma yok. Yeni RPC'ler misafire 401 dönüyor. Konsol temiz.
- **Önceki canlı doğrulama (`elan-ibwaxvjkb`):** `/`, `/?feed=following`, `/my-listings`, `/search` → 200. `/@ab` ve `/@yok_boyle_biri` → 404 ("Bu kullanıcı bulunamadı"; ikincisinde RPC çağrılıp null döndü). `/@Yok_Boyle` → 308 `/@yok_boyle`. Tarayıcıda sekmeler ve misafir kartı çalışıyor, konsol temiz.
- **Alan adları:** `gozuyle.com` 200. `www.gozuyle.com` 308 ile, `elan-app-amber.vercel.app` 307 ile `gozuyle.com`'a yönlendiriyor.
- **DNS** kayıt firmasında (`knuth` / `dijkstra.ihsdns.com`), Vercel nameserver'ları kullanılmıyor: kök alan A `216.198.79.1`, `www` CNAME `cname.vercel-dns.com`. Vercel'deki "Intended Nameservers ☓" uyarısı bu yüzden çıkıyor ve sorun değil.
- **Yerel `nslookup`:** bu makinenin varsayılan DNS sunucusu yanıt vermiyor; sorgu `nslookup <ad> 1.1.1.1` ile yapılmalı.
- **Vercel env (Production + Preview):**
  - Config: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://gozuyle.com`.
  - Sensitive: `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET`.
  - Secret: `ADMIN_EMAILS` (moderasyon paneli, yalnızca sunucuda okunur; 26 Eylül 2026'da eklendi); `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` (içerik denetimi; Production, Preview ve Development; 27 Eylül 2026'da eklendi).
  - Tanımlı değil: `NEXT_PUBLIC_SUPPORT_EMAIL`; `OPENAI_API_KEY` (metin denetimi yalnızca kelime filtresiyle), `REKOGNITION_*`, `MODERATION_IMAGE_PROVIDER` (boş: anahtarı tanımlı ilk sağlayıcı, yani Sightengine seçiliyor).
  - `NEXT_PUBLIC_*` değerleri build sırasında pakete gömülür; değiştirince yeniden deploy gerekir.
- **Supabase CLI** global kurulu değil. Kullanılan yol: `~/AppData/Local/npm-cache/_npx/aa8e5c70f9d8d161/node_modules/.bin/supabase` (`db query/push --linked`). Docker olmadığı için `db dump` çalışmıyor.

## 5. Açık işler

**Kullanıcı tarafında:**

0. ✅ **İçerik denetimi sağlayıcısı: Sightengine tanımlandı ve canlıda doğrulandı (27 Eylül 2026, `elan-3ajm0ibrc`).**
   - Anahtar geçerli; gerçek ilan safe, tabanca fotoğrafı rejected (silah 0,99), JPEG/WebP avatar kabul (ayrıntılar 3. bölümde). Avatar yüklemesi açık. Yeni ilanlar denetimden temiz geçse de yönetici onayı bekliyor (`pending_approval`, `59e7c86`).
   - Maliyet: Sightengine'de her görsel 4 işlem (nudity, weapon, violence, gore); bir ilan (6 kare + en fazla 10 fotoğraf) 24–64 işlem. Kota Sightengine panelinden izlenmeli; kota biterse ilanlar "Otomatik denetim yapılamadı" ile panelde elle onay bekler, avatar yüklemesi 503 döner.
   - **Kalan (kullanıcı):**
     - **Gizlilik:** ilan görselleri ve profil fotoğrafları artık Sightengine'e (Fransa) gönderiliyor. Gizlilik politikasında (KVKK aydınlatma, yurt dışına aktarım) bu işleyici belirtilmeli; `OPENAI_API_KEY` eklenirse ilan metinleri ve **özel mesajlar** OpenAI'ye (ABD) de gider. Hukuki inceleme maddesiyle birlikte ele alınmalı.
     - **İsteğe bağlı:** `OPENAI_API_KEY` eklenirse metin denetimi anlama göre de yapılır (taciz, tehdit, nefret); şu an yalnızca kelime filtresi var.
     - **Uçtan uca deneme** (Claude giriş yapamadığı için denenmedi):
       - ✅ avatar değiştirme: 27 Eylül 2026'da denendi; Sightengine `safe`, kaydedildi (3. bölüm);
       - görsel tür düzeltmesinden sonra (`47a384a`, `e11af9d`): telefondan **PNG** profil fotoğrafı yüklenmeli (şikayet edilen durum). `/sell`'de PNG, JPEG ve WebP fotoğraflar eklenmeli; ilan yayınlandıktan sonra fotoğraflar ilanda görünmeli. GIF ya da 10 MB üstü dosyada "Yalnızca JPG, PNG veya WebP yükleyebilirsiniz." / boyut hatası çıkmalı;
       - temiz video ile ilan: "Video işleniyor" → kısa süre "İnceleniyor" → "Onay bekliyor" (Vitrinim'de onay metni). Panelde "Videonun tamamını izle" ile izleyip **Onayla** → ilan "Yayında" ve akışta. Reddet → Vitrinim'de "Yayınlanmadı";
       - panelde bekleyen `b2f00ade…` ve `f753934d…` için karar verilmeli (videoları izlenerek);
       - /admin/reports: başlık "Moderasyon", "İçerik denetimi" bölümü boş;
       - iki hesapla sohbet: küfürlü mesaj gitmemeli ve metin kutuda kalmalı, normal mesaj anında gitmeli;
       - `/sell` açıklamasında küfür: alanın altında hata çıkmalı;
       - isteğe bağlı ret yolu: silah içeren görselle ilan → "Yayınlanmadı" ve medya silinir. Müstehcen içerikle deneme yapılmamalı.
   - **Yan bulgu:** satılmış (`d7a6d72c…`) ve arşivdeki (`b8a5ebe3…`) ilanın Cloudflare videoları artık yok (kapak 404). Arşivdeki ilan "Yayına al" ile açılırsa akışta videosu oynamaz; eski test verisi, gerekirse silinebilir.
1. ✅ **Supabase → URL Configuration: tamamlandı (26 Eylül 2026).** Kullanıcı panelden kontrol etti: Site URL `https://gozuyle.com`, Redirect URLs `https://gozuyle.com/**` (`/auth/callback`'i kapsar).
2. **Uçtan uca testler** (Claude giriş yapamadığı için denenmedi): Google girişi, oturum açıkken avatar, hesap silme (DB + `vehicle-photos` + Cloudflare temizliği), moderasyon paneli, fotoğraflı ve videolu gerçek bir ilan (yeni üç adımlı akış). Kontrol edilecekler:
   - JPEG, PNG ve WebP yüklenmeli (tarayıcı `image/x-png`, `image/jpg` ya da boş tür bildirse de); GIF ya da 10 MB üstü dosyada Türkçe hata çıkmalı.
   - iPhone'dan seçilen fotoğraf JPEG olarak gitmeli.
   - Yayın durumu kartında video yüzde çubuğu ilerlemeli; başarı ekranında "İşleniyor" görünmeli.
   - Gerçek sürükle-bırak ve iOS/Android cihazlar Claude tarafından denenmedi.
   - "Vitrinim"de videosu hazır olmayan arşivlenmiş ilan: yönetim menüsünde "Yayına al" gizli olmalı ve açıklama görünmeli.
   - **Mesajlaşma (iki hesapla):** ilandan "Mesaj gönder" → sohbet açılmalı; karşı tarafta mesaj sayfa yenilenmeden gelmeli (Realtime), rozet artmalı, sohbet açılınca okundu (mavi çift tik) görünmeli. Engelleme ve şikayetler denenmeli. Canlıda şu an yayında ilan yok (biri satılmış, biri arşivde); deneme için bir ilan yayında olmalı.
   - **Avatar:** telefondan fotoğraf seç → önizleme → kaydet; üst çubukta ve Vitrinim'de görünmeli. Görünen ad düzenlenebilmeli.
   - **Mobil klavye:** iPhone Safari ve Android Chrome'da sohbette klavye açılınca yazma alanı klavyenin hemen üstünde kalmalı.
   - **Ad kaydetme ve Ayarlar:** Vitrinim'de ya da Ayarlar'da görünen adı değiştir; "Ad kaydedilemedi" çıkmamalı, ad üst çubukta ve sohbette görünmeli. Ayarlar'da bildirim anahtarları sayfa yenilenince aynı kalmalı; engellenen kullanıcı listede görünmeli ve "Engeli kaldır" çalışmalı. `gozuyle.com/account` → Ayarlar'a yönlenmeli (Play Console'daki silme adresi). Telefonda "Ara"ya dokununca iskelet hemen gelmeli.
   - **Yeni ikon ve logo:** Play Store / APK'daki uygulama ikonu paketin içinde. Yeni ikonun telefonda görünmesi için TWA paketi PWABuilder'da yeniden üretilmeli; imzalama anahtarı aynı kalmalı, yoksa `assetlinks.json` parmak izi tutmaz. Tarayıcıdan "Ana ekrana ekle" yapanlarda yeni ikon hemen gelir.
   - **Profilden mesaj (iki hesapla):** B hesabının `/@ad` sayfasında "Mesaj" → sohbet açılmalı; başlıkta ilan kartı olmamalı, @ad görünmeli. A'dan da B'ye yazınca aynı sohbet açılmalı. Mesaj karşıya anında gitmeli, gelen kutusunda "Doğrudan mesaj" yazmalı. Engelleyince yazılamamalı.
   - **Kullanıcı adı ve takip (iki hesapla):** girişte "Kullanıcı adını belirle" penceresi açılmalı; yazarken yeşil tik / kırmızı çarpı doğru çıkmalı (ör. `sell` rezerve, diğer hesabın adı alınmış). Kaydedince `gozuyle.com/@ad` açılmalı. İkinci hesaptan bu sayfada "Takip Et" → sayı hemen artmalı; sayfa yenilenince de doğru kalmalı. "Takibi Bırak" sayıyı düşürmeli. Ana sayfada "Takip Edilenler" sekmesi yalnızca takip edilen satıcının videolarını göstermeli; kimse takip edilmiyorsa boş durum kartı çıkmalı. Akış kartında satıcı satırı ve "Takip et", ilan sayfasında "Satıcı" kartı görünmeli. Engelleyince iki yöndeki takip kalkmalı. Claude giriş yapamadığı için bunlar yalnızca PGlite ve sahte veriyle denendi.
   - Listede olmayan marka/model ile ilan (ör. katalogdaki bir markaya yeni model). İlan açılmalı ve ilanda adıyla görünmeli. Bu, `resolve_listing_catalog`'un canlıdaki ilk gerçek çağrısı olacak; Claude giriş yapamadığı için yalnızca PGlite'ta denendi.
3. ✅ **`www.gozuyle.com`: tamamlandı (26 Eylül 2026).**
   - Sorun DNS'te değildi: CNAME kaydı (`cname.vercel-dns.com`) zaten doğruydu. `www` Vercel projesine eklenmediği için yalnızca `gozuyle.com` için sertifika vardı.
   - Dashboard'dan eklendi ve 308 ile `gozuyle.com`'a yönlendirildi.
   - Doğrulama: Let's Encrypt sertifikası (SAN `www.gozuyle.com`), `https://www.gozuyle.com/` → `308` + `Location: https://gozuyle.com/`. Yol ve sorgu korunuyor; `http://www` iki adımda `https://gozuyle.com/`'a (200) varıyor.
4. **`destek@gozuyle.com`:** gerçek bir posta kutusu ya da yönlendirme kurulmalı, ya da `NEXT_PUBLIC_SUPPORT_EMAIL` tanımlanmalı. Adres gizlilik politikasında yayında.
5. **Vercel'deki fazla kayıt:** Preview'a ait eski `CLOUDFLARE_STREAM_WEBHOOK_SECRET` kaydı (id `TZ5cSerrSmMsQUac`) silinmeli. API ile silme izin denetimine takılmıştı.
6. ✅ **Play Store (TWA) Digital Asset Links: yayında (26 Eylül 2026, `f5f41ff`); Play App Signing parmak izi bekleniyor.**
   - [public/.well-known/assetlinks.json](public/.well-known/assetlinks.json): paket `com.gozuyle.twa`, PWABuilder'ın imzalama anahtarının SHA-256'sı (`EB:1F:55:…:01:95:2D`). Biçimi [lib/pwa-manifest.test.ts](lib/pwa-manifest.test.ts) denetliyor.
   - Canlıda doğrulandı: `200`, `application/json`, repodaki dosyayla aynı gövde; `www` 308 ile kök alan adına yönleniyor. Google Digital Asset Links API (`statements:list`) kaydı hatasız okuyor.
   - **Kalan:** uygulama Play Console'a **Play App Signing** ile yüklenirse Google yeniden imzalar ve telefondaki uygulamanın parmak izi değişir. Bu yapılmazsa doğrulama başarısız olur ve uygulamada adres çubuğu görünür. Play Console → Test and release → App integrity → App signing → *App signing key certificate* SHA-256 değeri `sha256_cert_fingerprints` dizisine **ikinci değer** olarak eklenmeli. Mevcut değer, doğrudan yüklenen APK'lar için kalmalı.
   - Kullanıcı APK'yı telefonda deniyor (26 Eylül 2026). Adres çubuğu görünmüyorsa doğrulama çalışıyor demektir.
7. ✅ **Moderasyon paneline erişim: tamamlandı (26 Eylül 2026).** `ADMIN_EMAILS` Production ve Preview'a Secret olarak eklendi (15:13 UTC). Ondan sonra başlayan deploy (`elan-6ie9dxson`) `gozuyle.com`'a bağlı. Canlıda token olmadan API `401`, sayfa `200` + `noindex` dönüyor. Yönetici hesabıyla uçtan uca deneme 2. maddede.
8. ✅ **Storage yükleme politikası: tamamlandı (26 Eylül 2026).**
   - Sorun: `vehicle-photos` bucket'ının "Authenticated users can upload vehicle photos" INSERT politikası yalnızca `bucket_id`'ye bakıyordu; giriş yapmış herkes her yola, her tür ve boyutta dosya yükleyebiliyordu.
   - Migration (`20260926180000_vehicle_photos_storage_limits.sql`, commit `7af67eb`):
     - Bucket'a 10 MB ve yalnızca `image/jpeg`, `image/png`, `image/webp` sınırı. Tür ve boyut artık her yüklemede sunucuda denetleniyor.
     - Yükleme kuralını tutan `public.fn_can_upload_vehicle_photo(name)` fonksiyonu. Şartlar: yükleyen ilanın satıcısı, ilan `draft` ya da `pending_video`, yol `<ilan>/<0-9>.<jpeg|png|webp>`.
     - İstemci aynı kuralları `photoRejection` ile seçim anında uyguluyor.
   - Panel: INSERT politikası "Authenticated users can upload vehicle photos" Supabase panelinden `bucket_id = 'vehicle-photos' and public.fn_can_upload_vehicle_photo(name)` olarak güncellendi. Migration'lar `storage.objects` politikalarını değiştiremiyor, çünkü `postgres` rolü `supabase_storage_admin`'in üyesi değil.
   - Uzak veritabanında doğrulandı (`pg_policies`):
     - `storage.objects`'te RLS açık. Yalnızca iki yazma politikası var, ikisi de INSERT ve kendi bucket'ına ve sahiplik fonksiyonuna bağlı: `vehicle-photos` → `fn_can_upload_vehicle_photo`, `vehicle-images` → `fn_can_upload_vehicle_image`.
     - UPDATE/ALL politikası yok; yüklenmiş bir dosyanın üzerine yazılamıyor.
     - Fonksiyon `security definer`; anonim role kapalı, `authenticated`'a açık.
   - Politika değişirse `lib/storage-rls.test.ts`'teki `DASHBOARD_POLICY` de güncellenmeli: test, panelde kurulu olan ifadeyi taklit ediyor.
   - İstenirse aynı ekranda DELETE politikası "Users can delete own vehicle photos" da düzeltilebilir: `foldername[1] = auth.uid()` şartı uygulamanın yoluyla (`<ilan>/…`) hiç eşleşmiyor. Güvenlik açığı değil; satıcı fotoğrafını istemciden silemiyor, hesap silme ise servis anahtarıyla çalışıyor.

**Teknik ve ürün:**

- **İçerik denetiminin bilinen sınırları:**
  - **Video örnekleme:** videonun 6 karesine bakılıyor (kapak + 5 ara kare). Kareler arasına sıkıştırılmış kısa bir sahne kaçabilir. Sıklaştırmak `VIDEO_SAMPLE_FRAMES`'le mümkün; sağlayıcı maliyeti artar.
  - **Doğrudan yazım:** `messages_insert_participant` kullanıcının tabloya doğrudan yazmasına hâlâ izin veriyor. Uygulamayı atlayıp API'ye doğrudan yazan biri OpenAI denetimini atlar ama veritabanındaki kelime filtresine takılır. Tamamen kapatmak için INSERT yetkisi alınıp mesaj yalnızca sunucudan yazılmalı (hız sınırı ve engel kuralları taşınmalı).
  - **Yarım kalan denetim:** `after()` yarıda kalırsa ilan `pending_moderation`'da kalır ve panelde "Otomatik denetim sürüyor ya da yarıda kaldı" olarak görünür. Otomatik yeniden deneme (cron) yok; Hobby planda cron günde bir.
  - **"Otomatik denetim yapılamadı" (27 Eylül 2026):** üç ilan (`b2f00ade…`, `f753934d…` ve satıcının sonradan sildiği `85f59778…`) `review:unavailable` aldı. Sightengine en az bir kareyi denetleyemedi (olası nedenler: kare adresi, eşzamanlı istek sınırı, kota). Nedeni araştırılmadı; zorunlu onay sayesinde yayına sızma riski yok ama kuyruğu şişirir.
  - **Kare örnekleme:** kapak + 5 kare, 15 sn'lik videodaki sahneyi kaçırdı. Artık yayın yönetici onayına bağlı; otomatik ret isabetini artırmak için saniyede bir kare ya da Sightengine video (tam tarama) API'si düşünülebilir (maliyet artar).
  - **Rekognition:** 5 MB'tan büyük fotoğrafı denetleyemez; ilan incelemeye düşer.
  - **Yasal:** reddedilen medya hemen siliniyor. Reşit olmayanlarla ilgili içerikte yasal saklama ve bildirim yükümlülükleri olabilir; hukuki görüş alınmalı.
  - **Denetlenmeyen metinler:** görünen ad ve kullanıcı adı filtreden geçmiyor (yalnızca rezerve liste var). Onaylanmış ilanın şehir ve rengi değiştirilebiliyor ama kelime filtresine takılıyor.
- ✅ `/api/reports` için kalıcı istek sınırı: tamamlandı (26 Eylül 2026). Veritabanı sayacı ve kullanıcı bazlı kurallar kuruldu; ayrıntılar 3. bölümde. Hobby planda Vercel Firewall kuralı eklenemiyor.
  - Kalan küçük not: anonim istekler hâlâ IP'ye göre sayılıyor. CGNAT arkasındaki çok sayıda anonim bildiren aynı IP'nin dakikada 5 hakkını paylaşır. Trafik artarsa anonim sınır gözden geçirilmeli.
  - Gizlilik politikasına "kötüye kullanımı önlemek için IP adresinin anahtarlı özeti en fazla 24 saat saklanır" benzeri bir cümle eklenmesi düşünülebilir (hukuki inceleme maddesiyle birlikte).
- Kullanıcıların eklediği marka/modeller için bir yönetim ekranı yok. Yalnızca veritabanında görülebiliyor (`is_user_created = true`). İleride moderasyon paneline "onayla / katalogdaki kayıtla birleştir" eklenebilir.
- **Kullanıcı şikayetleri** (`user_reports`) moderasyon panelinde görünmüyor; şimdilik yalnızca veritabanında. Panel ilan şikayetlerini (`reports`) gösteriyor; kullanıcı şikayetleri için ayrı bir sekme eklenmeli (Google Play incelemesi için önemli).
- **Mesaj bildirimleri:** uygulama kapalıyken bildirim yok (web push ya da e-posta). Rozet yalnızca site açıkken güncelleniyor. Ayarlar'daki bildirim tercihleri (`user_metadata.notification_prefs`: `messages`, `followers`, `followingListings`) kaydediliyor; gönderim kurulunca bunlara bakılmalı.
- **Takip sisteminin eksikleri:**
  - Takipçi / takip edilen listesi sayfası yok (sayılar tıklanmıyor).
  - "Seni takip etti" bildirimi yok.
  - Değişen kullanıcı adı hemen boşa çıkıyor; eski adres başkasına geçebilir. Instagram'daki gibi 14 gün tutma yok.
  - Uygunsuz kullanıcı adları için moderasyon ekranı yok. Yalnızca rezerve liste var; düzeltme şimdilik veritabanından yapılıyor.
  - Kullanıcı adı olmayan satıcının vitrini yok: akış kartında adı görünüyor ama bağlantı yok.
- **Vitrinim'de pasif ilanın önizlemesi:** yayında olmayan ilanın herkese açık sayfası yok (sunucu anonim okuyor). Satıcı ilanını önizleyemiyor; yalnızca yönetim menüsü açılıyor.
- Yasal metinler şablon; hukuki inceleme gerekiyor.
- Google onay ekranında `supabase.co` alan adı görünebilir; istenirse Supabase'e özel alan adı bağlanabilir. Bağlanırsa `fn_is_vehicle_photo_url`'deki sabit proje adresi de yeni bir migration'la güncellenmeli; güncellenmezse yeni fotoğraf eklemeleri reddedilir.

## Çalışma notları ve tuzaklar

- **Görsel doğrulama** üretim derlemesiyle yapılmalı: `npm run build`, ardından `.claude/launch.json` → `elan-prod` (port 3100). `next dev` yeni Tailwind sınıflarını bazen geç üretiyor.
- **Bayat tip çıktısı:** geliştirme sunucusu açıkken bir sayfa silinirse build düşer; önce `rm -rf .next/dev`.
- **`vercel link`:** `.gitignore`'a tekrar eden satırlar ekliyor (bunlar `.env.example` istisnasını bozuyor) ve `.env.local`'e `VERCEL_OIDC_TOKEN` yazıyor. `.gitignore` geri alınmalı; bu token Vercel'e aktarılmamalı.
- **Gizli değerler** asla sohbete yazdırılmaz; yalnızca stdin ile aktarılır, adları ya da maskeli başları gösterilir.
- **Tarayıcı paneli** ekranda çizilmediğinde ekran görüntüsü ve koordinatlı tıklama hatalı oluyor; ölçüm ve tıklama JavaScript ile yapılmalı.
- **Kontrol komutları:** `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint`, `npm run build`.
- **Giriş gerektiren ekranların görsel kontrolü:** Claude giriş yapamadığı için `app/dev-preview/page.tsx` gibi geçici bir sayfada bileşenler sahte veriyle çizilir, derlenip bakılır, **commit'ten önce silinir**. Silindikten sonra ilk `tsc`, bayat `.next/types/validator.ts` yüzünden hata verebilir; `npm run build` dosyayı yeniden üretir.
- **Claude worktree'leri** repo içinde, `.claude/worktrees/` altında durur.
  - Biri varken ana dizinde çalışan `vitest` ve `eslint` onun dosyalarını da tarar: test sayısı iki katına çıkar, worktree'deki `.next` yüzünden eslint hata verir. Kontroller worktree kaldırıldıktan sonra ya da worktree'nin içinde çalıştırılmalı.
  - Worktree'de `node_modules` ve Supabase bağlantısı olmaz: `npm install` gerekir, `supabase/.temp/` ana dizinden kopyalanabilir (gitignore'da). `tsc`'den önce `npx next typegen` çalıştırılmalı.
- **Migration'larda `storage.objects` politikası** oluşturulamaz ya da silinemez (sahibi `supabase_storage_admin`); `storage.buckets` satırları güncellenebilir.
