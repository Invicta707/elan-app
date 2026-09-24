-- Fotoğraflar için tek tablo: public.vehicle_images.
--
-- /sell akışı fotoğrafları geçici olarak public.vehicle_photos'a (url,
-- order_index) yazıyordu; oysa şemanın asıl tablosu vehicle_images (image_url,
-- display_order, is_primary) ve search_vehicles'ın kapak fotoğrafı
-- (cover_image_url) ile fn_check_vehicle_publishable'ın "en az bir fotoğraf"
-- koşulu bu tabloyu okuyor. Veriler vehicle_images'a taşınır, vehicle_photos
-- kaldırılır; bu fonksiyonlara dokunmaya gerek kalmaz.
--
-- Tek transaction içinde çalışır (Supabase CLI ve SQL Editor ikisi de öyle
-- çalıştırır): bir adım hata verirse hiçbir değişiklik uygulanmaz.

-- 1) Güvenlik kontrolü: vehicle_photos'u hâlâ kullanan bir fonksiyon varsa dur.
do $$
declare
  photo_refs text;
  image_refs text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into photo_refs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ilike '%vehicle_photos%';

  if photo_refs is not null then
    raise exception 'vehicle_photos şu fonksiyonlarda hâlâ kullanılıyor: %. Önce bunları vehicle_images''a çevirin.', photo_refs;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
    into image_refs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ilike '%vehicle_images%';

  raise notice 'vehicle_images kullanan fonksiyonlar: %', coalesce(image_refs, '(yok)');
end $$;

-- 2) Verileri taşı. İlan başına en küçük order_index kapak (is_primary) olur;
-- ilanın vehicle_images'ta zaten bir kapağı ya da sırası varsa korunur ve yeni
-- fotoğraflar sonuna eklenir. Aynı URL tekrar eklenmez, silinmiş ilanlara ait
-- satırlar atlanır.
insert into public.vehicle_images (vehicle_id, image_url, display_order, is_primary, created_at)
select
  ranked.vehicle_id,
  ranked.url,
  coalesce(existing.max_order + 1, 0) + ranked.rn - 1,
  coalesce(existing.has_primary, false) = false and ranked.rn = 1,
  ranked.created_at
from (
  select
    p.vehicle_id,
    p.url,
    p.created_at,
    row_number() over (partition by p.vehicle_id order by p.order_index, p.created_at) as rn
  from public.vehicle_photos p
  where exists (select 1 from public.vehicles v where v.id = p.vehicle_id)
    and not exists (
      select 1 from public.vehicle_images i
       where i.vehicle_id = p.vehicle_id and i.image_url = p.url
    )
) ranked
left join (
  select vehicle_id, max(display_order) as max_order, bool_or(is_primary) as has_primary
    from public.vehicle_images
   group by vehicle_id
) existing on existing.vehicle_id = ranked.vehicle_id;

-- 3) Erişim kuralları. Mevcut politikalara eklenir (politikalar OR ile
-- birleşir), onları değiştirmez:
--    - herkes yayındaki ilanların, satıcı da kendi ilanlarının fotoğraflarını görür
--      (detay çekmecesi: lib/feed.ts fetchVehicleDetails)
--    - satıcı sadece kendi ilanına fotoğraf ekler (app/sell/page.tsx)
alter table public.vehicle_images enable row level security;

drop policy if exists vehicle_images_select_visible on public.vehicle_images;
create policy vehicle_images_select_visible
  on public.vehicle_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and (v.status = 'active' or v.seller_id = auth.uid())
    )
  );

drop policy if exists vehicle_images_insert_own on public.vehicle_images;
create policy vehicle_images_insert_own
  on public.vehicle_images
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and v.seller_id = auth.uid()
    )
  );

-- 4) Eski tabloyu kaldır. CASCADE yok: ona bağlı bir view vs. kalmışsa
-- migration burada durur ve hiçbir şey uygulanmaz.
drop table public.vehicle_photos;
