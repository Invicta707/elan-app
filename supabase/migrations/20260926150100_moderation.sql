-- Moderasyon paneli (/admin/reports, app/api/admin/reports).
--
-- Panel bildirimleri ve ilan durumunu servis anahtarıyla yazar; yetki
-- denetimi API'dedir (ADMIN_EMAILS). Tarayıcıdan reports'a erişim yine yok.

-- 1) Bildirimi kimin, ne zaman kapattığı. status: 'reviewed' = ilan
-- kaldırıldı, 'dismissed' = bildirim yoksayıldı (bkz. *_reports.sql).
alter table public.reports
  add column resolved_at timestamptz,
  add column resolved_by uuid references auth.users(id) on delete set null;

-- 2) Moderasyon kararını satıcıya karşı koru.
--
-- vehicles_update_own politikası satıcının kendi satırını doğrudan tabloya
-- yazarak güncellemesine izin veriyor. Bu tetikleyici olmasa satıcı,
-- moderasyonun kaldırdığı ('rejected') ilanını tek istekle yeniden 'active'
-- yapabilirdi. Kural: 'rejected' durumuna girmek de çıkmak da yalnızca
-- sunucudan (servis anahtarı ya da veritabanı yöneticisi) yapılır.
--
-- İsteği yapanın rolü JWT'den okunur (current_user değil): security definer
-- fonksiyonlar içinden gelen güncellemeler de kullanıcının isteği sayılır.
create or replace function public.fn_guard_moderated_status()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'rejected' and new.status is distinct from old.status then
    raise exception 'Bu ilan moderasyon tarafından yayından kaldırıldı; durumu değiştirilemez.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status = 'rejected' and (tg_op = 'INSERT' or old.status is distinct from 'rejected') then
    raise exception 'İlan bu duruma getirilemez.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$function$;

create trigger trg_vehicles_guard_moderated_status
  before insert or update of status on public.vehicles
  for each row execute function public.fn_guard_moderated_status();
