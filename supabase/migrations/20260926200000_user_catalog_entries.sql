-- Kullanıcının yazdığı marka/model (/sell'deki aramalı seçim kutusu).
--
-- vehicles.brand_id / model_id katalog tablolarına bağlı ve zorunlu. Listede
-- olmayan bir ad yazıldığında ilana metin olarak yazılmaz. Kataloğa "kullanıcı
-- ekledi" işaretli bir satır eklenir ya da aynı adlı mevcut satır bulunur;
-- böylece arama, akış, ilan sayfası ve moderasyon aynı sorgularla çalışır.
--
--   * Aynı ad tek kayıttır: büyük/küçük harf, Türkçe/aksanlı harf, boşluk ve
--     noktalama önemsiz (fn_catalog_key; benzersiz indeksler bunu zorlar).
--   * Kullanıcı ekledikleri ortak listeye (arama filtreleri) girmez:
--     lib/search.ts fetchCatalog is_user_created = false olanları okur.
--     İlanın kendisinde adıyla görünür (okuma politikaları değişmedi).
--   * Kataloğa doğrudan yazılamaz (INSERT politikası yok); ekleme yalnızca
--     resolve_listing_catalog ile: giriş şart, ad denetlenir, günlük sınır var.
--
-- Anahtar ve ad kuralları lib/catalog-search.ts ile aynıdır
-- (lib/catalog-rls.test.ts ikisini karşılaştırır).

-- 1) Kim, ne zaman ekledi
alter table public.brands
  add column is_user_created boolean not null default false,
  add column created_by uuid references auth.users(id) on delete set null;

alter table public.models
  add column is_user_created boolean not null default false,
  add column created_by uuid references auth.users(id) on delete set null;

-- 2) Karşılaştırma anahtarı ve ad kuralı
create or replace function public.fn_catalog_key(p_name text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select regexp_replace(
    lower(translate(
      p_name,
      'ÇĞİIÖŞÜÂÊÎÔÛËÉÈÄÅÁÀÍÌÓÒÚÙÑŠŽČŘÝçğıöşüâêîôûëéèäåáàíìóòúùñšžčřý',
      'CGIIOSUAEIOUEEEAAAAIIOOUUNSZCRYcgiosuaeioueeeaaaaiioouunszcry'
    )),
    '[^a-z0-9]', '', 'g'
  );
$function$;

-- Boşlukları sadeleştirir; ad kurala uymuyorsa hata verir
create or replace function public.fn_clean_catalog_name(p_name text, p_max_length integer)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if v_name = '' then
    raise exception 'Marka ve model adı boş olamaz.' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > p_max_length then
    raise exception 'Ad en fazla % karakter olabilir.', p_max_length using errcode = 'check_violation';
  end if;
  if v_name !~ '^[A-Za-z0-9ÇĞİIÖŞÜÂÊÎÔÛËÉÈÄÅÁÀÍÌÓÒÚÙÑŠŽČŘÝçğıöşüâêîôûëéèäåáàíìóòúùñšžčřý][A-Za-z0-9ÇĞİIÖŞÜÂÊÎÔÛËÉÈÄÅÁÀÍÌÓÒÚÙÑŠŽČŘÝçğıöşüâêîôûëéèäåáàíìóòúùñšžčřý .\-/+&'']*$'
     or v_name !~ '[A-Za-z0-9]' then
    raise exception 'Adda yalnızca harf, rakam, boşluk ve - . / + & '' kullanılabilir.' using errcode = 'check_violation';
  end if;
  return v_name;
end;
$function$;

-- 3) Aynı anahtarlı ikinci kayıt olamaz (eşzamanlı eklemelerde de)
create unique index brands_catalog_key_idx on public.brands (public.fn_catalog_key(name));
create unique index models_catalog_key_idx on public.models (brand_id, public.fn_catalog_key(name));

-- 4) Marka/modeli id'yle doğrular ya da adla bulur/ekler; ilanın yazacağı id'leri döner
create or replace function public.resolve_listing_catalog(
  p_brand_id   uuid,
  p_brand_name text,
  p_model_id   uuid,
  p_model_name text
)
returns table (brand_id uuid, model_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_brand   uuid;
  v_model   uuid;
  v_name    text;
  v_slug    text;
  v_created integer;
begin
  if v_uid is null then
    raise exception 'Bu işlem için giriş yapmalısın.' using errcode = 'insufficient_privilege';
  end if;

  -- Günlük sınır: kullanıcı başına 24 saatte en fazla 10 yeni marka/model
  select (select count(*) from public.brands b where b.created_by = v_uid and b.created_at > now() - interval '1 day')
       + (select count(*) from public.models m where m.created_by = v_uid and m.created_at > now() - interval '1 day')
    into v_created;

  -- Marka
  if p_brand_id is not null then
    select b.id into v_brand from public.brands b where b.id = p_brand_id;
    if v_brand is null then
      raise exception 'Marka bulunamadı.' using errcode = 'no_data_found';
    end if;
  else
    v_name := public.fn_clean_catalog_name(p_brand_name, 40);
    select b.id into v_brand from public.brands b where public.fn_catalog_key(b.name) = public.fn_catalog_key(v_name);

    if v_brand is null then
      if v_created >= 10 then
        raise exception 'Bugün yeterince yeni marka/model ekledin; listeden seç ya da yarın tekrar dene.'
          using errcode = 'check_violation';
      end if;
      -- Slug anahtardan; başka bir adın slug'ıyla çakışırsa kısa bir ek alır
      v_slug := trim(both '-' from regexp_replace(lower(translate(v_name,
        'ÇĞİIÖŞÜÂÊÎÔÛËÉÈÄÅÁÀÍÌÓÒÚÙÑŠŽČŘÝçğıöşüâêîôûëéèäåáàíìóòúùñšžčřý',
        'CGIIOSUAEIOUEEEAAAAIIOOUUNSZCRYcgiosuaeioueeeaaaaiioouunszcry')), '[^a-z0-9]+', '-', 'g'));
      for attempt in 1 .. 3 loop
        insert into public.brands (name, slug, is_user_created, created_by)
        values (v_name, case when attempt = 1 then v_slug else v_slug || '-' || substr(md5(random()::text), 1, 4) end, true, v_uid)
        on conflict do nothing
        returning id into v_brand;
        exit when v_brand is not null;
        -- Aynı anda aynı adı ekleyen biri olduysa onu kullan
        select b.id into v_brand from public.brands b where public.fn_catalog_key(b.name) = public.fn_catalog_key(v_name);
        exit when v_brand is not null;
      end loop;
      if v_brand is null then
        raise exception 'Marka kaydedilemedi.' using errcode = 'unique_violation';
      end if;
      v_created := v_created + 1;
    end if;
  end if;

  -- Model (seçilen markaya ait olmalı)
  if p_model_id is not null then
    select m.id into v_model from public.models m where m.id = p_model_id and m.brand_id = v_brand;
    if v_model is null then
      raise exception 'Model bu markaya ait değil.' using errcode = 'check_violation';
    end if;
  else
    v_name := public.fn_clean_catalog_name(p_model_name, 60);
    select m.id into v_model
      from public.models m
     where m.brand_id = v_brand and public.fn_catalog_key(m.name) = public.fn_catalog_key(v_name);

    if v_model is null then
      if v_created >= 10 then
        raise exception 'Bugün yeterince yeni marka/model ekledin; listeden seç ya da yarın tekrar dene.'
          using errcode = 'check_violation';
      end if;
      v_slug := trim(both '-' from regexp_replace(lower(translate(v_name,
        'ÇĞİIÖŞÜÂÊÎÔÛËÉÈÄÅÁÀÍÌÓÒÚÙÑŠŽČŘÝçğıöşüâêîôûëéèäåáàíìóòúùñšžčřý',
        'CGIIOSUAEIOUEEEAAAAIIOOUUNSZCRYcgiosuaeioueeeaaaaiioouunszcry')), '[^a-z0-9]+', '-', 'g'));
      for attempt in 1 .. 3 loop
        insert into public.models (brand_id, name, slug, is_user_created, created_by)
        values (v_brand, v_name, case when attempt = 1 then v_slug else v_slug || '-' || substr(md5(random()::text), 1, 4) end, true, v_uid)
        on conflict do nothing
        returning id into v_model;
        exit when v_model is not null;
        select m.id into v_model
          from public.models m
         where m.brand_id = v_brand and public.fn_catalog_key(m.name) = public.fn_catalog_key(v_name);
        exit when v_model is not null;
      end loop;
      if v_model is null then
        raise exception 'Model kaydedilemedi.' using errcode = 'unique_violation';
      end if;
    end if;
  end if;

  return query select v_brand, v_model;
end;
$function$;

revoke execute on function public.resolve_listing_catalog(uuid, text, uuid, text) from public, anon;
grant execute on function public.resolve_listing_catalog(uuid, text, uuid, text) to authenticated;
