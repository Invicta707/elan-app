-- get_seller_whatsapp, public.users.phone yerine public.profiles.whatsapp_number
-- okuyacak şekilde düzeltilir. Uygulama (app/sell/page.tsx) numarayı
-- profiles.whatsapp_number'a yazıyor; eski fonksiyon hâlâ public.users.phone'u
-- sorguladığı için satıcı profili güncel olsa da her zaman null dönüyordu.
--
-- COALESCE(p.whatsapp_number, u.phone): profiles'ta numara varsa o kullanılır;
-- yoksa (ör. henüz /sell akışından geçmemiş eski kayıtlar) public.users.phone'a
-- geriye dönük uyumluluk için düşülür. Her iki tablo da LEFT JOIN'dir; seller_id
-- her iki tabloda da bulunmayabilir, eşleşme yoksa v_phone null kalır (hata değil).
CREATE OR REPLACE FUNCTION public.get_seller_whatsapp(p_vehicle_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text;
begin
  select coalesce(p.whatsapp_number, u.phone)
    into v_phone
    from public.vehicles v
    left join public.profiles p on p.id = v.seller_id
    left join public.users u on u.id = v.seller_id
   where v.id = p_vehicle_id
     and v.status = 'active';

  if v_phone is null then
    return null;
  end if;

  if auth.uid() is not null then
    insert into public.interactions (user_id, vehicle_id, type)
    values (auth.uid(), p_vehicle_id, 'contact_click');
  end if;

  return v_phone;
end;
$function$;
