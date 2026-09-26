-- vehicle-photos bucket'ı: yükleme sınırları ve yükleme yetkisi.
--
-- Sorun: bucket herkese açık; "Authenticated users can upload vehicle
-- photos" INSERT politikası yalnızca bucket_id'ye bakıyor. Giriş yapmış
-- herkes her yola, her tür ve boyutta dosya yükleyebiliyor (ör. site
-- adresinden servis edilen keyfi dosyalar, sınırsız depolama).
--
-- Uygulama (app/sell/page.tsx uploadPhotos) fotoğrafları ilan açıldıktan hemen
-- sonra, ilan 'pending_video' iken <ilan>/<sıra>.<uzantı> yoluna yükler
-- (lib/listing.ts photoStoragePath; sıra 0..MAX_PHOTOS-1, uzantı MIME'den).
-- İstemci aynı kuralları lib/listing.ts photoRejection ile önceden uygular;
-- lib/storage-rls.test.ts değerleri karşılaştırır.

-- 1) Bucket sınırları: Storage API yüklemede uygular (her rol için).
-- HEIC yok: tarayıcıların çoğu gösteremez; iPhone Safari zaten JPEG'e çevirir.
do $$
begin
  update storage.buckets
     set file_size_limit = 10485760, -- 10 MB
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   where id = 'vehicle-photos';

  if not found then
    raise exception 'vehicle-photos bucket''ı bulunamadı.';
  end if;
end $$;

-- 2) Yükleme yetkisi: satıcı yalnızca kendi, henüz yayınlanmamış ilanının
-- klasörüne, uygulamanın ürettiği adla yükleyebilir.
--
-- storage.objects politikaları migration'la değiştirilemiyor (tablonun sahibi
-- supabase_storage_admin; postgres onun üyesi değil). INSERT politikası
-- Supabase panelinden (Storage → Policies) şu ifadeyle güncellenmeli:
--   bucket_id = 'vehicle-photos' and public.fn_can_upload_vehicle_photo(name)
create or replace function public.fn_can_upload_vehicle_photo(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.vehicles v
     -- case: uuid'ye çevirme yalnızca yol biçimi doğruysa yapılır (sıra garantili)
     where v.id = case
             when p_object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]\.(jpeg|png|webp)$'
             then split_part(p_object_name, '/', 1)::uuid
           end
       and v.seller_id = (select auth.uid())
       and v.status in ('draft', 'pending_video')
  );
$function$;

revoke execute on function public.fn_can_upload_vehicle_photo(text) from public, anon;
grant execute on function public.fn_can_upload_vehicle_photo(text) to authenticated;
