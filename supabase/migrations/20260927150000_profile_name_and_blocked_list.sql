-- Görünen ad RPC'si ve engellenen kullanıcılar listesi (Ayarlar).
--
-- Hata (canlıda bulundu): Vitrinim'de görünen ad kaydedilemiyordu ("Ad
-- kaydedilemedi"). İstemci profiles'a {id, display_name, updated_at} upsert
-- ediyordu. authenticated rolünün INSERT yetkisi yalnızca (id, whatsapp_number,
-- display_name) sütunlarında (20260926210000); upsert'in INSERT kısmı
-- updated_at için yetki hatası (42501) alıyordu. Satır zaten var olsa bile
-- INSERT yetkisi denetlendiği için ad hiç kaydedilemiyordu.
--
-- Artık ad bu RPC'yle yazılır: kural sunucuda denetlenir, updated_at sunucuda
-- atanır. Sütun yetkileri değişmedi (canlıdaki ilan verme upsert'i etkilenmez).
-- Geriye dönük uyumlu: yalnızca yeni fonksiyonlar.

create or replace function public.update_profile_display_name(p_name text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid  uuid := auth.uid();
  -- İstemcideki cleanDisplayName ile aynı: kırp, iç boşlukları teke indir
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if v_uid is null then
    raise exception 'Adını değiştirmek için giriş yapmalısın.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 30 or v_name ~ '[[:cntrl:]<>]' then
    raise exception 'Ad 2–30 karakter olmalı; < ve > kullanılamaz.' using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, display_name, updated_at)
  values (v_uid, v_name, now())
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();

  return v_name;
end;
$function$;

-- Ayarlar → Engellenen kullanıcılar: yalnızca kendi koyduğun engeller,
-- en yeni önce. Engellediğin kişinin adı ve avatarı (sohbette zaten gördüğün).
create or replace function public.list_blocked_users()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.blocked_id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'blocked_at', b.created_at
  ) order by b.created_at desc), '[]'::jsonb)
  from public.user_blocks b
  left join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid();
$function$;

revoke execute on function public.update_profile_display_name(text) from public, anon;
revoke execute on function public.list_blocked_users() from public, anon;
grant execute on function public.update_profile_display_name(text) to authenticated;
grant execute on function public.list_blocked_users() to authenticated;
