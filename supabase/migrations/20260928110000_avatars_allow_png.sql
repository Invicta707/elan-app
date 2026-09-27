-- Profil fotoğrafı: PNG de kabul edilir.
--
-- Tarayıcı fotoğrafı yüklemeden önce 512 px WebP'ye (desteklenmiyorsa JPEG'e)
-- sıkıştırır (lib/avatar-image.ts). WebP ve JPEG üretemeyen tarayıcı için son
-- çare PNG'dir; sunucu da artık türü ilk baytlarından PNG olarak tanıyor
-- (lib/avatar.ts detectAvatarType). Bucket buna izin vermezse Storage o
-- yüklemeyi reddeder.
--
-- Liste lib/avatar.ts AVATAR_TYPES ile aynı olmalı; lib/avatar-bucket.test.ts
-- ikisini karşılaştırır. Boyut sınırı (1 MB) değişmez.

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'avatars') then
    raise exception 'avatars bucket''ı yok; önce 20260926210000_profiles_and_messaging.sql uygulanmalı.';
  end if;
end $$;

update storage.buckets
   set allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'avatars';
