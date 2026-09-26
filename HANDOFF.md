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
- **Supabase:** Auth (e-posta/şifre, magic link, Google OAuth; `flowType: implicit`), Postgres + RLS, Storage (uygulama `vehicle-photos` bucket'ını kullanıyor: 10 MB, jpeg/png/webp; `vehicle-images` bucket'ı da var ama kullanılmıyor).
  - Tarayıcı istemcisi [lib/supabase.ts](lib/supabase.ts): tembel Proxy, ilk kullanımda kurulur. Env eksikse import'ta değil kullanımda hata verir; `then` erişimini ayrıca karşılar.
  - Servis istemcisi [lib/supabase-server.ts](lib/supabase-server.ts): yalnızca API route'larında kullanılıyor.
- **Cloudflare Stream:** tus ile doğrudan yükleme ([lib/tus-upload.ts](lib/tus-upload.ts)), HLS oynatma (hls.js), imzalı webhook.
- **Vercel:** team ve proje `elan-app`, Node 24. GitHub `Invicta707/elan-app` reposunun `main` dalı otomatik olarak production'a deploy ediliyor; ayrıca `npx vercel --prod` (CLI 60.x) kullanılıyor.
- **Testler:** Vitest; 36 dosya, **628 test**, hepsi `lib/*.test.ts(x)` altında. Bileşen testleri `lib/ui-components.test.tsx`'te: dosyanın başındaki `// @vitest-environment happy-dom` yorumu happy-dom'u açıyor (devDependency'ler: `happy-dom`, `@testing-library/react`, `@testing-library/dom`); `next/image` ve `next/link` sade HTML öğeleriyle taklit ediliyor. Uç nokta testleri de burada (örnek: `lib/reports-route.test.ts`, route'u `vi.resetModules` ile her testte yeniden yükler).
  - **Veritabanı güvenlik testleri** ([lib/listing-rls.test.ts](lib/listing-rls.test.ts)): migration dosyalarını gerçek bir Postgres'te (PGlite, WASM; devDependency `@electric-sql/pglite`) çalıştırır. Satıcı, anonim kullanıcı, servis anahtarı ve yönetici istekleri `set local role` ile `request.jwt.claims` üzerinden taklit edilir. Başlangıç şeması, uzak veritabanından okunmuş tanımların asgari kopyasıdır; RLS/tetikleyici değişince oradaki `BASE_SCHEMA` da güncellenmeli.
- **Veri modeli:**
  - Favoriler ayrı tabloda değil; `interactions` tablosunda `type='save'` satırı olarak tutuluyor (RLS, tekil indeks, `saves_count` tetikleyicisi).
  - `reports` tablosu: RLS açık, **hiç politika yok**; yalnızca API yazabiliyor. Kapanan bildirimde `resolved_at` ve `resolved_by` dolar. İlan şikayetleri (sohbet menüsünden gelenler dahil) buraya gidiyor.
  - **`profiles`:** `whatsapp_number`, `display_name` (2–30 karakter, `<>` yok), `avatar_url`. Satırı **yalnızca sahibi okuyor.** Başkalarının adı ve avatarı mesajlaşma RPC'lerinden geliyor; numara yalnızca `get_seller_whatsapp` ile. `avatar_url`'ı yalnızca sunucu yazabiliyor (sütun yetkisi).
  - **Mesajlaşma:** `conversations` (ilan + alıcı tekil), `messages`, `user_blocks`, `user_reports`. RLS: yalnızca iki taraf okuyor/yazıyor, engel varsa gönderilemiyor. `is_read` ve `created_at` istemciden yazılamıyor. Gönderen başına dakikada 30 mesaj. `messages` Realtime yayınında.
  - **Storage `avatars`:** herkese açık okunuyor, 1 MB, webp/jpeg. Yazma yalnızca sunucudan (`/api/profile/avatar`, servis anahtarı).
  - **İlan durumu:** `draft`, `pending_video`, `active`, `sold`, `archived`, `rejected` (moderasyon). Satıcının geçişleri tek tabloda: `set_vehicle_status` RPC'si, `trg_vehicles_guard_owner_status` tetikleyicisi ve [lib/listing-status.ts](lib/listing-status.ts) `OWNER_TRANSITIONS`. Testler üçünün aynı kaldığını denetliyor.
  - **Yayın şartı:** ilan yalnızca işlenmiş bir videosu varsa (`videos.status = 'ready'` ve `hls_url` dolu) `active` olabilir. Kural isteği kim yaparsa yapsın geçerli; fotoğraf tek başına yetmez.
  - **Fotoğraf adresi:** `vehicle_images.image_url` yalnızca `https://<proje>.supabase.co/storage/v1/object/public/vehicle-photos/<ilan>/<sıra>.<uzantı>` olabilir (`fn_is_vehicle_photo_url`). Proje adresi migration'a sabit yazıldı.
  - Katalog: 36 marka, 300 model (kürate edilmiş, `is_user_created = false`).
  - **Kullanıcının yazdığı marka/model:** kataloğa `is_user_created = true` ve `created_by` ile eklenir.
    - Ekleme yalnızca `resolve_listing_catalog` RPC'siyle yapılıyor: giriş şart, ad denetleniyor, kullanıcı başına 24 saatte 10 yeni kayıt sınırı var.
    - Aynı adın farklı yazımları tek kayıttır: `fn_catalog_key` ile büyük/küçük harf, Türkçe/aksanlı harf ve noktalama önemsiz; benzersiz indeks bunu zorluyor.
    - Bu kayıtlar arama filtrelerine ve seçim kutusuna girmiyor, ilanda adıyla görünüyor. `vehicles.brand_id` / `model_id` yabancı anahtarları değişmedi.

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
| Bildirim | [components/ReportButton.tsx](components/ReportButton.tsx), [app/api/reports/route.ts](app/api/reports/route.ts), [lib/reports.ts](lib/reports.ts) (`REPORT_RATE_RULES`, `REPORT_BURST_LIMIT`), [lib/rate-limit.ts](lib/rate-limit.ts) (bellek içi, `rateLimitSubject`), [lib/rate-limit-server.ts](lib/rate-limit-server.ts) (kalıcı sayaç, HMAC anahtarı), [lib/rate-limit-db.test.ts](lib/rate-limit-db.test.ts) (PGlite) |
| Moderasyon | [app/admin/reports/page.tsx](app/admin/reports/page.tsx), [components/ModerationView.tsx](components/ModerationView.tsx), [app/api/admin/reports/route.ts](app/api/admin/reports/route.ts), [lib/moderation.ts](lib/moderation.ts), [lib/moderation-server.ts](lib/moderation-server.ts) (`authorizeAdmin`: `ADMIN_EMAILS`, onaylı e-posta) |
| Vitrinim / durum | [components/showcase/ShowcaseView.tsx](components/showcase/ShowcaseView.tsx) (profil başlığı + 3 sütunlu dikey ızgara), [components/showcase/ShowcaseTile.tsx](components/showcase/ShowcaseTile.tsx), [components/showcase/ListingManageSheet.tsx](components/showcase/ListingManageSheet.tsx) (durum değiştirme), [lib/my-listings.ts](lib/my-listings.ts), [lib/showcase.ts](lib/showcase.ts), [lib/listing-status.ts](lib/listing-status.ts), [lib/listing-rls.test.ts](lib/listing-rls.test.ts) |
| Profil | [components/profile/AvatarPicker.tsx](components/profile/AvatarPicker.tsx), [components/profile/EditNameSheet.tsx](components/profile/EditNameSheet.tsx), [lib/profile.ts](lib/profile.ts), [lib/use-my-profile.ts](lib/use-my-profile.ts) (paylaşılan profil deposu), [lib/avatar.ts](lib/avatar.ts), [lib/avatar-image.ts](lib/avatar-image.ts) (tarayıcıda kare kırpma ve WebP), [lib/avatar-server.ts](lib/avatar-server.ts), [app/api/profile/avatar/route.ts](app/api/profile/avatar/route.ts) |
| Mesajlaşma | [app/messages/page.tsx](app/messages/page.tsx), [app/messages/[id]/page.tsx](app/messages/[id]/page.tsx), [components/messages/InboxView.tsx](components/messages/InboxView.tsx), [components/messages/ChatView.tsx](components/messages/ChatView.tsx) (Realtime, klavye), [components/messages/ChatParts.tsx](components/messages/ChatParts.tsx), [components/messages/ReportUserSheet.tsx](components/messages/ReportUserSheet.tsx), [components/vehicle/MessageSellerButton.tsx](components/vehicle/MessageSellerButton.tsx), [lib/messages.ts](lib/messages.ts), [lib/use-unread-count.ts](lib/use-unread-count.ts), [lib/messaging-rls.test.ts](lib/messaging-rls.test.ts) (PGlite) |
| Ortak arayüz | [components/ui/BottomSheet.tsx](components/ui/BottomSheet.tsx), [components/ui/Avatar.tsx](components/ui/Avatar.tsx), [components/ui/UnreadBadge.tsx](components/ui/UnreadBadge.tsx); animasyonlar `app/globals.css`'te (`sheet-up`, `badge-pop`, `bubble-in`, `fade-in`) |
| Katalog / arama | [lib/search.ts](lib/search.ts) (`fetchCatalog`, `compareCatalogNames`), [components/SearchView.tsx](components/SearchView.tsx), [app/sell/page.tsx](app/sell/page.tsx) |
| İlan verme (`/sell`) | [app/sell/page.tsx](app/sell/page.tsx): adım durumu, doğrulama, gönderim (`runSubmit`, `uploadPhotos`). [app/sell/layout.tsx](app/sell/layout.tsx): yazı tipleri ve başlık. [components/sell/FormControls.tsx](components/sell/FormControls.tsx): `Field`, `TextInput`, `GroupedNumberInput`, `SelectInput`, `ChoiceGroup`. [components/sell/CatalogCombobox.tsx](components/sell/CatalogCombobox.tsx): marka/model seçim kutusu. [components/sell/MediaPickers.tsx](components/sell/MediaPickers.tsx): `VideoDropzone`, `PhotoDropzone`. [components/sell/SellChrome.tsx](components/sell/SellChrome.tsx): `SellStepper`, `FormCard`, `SubmitProgress`, `SellActionBar`, `SellSuccess`. [lib/listing.ts](lib/listing.ts): `LISTING_STEPS`, `listingFieldErrors`, `stepFieldErrors`, `groupThousands`, `caretAfterDigits`. [lib/sell-progress.ts](lib/sell-progress.ts): gönderim aşamaları ve yüzde |
| Akış | [components/VideoCard.tsx](components/VideoCard.tsx) (sağ sütun: Favori, Paylaş, Detaylar, Bildir, Ses), [components/vehicle/ShareButton.tsx](components/vehicle/ShareButton.tsx), [lib/share.ts](lib/share.ts) |
| Site / yasal | [lib/site-url.ts](lib/site-url.ts), [lib/legal.ts](lib/legal.ts) (`NEXT_PUBLIC_SUPPORT_EMAIL`, yoksa `destek@gozuyle.com`), [app/privacy](app/privacy/page.tsx), [app/terms](app/terms/page.tsx) |
| PWA / TWA | [public/manifest.json](public/manifest.json) (`gözüyle`, `#0A0A0A`), [scripts/generate-icons.mjs](scripts/generate-icons.mjs) (ikonları ve `app/favicon.ico`'yu üretir), [public/.well-known/assetlinks.json](public/.well-known/assetlinks.json) (Android paketi `com.gozuyle.twa`) |
| Veritabanı | [supabase/migrations/](supabase/migrations/): 13 migration, sonuncusu `20260926210000_profiles_and_messaging.sql`; hepsi uzak veritabanında uygulanmış (son yedisi 26 Eylül 2026'da `db push --linked` ile) |
| Storage | [lib/listing.ts](lib/listing.ts) (`PHOTO_MIME_TYPES`, `MAX_PHOTO_BYTES`, `MAX_PHOTOS`, `photoRejection`), [lib/storage-rls.test.ts](lib/storage-rls.test.ts) (bucket sınırları ve `fn_can_upload_vehicle_photo`, PGlite) |
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

## 4. Git ve dağıtım durumu

- Son kod commit'i **`15c9455`** ("feat(profile-chat): add showcase grid, avatar upload, and realtime listing dm"); production deploy'u `elan-5apv17wj4`. Bu dosya ondan sonra ayrı bir dokümantasyon commit'iyle güncellendi; güncel `HEAD` için `git log -1` kullanın.
- `origin/main`'e push edilen her commit'in production deploy'unu GitHub entegrasyonu başlatıyor. Durumu görmek için: `npx vercel ls elan-app`.
- Veritabanı kodla uyumlu: 13 migration'ın hepsi uzak veritabanında uygulanmış durumda (`npx supabase migration list --linked` ile kontrol edilebilir).
- **Alan adları:** `gozuyle.com` 200. `www.gozuyle.com` 308 ile, `elan-app-amber.vercel.app` 307 ile `gozuyle.com`'a yönlendiriyor.
- **DNS** kayıt firmasında (`knuth` / `dijkstra.ihsdns.com`), Vercel nameserver'ları kullanılmıyor: kök alan A `216.198.79.1`, `www` CNAME `cname.vercel-dns.com`. Vercel'deki "Intended Nameservers ☓" uyarısı bu yüzden çıkıyor ve sorun değil.
- **Yerel `nslookup`:** bu makinenin varsayılan DNS sunucusu yanıt vermiyor; sorgu `nslookup <ad> 1.1.1.1` ile yapılmalı.
- **Vercel env (Production + Preview):**
  - Config: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=https://gozuyle.com`.
  - Sensitive: `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET`.
  - Secret: `ADMIN_EMAILS` (moderasyon paneli, yalnızca sunucuda okunur; 26 Eylül 2026'da eklendi).
  - Tanımlı değil: `NEXT_PUBLIC_SUPPORT_EMAIL`.
  - `NEXT_PUBLIC_*` değerleri build sırasında pakete gömülür; değiştirince yeniden deploy gerekir.
- **Supabase CLI** global kurulu değil. Kullanılan yol: `~/AppData/Local/npm-cache/_npx/aa8e5c70f9d8d161/node_modules/.bin/supabase` (`db query/push --linked`). Docker olmadığı için `db dump` çalışmıyor.

## 5. Açık işler

**Kullanıcı tarafında:**

1. ✅ **Supabase → URL Configuration: tamamlandı (26 Eylül 2026).** Kullanıcı panelden kontrol etti: Site URL `https://gozuyle.com`, Redirect URLs `https://gozuyle.com/**` (`/auth/callback`'i kapsar).
2. **Uçtan uca testler** (Claude giriş yapamadığı için denenmedi): Google girişi, oturum açıkken avatar, hesap silme (DB + `vehicle-photos` + Cloudflare temizliği), moderasyon paneli, fotoğraflı ve videolu gerçek bir ilan (yeni üç adımlı akış). Kontrol edilecekler:
   - JPEG, PNG ve WebP yüklenmeli; GIF ya da 10 MB üstü dosyada Türkçe hata çıkmalı.
   - iPhone'dan seçilen fotoğraf JPEG olarak gitmeli.
   - Yayın durumu kartında video yüzde çubuğu ilerlemeli; başarı ekranında "İşleniyor" görünmeli.
   - Gerçek sürükle-bırak ve iOS/Android cihazlar Claude tarafından denenmedi.
   - "Vitrinim"de videosu hazır olmayan arşivlenmiş ilan: yönetim menüsünde "Yayına al" gizli olmalı ve açıklama görünmeli.
   - **Mesajlaşma (iki hesapla):** ilandan "Mesaj gönder" → sohbet açılmalı; karşı tarafta mesaj sayfa yenilenmeden gelmeli (Realtime), rozet artmalı, sohbet açılınca okundu (mavi çift tik) görünmeli. Engelleme ve şikayetler denenmeli. Canlıda şu an yayında ilan yok (biri satılmış, biri arşivde); deneme için bir ilan yayında olmalı.
   - **Avatar:** telefondan fotoğraf seç → önizleme → kaydet; üst çubukta ve Vitrinim'de görünmeli. Görünen ad düzenlenebilmeli.
   - **Mobil klavye:** iPhone Safari ve Android Chrome'da sohbette klavye açılınca yazma alanı klavyenin hemen üstünde kalmalı.
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

- ✅ `/api/reports` için kalıcı istek sınırı: tamamlandı (26 Eylül 2026). Veritabanı sayacı ve kullanıcı bazlı kurallar kuruldu; ayrıntılar 3. bölümde. Hobby planda Vercel Firewall kuralı eklenemiyor.
  - Kalan küçük not: anonim istekler hâlâ IP'ye göre sayılıyor. CGNAT arkasındaki çok sayıda anonim bildiren aynı IP'nin dakikada 5 hakkını paylaşır. Trafik artarsa anonim sınır gözden geçirilmeli.
  - Gizlilik politikasına "kötüye kullanımı önlemek için IP adresinin anahtarlı özeti en fazla 24 saat saklanır" benzeri bir cümle eklenmesi düşünülebilir (hukuki inceleme maddesiyle birlikte).
- Kullanıcıların eklediği marka/modeller için bir yönetim ekranı yok. Yalnızca veritabanında görülebiliyor (`is_user_created = true`). İleride moderasyon paneline "onayla / katalogdaki kayıtla birleştir" eklenebilir.
- **Kullanıcı şikayetleri** (`user_reports`) moderasyon panelinde görünmüyor; şimdilik yalnızca veritabanında. Panel ilan şikayetlerini (`reports`) gösteriyor; kullanıcı şikayetleri için ayrı bir sekme eklenmeli (Google Play incelemesi için önemli).
- **Mesaj bildirimleri:** uygulama kapalıyken bildirim yok (web push ya da e-posta). Rozet yalnızca site açıkken güncelleniyor.
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
