-- search_vehicles'a yıl, kilometre, yakıt, vites, kasa, ağır hasar filtreleri
-- ve sıralama eklenir. Yeni parametrelerin hepsi varsayılanlı ve sonda: eski 8
-- parametreyle yapılan çağrılar aynen çalışır. Kapak/video seçimi, şehir
-- eşleştirmesi (fn_normalize_tr), "medyasız ilan listelenmez" kuralı ve 50
-- satır sınırı değişmez.
--
-- CREATE OR REPLACE farklı imzada yeni bir overload açardı ve PostgREST aynı
-- isimli iki fonksiyon arasında seçim yapamazdı; bu yüzden eskisi aynı
-- transaction içinde kaldırılıp yenisi oluşturulur.

drop function public.search_vehicles(uuid, uuid, numeric, numeric, text, boolean, integer, integer);

create function public.search_vehicles(
  p_brand_id uuid default null,
  p_model_id uuid default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_city text default null,
  p_has_video_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0,
  p_min_year integer default null,
  p_max_year integer default null,
  p_max_mileage integer default null,
  p_fuel_types public.fuel_type[] default null,
  p_transmissions public.transmission_type[] default null,
  p_body_types public.body_type[] default null,
  p_hide_heavy_damage boolean default false,
  -- 'newest' | 'price_asc' | 'price_desc' | 'mileage_asc'; bilinmeyen değer = newest
  p_sort text default 'newest'
)
 returns table(id uuid, brand_id uuid, brand_name text, model_id uuid, model_name text, year integer, price numeric, currency text, mileage_km integer, fuel_type fuel_type, transmission transmission_type, body_type body_type, color text, city text, tramer_amount numeric, has_heavy_damage boolean, painted_parts_count integer, changed_parts_count integer, likes_count integer, views_count integer, saves_count integer, created_at timestamp with time zone, cover_image_url text, video_hls_url text, video_thumbnail_url text, video_status video_status)
 language plpgsql
 stable security definer
 set search_path to 'public'
 set plan_cache_mode to 'force_custom_plan'
as $function$
#variable_conflict use_column
declare
  v_city text := public.fn_normalize_tr(p_city);
begin
  return query
  select
    v.id,
    v.brand_id,
    b.name,
    v.model_id,
    m.name,
    v.year,
    v.price,
    v.currency,
    v.mileage_km,
    v.fuel_type,
    v.transmission,
    v.body_type,
    v.color,
    v.city,
    v.tramer_amount,
    v.has_heavy_damage,
    v.painted_parts_count,
    v.changed_parts_count,
    v.likes_count,
    v.views_count,
    v.saves_count,
    v.created_at,
    img.image_url,
    vid.hls_url,
    vid.thumbnail_url,
    vid.status
  from public.vehicles v
  join public.brands b on b.id = v.brand_id
  join public.models m on m.id = v.model_id
  -- Kapak: is_primary olan, yoksa sıradaki ilk fotoğraf
  left join lateral (
    select i.image_url
      from public.vehicle_images i
     where i.vehicle_id = v.id
     order by i.is_primary desc, i.display_order, i.created_at
     limit 1
  ) img on true
  -- Video: oynatılabilir (ready) olan önce; yoksa işlenen/başarısız
  -- videonun durumu döner (hls_url null)
  left join lateral (
    select x.hls_url, x.thumbnail_url, x.status
      from public.videos x
     where x.vehicle_id = v.id
     order by (x.status = 'ready' and x.hls_url is not null) desc, x.order_index, x.created_at
     limit 1
  ) vid on true
  where v.status = 'active'
    and (p_brand_id  is null or v.brand_id = p_brand_id)
    and (p_model_id  is null or v.model_id = p_model_id)
    and (p_min_price is null or v.price >= p_min_price)
    and (p_max_price is null or v.price <= p_max_price)
    and (v_city      is null or public.fn_normalize_tr(v.city) = v_city)
    and (not coalesce(p_has_video_only, false)
         or (vid.status = 'ready' and vid.hls_url is not null))
    and (p_min_year    is null or v.year >= p_min_year)
    and (p_max_year    is null or v.year <= p_max_year)
    and (p_max_mileage is null or v.mileage_km <= p_max_mileage)
    -- Boş liste de "filtre yok" sayılır
    and (coalesce(cardinality(p_fuel_types), 0) = 0    or v.fuel_type = any(p_fuel_types))
    and (coalesce(cardinality(p_transmissions), 0) = 0 or v.transmission = any(p_transmissions))
    and (coalesce(cardinality(p_body_types), 0) = 0    or v.body_type = any(p_body_types))
    and (not coalesce(p_hide_heavy_damage, false) or not v.has_heavy_damage)
    -- Yayındayken tüm medyası silinmiş ilanlar listelenmez
    and (img.image_url is not null
         or (vid.status = 'ready' and vid.hls_url is not null))
  -- Seçilen sıradan sonra created_at/id: eşit fiyat/km'de offset sayfalaması
  -- ilan atlamaz ya da tekrarlamaz
  order by
    case when p_sort = 'price_asc'   then v.price end asc,
    case when p_sort = 'price_desc'  then v.price end desc,
    case when p_sort = 'mileage_asc' then v.mileage_km end asc,
    v.created_at desc,
    v.id desc
  limit  least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

grant execute on function public.search_vehicles(
  uuid, uuid, numeric, numeric, text, boolean, integer, integer,
  integer, integer, integer, public.fuel_type[], public.transmission_type[], public.body_type[],
  boolean, text
) to anon, authenticated;
