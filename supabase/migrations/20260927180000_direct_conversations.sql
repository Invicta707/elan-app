-- Profilden doğrudan mesaj: ilana bağlı olmayan konuşmalar.
--
-- Geriye dönük uyumlu: listing_id zorunluluğu kalkar (mevcut satırlar ve
-- start_conversation değişmez), yeni bir indeks ve RPC eklenir, sohbet
-- RPC'lerinin yanıtına yeni alanlar (kind, partner.username) eklenir; eski
-- istemci bu alanları yok sayar.

-- ---------------------------------------------------------------
-- 1) Tablo
-- ---------------------------------------------------------------

alter table public.conversations alter column listing_id drop not null;

-- İki kişi arasında tek doğrudan konuşma: kim başlatırsa başlatsın aynı
-- konuşma açılır (ilanlı konuşmalar unique (listing_id, buyer_id) ile tekil)
create unique index conversations_direct_pair_key
  on public.conversations (least(buyer_id, seller_id), greatest(buyer_id, seller_id))
  where listing_id is null;

-- ---------------------------------------------------------------
-- 2) Karşı tarafın profili: kullanıcı adı da döner (sohbetten vitrine bağlantı)
-- ---------------------------------------------------------------

create or replace function public.fn_public_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p_user_id,
    'username', (select p.username from public.profiles p where p.id = p_user_id),
    'display_name', (select p.display_name from public.profiles p where p.id = p_user_id),
    'avatar_url', (select p.avatar_url from public.profiles p where p.id = p_user_id)
  );
$function$;

revoke execute on function public.fn_public_profile(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 3) Profilden sohbet başlatma
-- ---------------------------------------------------------------

-- Kullanıcıyla doğrudan konuşmayı açar ya da mevcut olanı döner. Yalnızca
-- herkese açık profili (kullanıcı adı) olan kullanıcıya yazılabilir: rastgele
-- kimliklere mesaj atılamaz. Engel varsa yeni konuşma açılmaz. Spam sınırı:
-- saatte en fazla 20 yeni doğrudan konuşma.
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

-- ---------------------------------------------------------------
-- 4) Sohbet RPC'leri: konuşma türü (ilan / doğrudan)
-- ---------------------------------------------------------------

create or replace function public.get_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid     uuid := auth.uid();
  v_conv    public.conversations;
  v_partner uuid;
begin
  select * into v_conv from public.conversations c where c.id = p_conversation_id;
  if v_conv.id is null or v_uid is null or v_uid not in (v_conv.buyer_id, v_conv.seller_id) then
    raise exception 'Konuşma bulunamadı.' using errcode = 'no_data_found';
  end if;
  v_partner := case when v_conv.buyer_id = v_uid then v_conv.seller_id else v_conv.buyer_id end;

  return jsonb_build_object(
    'id', v_conv.id,
    'kind', case when v_conv.listing_id is null then 'direct' else 'listing' end,
    'role', case when v_conv.buyer_id = v_uid then 'buyer' else 'seller' end,
    'listing', case when v_conv.listing_id is null then null else public.fn_listing_summary(v_conv.listing_id) end,
    'partner', public.fn_public_profile(v_partner),
    'i_blocked', exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = v_partner),
    'blocked_me', exists (select 1 from public.user_blocks b where b.blocker_id = v_partner and b.blocked_id = v_uid)
  );
end;
$function$;

create or replace function public.list_conversations()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(row order by (row ->> 'updated_at') desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', c.id,
        'updated_at', c.updated_at,
        'kind', case when c.listing_id is null then 'direct' else 'listing' end,
        'role', case when c.buyer_id = auth.uid() then 'buyer' else 'seller' end,
        'listing', case when c.listing_id is null then null else public.fn_listing_summary(c.listing_id) end,
        'partner', public.fn_public_profile(case when c.buyer_id = auth.uid() then c.seller_id else c.buyer_id end),
        'last_message', (
          select jsonb_build_object('text', m.text, 'sender_id', m.sender_id, 'created_at', m.created_at, 'is_read', m.is_read)
            from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1
        ),
        'unread', (
          select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid() and not m.is_read
        )
      ) as row
      from public.conversations c
      where auth.uid() in (c.buyer_id, c.seller_id)
      order by c.updated_at desc
      limit 100
    ) conversations;
$function$;

revoke execute on function public.get_conversation(uuid) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.get_conversation(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
