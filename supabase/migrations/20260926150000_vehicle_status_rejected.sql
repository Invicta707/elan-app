-- Moderasyonla yayından kaldırılan ilan durumu: 'rejected'.
--
-- 'archived' satıcının kendi kararıdır; satıcı ilanı yeniden yayına alabilir.
-- 'rejected' moderasyonun kararıdır; satıcı bu durumdan çıkamaz (bkz.
-- 20260926150100_moderation.sql'deki tetikleyici ve set_vehicle_status'taki
-- "else array[]" dalı).
--
-- Enum'a eklenen değer, eklendiği transaction bitmeden kullanılamaz; bu yüzden
-- onu kullanan tetikleyici ayrı migration'da.

alter type public.vehicle_status add value if not exists 'rejected';
