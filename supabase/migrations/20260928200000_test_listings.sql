-- Test (deneme) ilanları
--
-- Vitrin, filtreler ve vitrin penceresi (↑/↓) gerçek veriyle denenebilsin diye
-- yöneticinin hesabına açılan örnek ilanlar (scripts/seed-test-listings.mjs).
-- is_test = true olan ilan kartta, pencerede ve akışta "Test ilanı" etiketiyle
-- görünür; yönetim panelinde (Moderasyon → Test ilanları) tek düğmeyle videosu,
-- fotoğrafları ve bütün bağlı kayıtlarıyla (yorum, şikayet, sohbet: hepsi
-- CASCADE) silinir.
--
-- Bayrağı yalnızca sunucu yazar (servis anahtarı, veritabanı yöneticisi):
-- kullanıcı istekleri (JWT rolü ya da current_user anon/authenticated) yeni
-- ilanı test olarak açamaz, var olan ilanın bayrağını değiştiremez. Satıcıların
-- vehicles üzerinde tablo düzeyinde UPDATE yetkisi olduğu için kuralı
-- tetikleyici uygular (*_harden_listing_rls.sql'deki gibi).

alter table public.vehicles
  add column if not exists is_test boolean not null default false;

comment on column public.vehicles.is_test is
  'Deneme ilanı: "Test ilanı" etiketiyle görünür, yönetim panelinden topluca silinir. Yalnızca sunucu yazar.';

create or replace function public.fn_guard_vehicle_test_flag()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated')
     and current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.is_test then
      raise exception 'Test ilanını yalnızca yönetim açabilir.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.is_test is distinct from old.is_test then
    raise exception 'Test ilanı işaretini yalnızca yönetim değiştirebilir.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_vehicles_guard_test_flag on public.vehicles;
create trigger trg_vehicles_guard_test_flag
  before insert or update of is_test on public.vehicles
  for each row execute function public.fn_guard_vehicle_test_flag();

-- Yönetim panelindeki liste yalnızca test ilanlarını okur
create index if not exists idx_vehicles_is_test on public.vehicles (created_at desc) where is_test;
