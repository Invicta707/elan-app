-- Profilden doğrudan mesaj: başlatanın da kullanıcı adı olmalı.
--
-- Doğrudan sohbette iki tarafın da gerçek bir kimliği görünsün diye (ad yoksa
-- @kullanıcı_adı; jenerik "gözüyle üyesi" yok). Arayüz kullanıcı adı olmayana
-- önce kullanıcı adı penceresini açar; bu kural doğrudan API çağrısını da
-- kapsar. Geriye dönük uyumlu: yalnızca fonksiyon gövdesi değişir, mevcut
-- konuşmalar etkilenmez (mevcut konuşma yine döner).

create or replace function public.start_direct_conversation(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Mesaj göndermek için giriş yapmalısın.' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'Kendine mesaj gönderemezsin.' using errcode = 'check_violation';
  end if;

  select c.id into v_id
    from public.conversations c
   where c.listing_id is null
     and least(c.buyer_id, c.seller_id) = least(v_uid, p_user_id)
     and greatest(c.buyer_id, c.seller_id) = greatest(v_uid, p_user_id);
  if v_id is not null then
    return v_id;
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid and p.username is not null) then
    raise exception 'Mesaj göndermek için önce kullanıcı adını belirle.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.username is not null) then
    raise exception 'Kullanıcı bulunamadı.' using errcode = 'no_data_found';
  end if;
  if public.fn_blocked_with(p_user_id) then
    raise exception 'Bu kullanıcıyla mesajlaşamazsın.' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.conversations c
       where c.buyer_id = v_uid and c.listing_id is null and c.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Çok fazla yeni sohbet başlattın; biraz sonra tekrar dene.' using errcode = 'check_violation';
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (null, v_uid, p_user_id)
  on conflict do nothing
  returning id into v_id;

  -- Karşı taraf aynı anda başlattıysa onun konuşması döner
  if v_id is null then
    select c.id into v_id
      from public.conversations c
     where c.listing_id is null
       and least(c.buyer_id, c.seller_id) = least(v_uid, p_user_id)
       and greatest(c.buyer_id, c.seller_id) = greatest(v_uid, p_user_id);
  end if;
  return v_id;
end;
$function$;

revoke execute on function public.start_direct_conversation(uuid) from public, anon;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
