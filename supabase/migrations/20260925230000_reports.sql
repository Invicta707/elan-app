-- İlan bildirimleri (kullanıcı içeriği moderasyonu).
--
-- Kullanıcılar uygunsuz, sahte ya da yanıltıcı ilanları uygulama içinden
-- bildirir (Google Play kullanıcı içeriği politikası bunu zorunlu tutar).
-- Kayıtlar sadece sunucudan yazılır ve okunur: /api/reports servis
-- anahtarıyla ekler, moderasyon Supabase panelinden yapılır. Bu yüzden RLS
-- açık ve anon/authenticated için hiçbir politika yok: tarayıcıdan ne okuma
-- ne yazma yapılabilir, bildiren kişinin kimliği satıcıya sızmaz.
--
-- Neden listesi lib/reports.ts'teki REPORT_REASONS ile aynı olmalı
-- (lib/reports.test.ts ikisini karşılaştırır).

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id) on delete cascade,
  -- Giriş yapmadan da bildirilebilir; hesap silinirse bildirim kalır
  reporter_id uuid references public.users(id) on delete set null,
  reason      text not null
              check (reason in ('fraud', 'wrong_info', 'inappropriate', 'spam', 'sold', 'other')),
  details     text check (details is null or char_length(details) <= 500),
  -- open: incelenmedi, reviewed: işlem yapıldı, dismissed: geçersiz bulundu
  status      text not null default 'open'
              check (status in ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz not null default now()
);

-- Giriş yapmış kullanıcı aynı ilanı bir kez bildirir (tekrarı API "zaten
-- bildirildi" diye karşılar)
create unique index reports_vehicle_reporter_key
  on public.reports (vehicle_id, reporter_id)
  where reporter_id is not null;

-- Moderasyon kuyruğu: açık bildirimler, en eskisi önce
create index reports_status_created_idx on public.reports (status, created_at);
create index reports_vehicle_id_idx on public.reports (vehicle_id);

alter table public.reports enable row level security;
