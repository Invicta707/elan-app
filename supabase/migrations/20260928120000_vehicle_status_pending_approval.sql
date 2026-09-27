-- Zorunlu yönetici onayı: 'pending_approval'.
--
-- Otomatik içerik denetimi (Sightengine) bir videoyu yalnızca örnek karelerden
-- tarar; 27 Eylül 2026'daki testte kareler arasındaki uygunsuz sahneyi kaçırdı.
-- Artık yapay zekâ "temiz" dese bile ilan yayına girmez: bu duruma geçer ve
-- yalnızca bir yönetici /admin/reports → "İçerik denetimi"nde onaylayınca
-- 'active' olur (lib/listing-moderation.ts).
--
-- Bu durumdaki ilan akışta, aramada ve herkese açık sayfalarda görünmez (hepsi
-- status = 'active' arar; vehicles_select_active_or_own). Satıcı bu duruma ne
-- girebilir ne çıkabilir: set_vehicle_status ve fn_guard_owner_status_transition
-- geçiş tablolarında yok ("else array[]" dalı). Açıklama ve fotoğraflar da
-- kilitli (fn_guard_vehicle_content, vehicle_images politikaları yalnızca
-- draft/pending_video'da yazmaya izin verir). Yayın şartı değişmedi: 'active'
-- için moderation_status = 'approved' gerekir ve onu yalnızca yönetici kararı yazar.
--
-- Enum'a eklenen değer, eklendiği transaction bitmeden kullanılamaz; bu yüzden
-- tek başına bir migration.

alter type public.vehicle_status add value if not exists 'pending_approval';
