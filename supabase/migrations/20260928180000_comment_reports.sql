-- Yorum şikayetleri (Google Play kullanıcı içeriği politikası).
--
-- Yorum penceresinde (akış) ve masaüstü yan panelde her yorum "Şikayet et" ile
-- bildirilebilir. Kayıt, ilan bildirimleriyle aynı tabloya gider: comment_id
-- dolu satır bir yorum şikayetidir. vehicle_id yorumun ilanıdır; aşağıdaki
-- tetikleyici onu yorumdan yazar (istemcinin gönderdiğine güvenilmez).
--
-- Erişim değişmedi: RLS açık, politika yok. /api/reports servis anahtarıyla
-- ekler (giriş yapmadan da; istek sınırı ilan bildirimleriyle ortak),
-- /api/admin/comment-reports yönetici paneline listeler ve karar verir.
--
-- Yorum silinince (yazarı, satıcı ya da yönetici) şikayetleri de silinir
-- (CASCADE): içerik artık kimseye görünmüyor. Yöneticinin silme kararı
-- content_moderation_events'e yazılır (subject_type = 'comment').
--
-- Neden listeleri lib/reports.ts'teki REPORT_REASONS (ilan) ve
-- COMMENT_REPORT_REASONS (yorum) ile aynı olmalı; lib/comment-reports.test.ts
-- karşılaştırır.

alter table public.reports
  add column comment_id uuid references public.vehicle_comments(id) on delete cascade;

-- Neden, bildirimin türüne göre (eski satırların hepsi ilan bildirimi)
alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (
  (comment_id is null and reason in ('fraud', 'wrong_info', 'inappropriate', 'spam', 'sold', 'other'))
  or (comment_id is not null and reason in ('harassment', 'hate', 'sexual', 'spam', 'fraud', 'other'))
);

-- Giriş yapmış kullanıcı aynı ilanı bir kez, aynı yorumu bir kez bildirir
-- (tekrarı API "zaten bildirildi" diye karşılar). Bir yorumu bildirmek, o
-- yorumun ilanını ya da aynı ilandaki başka bir yorumu bildirmeyi engellemez.
drop index public.reports_vehicle_reporter_key;
create unique index reports_vehicle_reporter_key
  on public.reports (vehicle_id, reporter_id)
  where reporter_id is not null and comment_id is null;
create unique index reports_comment_reporter_key
  on public.reports (comment_id, reporter_id)
  where reporter_id is not null and comment_id is not null;

-- Panelde yoruma göre gruplama ve yorum silinirken CASCADE
create index reports_comment_id_idx on public.reports (comment_id) where comment_id is not null;

-- Yorum şikayetinde ilan yorumdan okunur; kişi kendi yorumunu şikayet edemez
create or replace function public.fn_reports_comment_target()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_vehicle uuid;
  v_author uuid;
begin
  if new.comment_id is null then
    return new;
  end if;

  select c.vehicle_id, c.user_id into v_vehicle, v_author
    from public.vehicle_comments c
   where c.id = new.comment_id;
  if not found then
    raise exception 'Şikayet edilen yorum bulunamadı.'
      using errcode = 'foreign_key_violation';
  end if;
  if new.reporter_id is not null and new.reporter_id = v_author then
    raise exception 'Kendi yorumunu şikayet edemezsin.'
      using errcode = 'check_violation';
  end if;

  new.vehicle_id := v_vehicle;
  return new;
end;
$function$;

create trigger trg_reports_comment_target
  before insert or update of comment_id on public.reports
  for each row execute function public.fn_reports_comment_target();
