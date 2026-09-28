-- İlan izlenme sayacı (vehicles.views_count).
--
-- Kurallar:
--   * Sütun canlıda panelden kurulmuştu (integer not null default 0); yoksa
--     eklenir. Herkes (misafir dahil) yayındaki ilanın sayısını okur: kartta,
--     akışta ve Shorts oynatıcısında izlenme rozeti.
--   * İstemci sütuna doğrudan yazamaz: fn_guard_vehicle_counters (tablo
--     düzeyinde UPDATE yetkisi satıcılarda olduğu için tetikleyici; RLS sütun
--     kısıtlayamaz) her kullanıcı güncellemesinde sayaçları eski değerine
--     döndürür. INSERT her zaman sıfırla başlar.
--   * Sayaç yalnızca increment_vehicle_view(target_vehicle_id) ile artar:
--     security definer, yalnızca yayındaki ilanın sayacını tam olarak +1
--     yapar ve yeni sayıyı döner (ilan yoksa ya da yayında değilse null).
--     Koruma bu tek güncellemeye, işlem içi (set_config ..., true) bir
--     işaretle ve yalnızca hedef satır için izin verir; işaret PostgREST
--     üzerinden istemci tarafından kurulamaz (özel ayarlar yalnızca SQL ile).
--   * İzlenme updated_at'i yenilemez (ilanın düzenlenme zamanı değişmez).
--   * Aynı oturumda aynı ilanın tekrar sayılmaması istemcide (sessionStorage,
--     lib/vehicle-views.ts); fareyle önizleme hiç saymaz.

-- ---------------------------------------------------------------
-- 0) Sütun
-- ---------------------------------------------------------------

alter table public.vehicles add column if not exists views_count integer not null default 0;

-- ---------------------------------------------------------------
-- 1) Sayaç koruması yorum migration'ındaki gövdede mi?
-- ---------------------------------------------------------------
--
-- fn_guard_vehicle_counters son olarak 20260928160000_vehicle_comments.sql'de
-- yazıldı. Gövde beklenenden farklıysa (biri değiştirmişse) hiçbir şey uygulanmaz.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.fn_guard_vehicle_counters'::regproc) into v_def;
  if (position('new.comments_count := old.comments_count;' in v_def) = 0
      or position('new.views_count := old.views_count;' in v_def) = 0
      or position('pg_trigger_depth() <= 1' in v_def) = 0
      or position('new.updated_at := now();' in v_def) = 0)
     and position('gozuyle.view_increment' in v_def) = 0 then
    raise exception 'fn_guard_vehicle_counters beklenen gövdede değil; izlenme migration''ı uygulanmadı.';
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 2) Koruma: views_count için increment_vehicle_view'in dar geçidi
-- ---------------------------------------------------------------

create or replace function public.fn_guard_vehicle_counters()
 returns trigger
 language plpgsql
as $function$
begin
  if tg_op = 'INSERT' then
    -- Yeni ilan her zaman sıfır sayaçla başlar, client ne gönderirse göndersin
    new.likes_count := 0;
    new.views_count := 0;
    new.saves_count := 0;
    new.comments_count := 0;
    return new;

  elsif tg_op = 'UPDATE' then
    -- increment_vehicle_view: yalnızca işaretlenen satır, yalnızca views_count +1;
    -- diğer sayaçlar ve updated_at olduğu gibi kalır
    if coalesce(current_setting('gozuyle.view_increment', true), '') = new.id::text then
      new.likes_count := old.likes_count;
      new.saves_count := old.saves_count;
      new.comments_count := old.comments_count;
      new.views_count := old.views_count + 1;
      new.updated_at := old.updated_at;
      return new;
    end if;

    new.updated_at := now();
    if pg_trigger_depth() <= 1 then
      new.likes_count := old.likes_count;
      new.views_count := old.views_count;
      new.saves_count := old.saves_count;
      new.comments_count := old.comments_count;
    end if;
    return new;
  end if;

  return null;
end;
$function$;

-- ---------------------------------------------------------------
-- 3) Artırma
-- ---------------------------------------------------------------

create or replace function public.increment_vehicle_view(target_vehicle_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  if target_vehicle_id is null then
    return null;
  end if;

  perform set_config('gozuyle.view_increment', target_vehicle_id::text, true);
  update public.vehicles
     set views_count = views_count + 1
   where id = target_vehicle_id
     and status = 'active'
  returning views_count into v_count;
  perform set_config('gozuyle.view_increment', '', true);

  -- null: ilan yok ya da yayında değil (sayılmadı)
  return v_count;
end;
$function$;

revoke all on function public.increment_vehicle_view(uuid) from public;
grant execute on function public.increment_vehicle_view(uuid) to anon, authenticated, service_role;
