-- İçerik denetimi kaydına "denetlenemeyenler": hangi görsel, hangi hata.
--
-- Neden: 27 Eylül 2026'da üç ilan "Otomatik denetim yapılamadı"
-- (review:unavailable) ile yönetici kuyruğuna düştü. Nedeni yalnızca Vercel
-- loguna yazılıyordu; Hobby planda loglar ~1 saat tutulduğu için sonradan
-- okunamadı. (Neden bulundu: Cloudflare'in zamansız kapak adresi "ready"
-- webhook'undan sonra ~30 sn daha 404 veriyordu; bkz. lib/content-moderation.ts
-- coverFrameUrl.) Artık neden kararla birlikte saklanıyor, örneğin:
--   'kapak: sightengine 400 media_error: Could not download media. …'
-- İçeriğin kendisi ya da adresi yazılmaz; yalnızca görselin adı ("kapak",
-- "kare 8 sn", "fotoğraf 2") ve sağlayıcının hata metni.
--
-- Yalnızca sütun eklenir; tablonun yetkileri (RLS açık, politika yok, yalnızca
-- servis anahtarı) değişmez. Kod bu sütunu yalnızca dolu olduğunda yazar.

alter table public.content_moderation_events
  add column if not exists failures text[] not null default '{}';

alter table public.content_moderation_events
  drop constraint if exists content_moderation_events_failures_check;
alter table public.content_moderation_events
  add constraint content_moderation_events_failures_check
  check (cardinality(failures) <= 10);

comment on column public.content_moderation_events.failures is
  'Denetlenemeyen görseller ve nedeni (en fazla 10 satır); içerik ya da adres saklanmaz';
