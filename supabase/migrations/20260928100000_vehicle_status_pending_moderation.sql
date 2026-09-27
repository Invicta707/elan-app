-- Otomatik içerik denetimini bekleyen ilan durumu: 'pending_moderation'.
--
-- Video Cloudflare'de işlenince ilan doğrudan 'active' olmaz; önce bu duruma
-- geçer, görsel ve metin denetimi (lib/listing-moderation.ts) geçerse 'active',
-- geçmezse 'rejected' olur. Bu durumdaki ilan akışta, aramada ve herkese açık
-- sayfalarda görünmez (hepsi status = 'active' arar; vehicles_select_active_or_own).
--
-- Satıcı bu duruma ne girebilir ne çıkabilir: set_vehicle_status ve
-- fn_guard_owner_status_transition'daki geçiş tablolarında yok ("else array[]"
-- dalı). Durumu yalnızca sunucu (servis anahtarı) değiştirir.
--
-- Enum'a eklenen değer, eklendiği transaction bitmeden kullanılamaz; bu yüzden
-- onu kullanan kurallar ayrı migration'da (*_content_moderation.sql).

alter type public.vehicle_status add value if not exists 'pending_moderation';
