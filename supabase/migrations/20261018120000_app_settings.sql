-- Uygulama ayarları (anahtar → JSON değer)
--
-- İlk kullanım: /cansu-kamil kapatma düğmesi (kill-switch). Yönetici
-- /cansu-kamil?admin=kamil'de "Sayfayı Kapat / 404 Yap"a basınca
-- POST /api/admin/cansu-kamil şu satırı yazar:
--   key = 'cansu_kamil_disabled', value = true
-- Sayfa her istekte bu satırı okur; true ise notFound() (404) döner.
-- Yeniden açmak için: update public.app_settings set value = 'false'
--   where key = 'cansu_kamil_disabled';  (ya da satırı silin)
--
-- Yalnızca sunucu okur ve yazar (servis anahtarı). RLS açık ve politika yok;
-- ayrıca anon/authenticated yetkileri geri alınır: tarayıcıdan okunamaz,
-- yazılamaz.

create table if not exists public.app_settings (
  key text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.app_settings is
  'Uygulama ayarları (ör. cansu_kamil_disabled). Yalnızca sunucu (servis anahtarı) okur/yazar.';

alter table public.app_settings enable row level security;

revoke all on table public.app_settings from anon, authenticated;
grant select, insert, update, delete on table public.app_settings to service_role;
