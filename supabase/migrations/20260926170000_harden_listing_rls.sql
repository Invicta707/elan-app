-- İlan yazma kurallarındaki üç açığı kapatır. Tek transaction: bir adım (ya da
-- sondaki denetim) başarısız olursa hiçbir şey uygulanmaz.
--
--   1) vehicles.status: satıcı set_vehicle_status'u atlayıp durumu tabloya
--      doğrudan yazabiliyordu (ör. 'sold' ilanı yeniden 'active' yapmak).
--   2) vehicle_images.image_url: satıcı kendi ilanına herhangi bir adresteki
--      görseli ekleyebiliyordu.
--   3) Yayın şartı: videosu işlenmemiş ilan, pending_video → archived → active
--      yoluyla yalnızca fotoğrafla yayına alınabiliyordu.

-- ---------------------------------------------------------------
-- 1) vehicles: durum geçişleri
-- ---------------------------------------------------------------
--
-- anon ve authenticated rollerinin vehicles üzerinde tablo düzeyinde
-- INSERT/UPDATE yetkisi var ve vehicles_update_own yalnızca sahipliği
-- denetliyor; yani tek istek yetiyordu:
--   supabase.from('vehicles').update({ status: 'active' }).eq('id', ...)
--
-- Kural (yalnızca kullanıcı isteklerinde):
--   * UPDATE: durum yalnızca set_vehicle_status'taki tabloya göre değişebilir;
--     durumu değişmeyen güncellemeler serbesttir.
--   * INSERT: yeni ilan yalnızca 'draft' (kolonun varsayılanı) ya da
--     'pending_video' (app/sell/page.tsx) ile açılır. 'active' zaten
--     fn_check_vehicle_publishable'a takılıyordu; 'sold'/'archived' açılamaz.
--
-- Kullanıcı isteği = JWT rolü anon/authenticated (security definer fonksiyonlar
-- içinden gelen güncellemeler de sayılır; set_vehicle_status aynı tabloyla
-- geçer) ya da JWT'siz bir istekte current_user anon/authenticated. Sunucu
-- yolları kısıtlanmaz: servis anahtarı (lib/video-activation.ts
-- draft/pending_video → active; moderasyon → 'rejected') ve veritabanı yöneticisi.
--
-- Neden sütun yetkisini geri almıyoruz: tablo düzeyindeki UPDATE yetkisi tüm
-- sütunları kapsar, "revoke update (status)" onu kaldırmaz. Tablo yetkisini
-- alıp diğer sütunları tek tek vermek gerekirdi; yeni eklenen her sütun sessizce
-- yazılamaz hâle gelirdi.
--
-- Geçiş tablosu set_vehicle_status (20260925150000_set_vehicle_status_rpc.sql)
-- ve lib/listing-status.ts OWNER_TRANSITIONS ile aynı olmalı;
-- lib/listing-status.test.ts üçünü karşılaştırır.
--
-- 'rejected' için trg_vehicles_guard_moderated_status (*_moderation.sql) daha
-- açıklayıcı bir hata verir. Aynı olaydaki BEFORE tetikleyicileri ada göre
-- sırayla çalıştığı için o, bu tetikleyiciden önce çalışır.

create or replace function public.fn_guard_owner_status_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_allowed public.vehicle_status[];
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated')
     and current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_video') then
      raise exception 'Yeni ilan bu durumla oluşturulamaz.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'active'        then array['sold', 'archived']::public.vehicle_status[]
    when 'archived'      then array['active', 'sold']::public.vehicle_status[]
    when 'draft'         then array['archived']::public.vehicle_status[]
    when 'pending_video' then array['archived']::public.vehicle_status[]
    else array[]::public.vehicle_status[]
  end;

  if not (new.status = any(v_allowed)) then
    raise exception 'Bu ilanın durumu bu şekilde değiştirilemez.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger trg_vehicles_guard_owner_status
  before insert or update of status on public.vehicles
  for each row execute function public.fn_guard_owner_status_transition();

-- ---------------------------------------------------------------
-- 3) Yayın şartı: işlenmiş video
-- ---------------------------------------------------------------
--
-- fn_check_vehicle_publishable 'active'e geçişte "en az bir fotoğraf ya da
-- işlenmiş bir video" arıyordu. set_vehicle_status pending_video → archived ve
-- archived → active geçişlerine izin verdiği için satıcı, videosu Cloudflare'de
-- henüz işlenmemiş ilanı yalnızca fotoğrafla yayına alabiliyordu.
--
-- Artık ilan, isteği kim yaparsa yapsın (satıcı, servis anahtarı, yönetici),
-- yalnızca işlenmiş bir videosu varsa 'active' olur: videos.status = 'ready' ve
-- hls_url dolu (lib/my-listings.ts hasPlayableVideo ile aynı koşul). Fotoğraf
-- isteğe bağlıdır. Video hazır olunca lib/video-activation.ts ilanı zaten bu
-- sırayla (önce video 'ready', sonra ilan 'active') yayına alır.
--
-- Satıcı videoyu kendisi "hazır" gösteremez: videos'ta RLS açık ve kullanıcılar
-- için INSERT/UPDATE politikası yok; satırları yalnızca sunucu (servis
-- anahtarı: app/api/upload/video, Cloudflare webhook) yazar.
--
-- trg_vehicles_check_publishable (when new.status = 'active') aynen kalır;
-- yalnızca fonksiyon değişir.

create or replace function public.fn_check_vehicle_publishable()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new; -- zaten yayında; sadece yayına geçiş anı denetlenir
  end if;

  if not exists (
       select 1 from public.videos x
        where x.vehicle_id = new.id
          and x.status = 'ready'
          and x.hls_url is not null
     ) then
    raise exception 'İlan yayınlanamadı: videosu henüz işlenmedi. Video hazır olduktan sonra tekrar dene.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------
-- 2) vehicle_images: yalnızca kendi fotoğraf adresimiz
-- ---------------------------------------------------------------
--
-- İki INSERT politikası vardı ve politikalar OR ile birleşir:
--   * vehicle_images_insert_own (20260924190000_*): yalnızca sahiplik, adres
--     denetimi yok; bu yüzden aşağıdaki denetim hiç işlemiyordu.
--   * vehicle_images_insert_own_vehicle: image_url like
--     '%/vehicle-images/<uid>/<ilan>/%'. Başındaki % her sunucuyu kabul ediyor
--     (https://evil.example/vehicle-images/<uid>/<ilan>/x.png geçer) ve
--     uygulamanın kullanmadığı bucket'ı tarif ediyor.
-- vehicle_images_update_own_vehicle aynı desenle UPDATE'te de açıktı: geçerli
-- bir satır eklenip adresi sonradan değiştirilebiliyordu.
--
-- Uygulama (app/sell/page.tsx uploadPhotos) fotoğrafı "vehicle-photos"
-- bucket'ına <ilan>/<sıra>.<uzantı> yoluyla yükler (lib/listing.ts
-- PHOTO_BUCKET, photoStoragePath) ve getPublicUrl'in verdiği adresi yazar.
-- Artık yalnızca bu adres kabul edilir: bu projenin storage'ı, bu bucket, bu
-- ilanın klasörü, tek seviye dosya adı (sorgu dizesi, alt klasör, ".." yok).
--
-- Proje adresi burada sabit: SQL, NEXT_PUBLIC_SUPABASE_URL'i bilemez. Başka bir
-- Supabase projesine ya da özel alan adına geçilirse bu fonksiyon da
-- güncellenmeli; aşağıdaki ön denetim mevcut satırlarla uyuşmazlığı yakalar.
-- lib/listing-rls.test.ts, uygulamanın getPublicUrl ile ürettiği adresin bu
-- kurala uyduğunu gerçek bir Postgres'te sınar.

create or replace function public.fn_is_vehicle_photo_url(p_vehicle_id uuid, p_image_url text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select starts_with(p_image_url, b.base)
     and substr(p_image_url, length(b.base) + 1) ~ '^[0-9]+\.[a-z0-9]+$'
    from (
      select 'https://hgjrtmucpkfccwiosxpj.supabase.co/storage/v1/object/public/vehicle-photos/'
             || p_vehicle_id::text || '/' as base
    ) b;
$function$;

revoke execute on function public.fn_is_vehicle_photo_url(uuid, text) from public, anon;
grant execute on function public.fn_is_vehicle_photo_url(uuid, text) to authenticated;

-- Ön denetim: mevcut fotoğraflar kurala uymuyorsa proje adresi yanlıştır; dur.
do $$
declare
  v_mismatch text;
begin
  select string_agg(i.id::text, ', ')
    into v_mismatch
    from public.vehicle_images i
   where not coalesce(public.fn_is_vehicle_photo_url(i.vehicle_id, i.image_url), false);

  if v_mismatch is not null then
    raise exception 'Şu vehicle_images satırları fotoğraf adresi kuralına uymuyor (proje adresi doğru mu?): %', v_mismatch;
  end if;
end $$;

drop policy if exists vehicle_images_insert_own on public.vehicle_images;
drop policy if exists vehicle_images_insert_own_vehicle on public.vehicle_images;
drop policy if exists vehicle_images_update_own_vehicle on public.vehicle_images;

create policy vehicle_images_insert_own_vehicle
  on public.vehicle_images
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and v.seller_id = (select auth.uid())
    )
    and public.fn_is_vehicle_photo_url(vehicle_id, image_url)
  );

create policy vehicle_images_update_own_vehicle
  on public.vehicle_images
  for update
  to authenticated
  using (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and v.seller_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and v.seller_id = (select auth.uid())
    )
    and public.fn_is_vehicle_photo_url(vehicle_id, image_url)
  );

-- Son denetim: adres kuralını içermeyen başka bir yazma politikası kalmamalı.
-- Tek bir gevşek politika (ör. panelden eklenmiş) OR ile hepsini geçersiz kılar.
do $$
declare
  v_loose text;
begin
  select string_agg(p.policyname || ' (' || p.cmd || ')', ', ')
    into v_loose
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = 'vehicle_images'
     and p.cmd in ('INSERT', 'UPDATE', 'ALL')
     and p.permissive = 'PERMISSIVE'
     and coalesce(p.with_check, p.qual, '') not like '%fn_is_vehicle_photo_url%';

  if v_loose is not null then
    raise exception 'vehicle_images üzerinde adres denetimi olmayan yazma politikaları var: %', v_loose;
  end if;
end $$;
