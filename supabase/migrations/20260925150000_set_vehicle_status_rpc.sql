-- İlanlarım: satıcının kendi ilanının durumunu değiştirmesi.
--
-- Uygulama durumu doğrudan tabloya yazmaz, set_vehicle_status'u çağırır:
--   * sahiplik fonksiyonun içinde açıkça denetlenir (seller_id = auth.uid())
--   * izin verilen geçişler tek yerde tanımlıdır (lib/listing-status.ts aynı
--     tabloyu arayüz için tutar; lib/listing-status.test.ts ikisini karşılaştırır)
--   * 'active'e geçişte fn_check_vehicle_publishable fotoğraf/video şartını
--     yine denetler
--
-- Tek transaction: ön kontrol başarısız olursa hiçbir şey uygulanmaz.

-- 1) Ön kontrol: vehicles'ta RLS açık olmalı ve güncelleme yapabilen her
-- politika satıcıya bağlı olmalı. Aksi hâlde biri, fonksiyonu atlayıp
-- başkasının ilanını doğrudan tabloya yazarak değiştirebilirdi.
do $$
declare
  loose_policies text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.vehicles'::regclass) then
    raise exception 'public.vehicles üzerinde RLS kapalı; herkes her ilanı güncelleyebilir.';
  end if;

  select string_agg(p.policyname || ' (' || p.cmd || ')', ', ')
    into loose_policies
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = 'vehicles'
     and p.cmd in ('UPDATE', 'ALL')
     and p.roles && array['public', 'anon', 'authenticated']::name[]
     and not (coalesce(p.qual, '') ilike '%seller_id%' and coalesce(p.qual, '') ilike '%auth.uid()%');

  if loose_policies is not null then
    raise exception 'vehicles üzerinde satıcıya bağlı olmayan güncelleme politikaları var: %', loose_policies;
  end if;
end $$;

-- 2) Durum değiştirme fonksiyonu
create or replace function public.set_vehicle_status(
  p_vehicle_id uuid,
  p_status public.vehicle_status
)
returns public.vehicle_status
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_current public.vehicle_status;
  v_allowed public.vehicle_status[];
begin
  if v_uid is null then
    raise exception 'İlan durumunu değiştirmek için giriş yapmalısın.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Başkasının ilanı ile olmayan ilan aynı yanıtı alır: id'nin varlığı sızmaz
  select v.status
    into v_current
    from public.vehicles v
   where v.id = p_vehicle_id
     and v.seller_id = v_uid
   for update;

  if not found then
    raise exception 'İlan bulunamadı.' using errcode = 'no_data_found';
  end if;

  v_allowed := case v_current
    when 'active'        then array['sold', 'archived']::public.vehicle_status[]
    when 'archived'      then array['active', 'sold']::public.vehicle_status[]
    when 'draft'         then array['archived']::public.vehicle_status[]
    when 'pending_video' then array['archived']::public.vehicle_status[]
    else array[]::public.vehicle_status[]
  end;

  if not (p_status = any(v_allowed)) then
    raise exception 'Bu ilanın durumu bu şekilde değiştirilemez.'
      using errcode = 'check_violation';
  end if;

  update public.vehicles set status = p_status where id = p_vehicle_id;

  return p_status;
end;
$function$;

revoke execute on function public.set_vehicle_status(uuid, public.vehicle_status) from public, anon;
grant execute on function public.set_vehicle_status(uuid, public.vehicle_status) to authenticated;
