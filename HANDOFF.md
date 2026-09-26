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
- **Testler:** Vitest; 26 dosya, **370 test**, hepsi `lib/*.test.ts` altında. Uç nokta testleri de burada (örnek: `lib/reports-route.test.ts`, route'u `vi.resetModules` ile her testte yeniden yükler).
  - **Veritabanı güvenlik testleri** ([lib/listing-rls.test.ts](lib/listing-rls.test.ts)): migration dosyalarını gerçek bir Postgres'te (PGlite, WASM; devDependency `@electric-sql/pglite`) çalıştırır. Satıcı, anonim kullanıcı, servis anahtarı ve yönetici istekleri `set local role` ile `request.jwt.claims` üzerinden taklit edilir. Başlangıç şeması, uzak veritabanından okunmuş tanımların asgari kopyasıdır; RLS/tetikleyici değişince oradaki `BASE_SCHEMA` da güncellenmeli.
- **Veri modeli:**
  - Favoriler ayrı tabloda değil; `interactions` tablosunda `type='save'` satırı olarak tutuluyor (RLS, tekil indeks, `saves_count` tetikleyicisi).
  - `reports` tablosu: RLS açık, **hiç politika yok**; yalnızca API yazabiliyor. Kapanan bildirimde `resolved_at` ve `resolved_by` dolar.
  - **İlan durumu:** `draft`, `pending_video`, `active`, `sold`, `archived`, `rejected` (moderasyon). Satıcının geçişleri tek tabloda: `set_vehicle_status` RPC'si, `trg_vehicles_guard_owner_status` tetikleyicisi ve [lib/listing-status.ts](lib/listing-status.ts) `OWNER_TRANSITIONS`. Testler üçünün aynı kaldığını denetliyor.
  - **Yayın şartı:** ilan yalnızca işlenmiş bir videosu varsa (`videos.status = 'ready'` ve `hls_url` dolu) `active` olabilir. Kural isteği kim yaparsa yapsın geçerli; fotoğraf tek başına yetmez.
  - **Fotoğraf adresi:** `vehicle_images.image_url` yalnızca `https://<proje>.supabase.co/storage/v1/object/public/vehicle-photos/<ilan>/<sıra>.<uzantı>` olabilir (`fn_is_vehicle_photo_url`). Proje adresi migration'a sabit yazıldı.
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
| Moderasyon | [app/admin/reports/page.tsx](app/admin/reports/page.tsx), [components/ModerationView.tsx](components/ModerationView.tsx), [app/api/admin/reports/route.ts](app/api/admin/reports/route.ts), [lib/moderation.ts](lib/moderation.ts), [lib/moderation-server.ts](lib/moderation-server.ts) (`authorizeAdmin`: `ADMIN_EMAILS`, onaylı e-posta) |
| İlanlarım / durum | [components/MyListingsView.tsx](components/MyListingsView.tsx), [lib/my-listings.ts](lib/my-listings.ts), [lib/listing-status.ts](lib/listing-status.ts), [lib/listing-rls.test.ts](lib/listing-rls.test.ts) |
| Katalog / arama | [lib/search.ts](lib/search.ts) (`fetchCatalog`, `compareCatalogNames`), [components/SearchView.tsx](components/SearchView.tsx), [app/sell/page.tsx](app/sell/page.tsx) |
| Akış | [components/VideoCard.tsx](components/VideoCard.tsx) (sağ sütun: Favori, Paylaş, Detaylar, Bildir, Ses), [components/vehicle/ShareButton.tsx](components/vehicle/ShareButton.tsx), [lib/share.ts](lib/share.ts) |
| Site / yasal | [lib/site-url.ts](lib/site-url.ts), [lib/legal.ts](lib/legal.ts) (`NEXT_PUBLIC_SUPPORT_EMAIL`, yoksa `destek@gozuyle.com`), [app/privacy](app/privacy/page.tsx), [app/terms](app/terms/page.tsx) |
| PWA | [public/manifest.json](public/manifest.json) (`gözüyle`, `#0A0A0A`), [scripts/generate-icons.mjs](scripts/generate-icons.mjs) (ikonları ve `app/favicon.ico`'yu üretir) |
| Veritabanı | [supabase/migrations/](supabase/migrations/): 10 migration, sonuncusu `20260926180000_vehicle_photos_storage_limits.sql`; hepsi uzak veritabanında uygulanmış (son dördü 26 Eylül 2026'da `db push --linked` ile) |
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
- **`/api/reports` istek sınırı (`4e1e2a4`):**
  - Aynı IP'den 60 saniyede en fazla 5 istek. Aşılırsa `429`, `Retry-After` başlığı ve Türkçe mesaj döner.
  - Sınır her şeyden önce uygulanır: geçersiz istekler de sayılır ve veritabanına gidilmez.
  - IP, `x-real-ip` başlığından alınır, yoksa `x-forwarded-for`'daki ilk adresten.
  - Sayaç bellekte ve **sunucu örneği başına** tutulur. Canlıda 30 istekte 5 × 400 ve ardından 25 × 429 alındı. Deploy'dan hemen sonraki ilk 8 istekte 429 gelmemişti.
- **Moderasyon paneli (`614476d`):** `/admin/reports` bildirilen ilanları listeler. "Kaldır" ilanı `rejected` yapar ve ilanın tüm açık bildirimlerini kapatır; "Yoksay" yalnızca bildirimleri kapatır. `rejected` durumuna girmek de çıkmak da yalnızca sunucudan yapılır (`trg_vehicles_guard_moderated_status`). Migration'ları artık uygulandı.
- **İlan yazma kurallarındaki üç açık kapatıldı (`270d328`, migration `20260926170000_harden_listing_rls.sql`):**
  1. **Durum atlatma:** satıcı `set_vehicle_status`'u atlayıp tabloya doğrudan yazarak (tablo yetkisi + yalnızca sahipliğe bakan `vehicles_update_own`) örneğin satılmış ilanı yeniden yayına alabiliyordu. Artık kullanıcı isteklerinde durum yalnızca geçiş tablosuna göre değişiyor. Yeni ilan yalnızca `draft`/`pending_video` açılıyor; servis anahtarı ve yönetici etkilenmiyor.
  2. **Fotoğraf adresi:** adres denetimi olmayan `vehicle_images_insert_own` politikası, OR ile birleştiği için katı politikayı etkisiz bırakıyordu. Katı politikanın `%/vehicle-images/...` deseni de her sunucuyu kabul ediyordu ve kullanılmayan bucket'ı tarif ediyordu. UPDATE politikası aynı açığa sahipti. Artık yalnızca uygulamanın `getPublicUrl` ile ürettiği adres geçiyor. Migration, adres denetimi olmayan bir yazma politikası kalırsa ya da mevcut bir satır kurala uymazsa hiçbir şey uygulamadan duruyor.
  3. **Videosuz yayın:** videosu işlenmemiş ilan `pending_video → archived → active` yoluyla yalnızca fotoğrafla yayına alınabiliyordu. Artık yayın için işlenmiş video şart. "İlanlarım"da videosu hazır olmayan ilanın "Yayına al" butonu gizli ve nedeni yazıyor.
  - Kanıt: 84 yeni test (82'si [lib/listing-rls.test.ts](lib/listing-rls.test.ts)'te). Düzeltmeler olmadan çalıştırılan kontrolde ilk iki açık için 35, video kuralı için 9 test başarısız oldu. Uzak veritabanında tetikleyiciler, politikalar ve fonksiyon tanımları sorguyla doğrulandı.

## 4. Git ve dağıtım durumu

- Son commit "feat: restrict vehicle photo uploads to owners and image types" (Storage sınırları; bu dosya da aynı commit'te güncellendi). Güncel `HEAD` için `git log -1` kullanın.
- `origin/main`'e push edilen her commit'in production deploy'unu GitHub entegrasyonu başlatıyor. Durumu görmek için: `npx vercel ls elan-app`.
- Veritabanı kodla uyumlu: 10 migration'ın hepsi uzak veritabanında uygulanmış durumda (`npx supabase migration list --linked` ile kontrol edilebilir).
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

1. **Supabase → URL Configuration:** Site URL `https://gozuyle.com` olmalı; Redirect URLs'te `https://gozuyle.com/**` bulunmalı (`/auth/callback`'i kapsar). Bu doğrulanmadı ve Google girişi buna bağlı.
2. **Uçtan uca testler** (Claude giriş yapamadığı için denenmedi): Google girişi, oturum açıkken avatar, hesap silme (DB + `vehicle-photos` + Cloudflare temizliği), moderasyon paneli, fotoğraflı ilan verme (JPEG/PNG/WebP yüklenmeli; GIF ya da 10 MB üstü dosyada Türkçe hata çıkmalı; iPhone'dan seçilen fotoğraf JPEG olarak gitmeli). Bir de "İlanlarım"da videosu hazır olmayan arşivlenmiş ilan: "Yayına al" gizli olmalı ve açıklama görünmeli.
3. ✅ **`www.gozuyle.com`: tamamlandı (26 Eylül 2026).**
   - Sorun DNS'te değildi: CNAME kaydı (`cname.vercel-dns.com`) zaten doğruydu. `www` Vercel projesine eklenmediği için yalnızca `gozuyle.com` için sertifika vardı.
   - Dashboard'dan eklendi ve 308 ile `gozuyle.com`'a yönlendirildi.
   - Doğrulama: Let's Encrypt sertifikası (SAN `www.gozuyle.com`), `https://www.gozuyle.com/` → `308` + `Location: https://gozuyle.com/`. Yol ve sorgu korunuyor; `http://www` iki adımda `https://gozuyle.com/`'a (200) varıyor.
4. **`destek@gozuyle.com`:** gerçek bir posta kutusu ya da yönlendirme kurulmalı, ya da `NEXT_PUBLIC_SUPPORT_EMAIL` tanımlanmalı. Adres gizlilik politikasında yayında.
5. **Vercel'deki fazla kayıt:** Preview'a ait eski `CLOUDFLARE_STREAM_WEBHOOK_SECRET` kaydı (id `TZ5cSerrSmMsQUac`) silinmeli. API ile silme izin denetimine takılmıştı.
6. **Play Store (TWA):** `/.well-known/assetlinks.json` gerekiyor; bunun için imzalama sertifikasının SHA-256 parmak izi lazım.
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

- `/api/reports` için kalıcı istek sınırı: koddaki sınır sunucu örneği başına çalışıyor. Kesin bir sınır için Vercel Firewall kuralı gerekiyor.
- Mobil operatörlerde birçok kullanıcı aynı IP'yi paylaşabilir; bu kullanıcılar dakikada 5 bildirim hakkını da paylaşır. Trafik artarsa sınır gözden geçirilmeli.
- Yasal metinler şablon; hukuki inceleme gerekiyor.
- Google onay ekranında `supabase.co` alan adı görünebilir; istenirse Supabase'e özel alan adı bağlanabilir. Bağlanırsa `fn_is_vehicle_photo_url`'deki sabit proje adresi de yeni bir migration'la güncellenmeli; güncellenmezse yeni fotoğraf eklemeleri reddedilir.

## Çalışma notları ve tuzaklar

- **Görsel doğrulama** üretim derlemesiyle yapılmalı: `npm run build`, ardından `.claude/launch.json` → `elan-prod` (port 3100). `next dev` yeni Tailwind sınıflarını bazen geç üretiyor.
- **Bayat tip çıktısı:** geliştirme sunucusu açıkken bir sayfa silinirse build düşer; önce `rm -rf .next/dev`.
- **`vercel link`:** `.gitignore`'a tekrar eden satırlar ekliyor (bunlar `.env.example` istisnasını bozuyor) ve `.env.local`'e `VERCEL_OIDC_TOKEN` yazıyor. `.gitignore` geri alınmalı; bu token Vercel'e aktarılmamalı.
- **Gizli değerler** asla sohbete yazdırılmaz; yalnızca stdin ile aktarılır, adları ya da maskeli başları gösterilir.
- **Tarayıcı paneli** ekranda çizilmediğinde ekran görüntüsü ve koordinatlı tıklama hatalı oluyor; ölçüm ve tıklama JavaScript ile yapılmalı.
- **Kontrol komutları:** `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint`, `npm run build`.
- **Claude worktree'leri** repo içinde, `.claude/worktrees/` altında durur.
  - Biri varken ana dizinde çalışan `vitest` ve `eslint` onun dosyalarını da tarar: test sayısı iki katına çıkar, worktree'deki `.next` yüzünden eslint hata verir. Kontroller worktree kaldırıldıktan sonra ya da worktree'nin içinde çalıştırılmalı.
  - Worktree'de `node_modules` ve Supabase bağlantısı olmaz: `npm install` gerekir, `supabase/.temp/` ana dizinden kopyalanabilir (gitignore'da). `tsc`'den önce `npx next typegen` çalıştırılmalı.
- **Migration'larda `storage.objects` politikası** oluşturulamaz ya da silinemez (sahibi `supabase_storage_admin`); `storage.buckets` satırları güncellenebilir.
