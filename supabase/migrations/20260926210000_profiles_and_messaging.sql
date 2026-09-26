-- Profil (görünen ad, avatar) ve ilan üzerinden doğrudan mesajlaşma.
--
-- Geriye dönük uyumlu: yalnızca yeni sütun, tablo, fonksiyon ve yetkiler.
-- Canlıdaki kod profiles'a yalnızca {id, whatsapp_number} upsert ediyor; bu
-- aşağıdaki sütun yetkileriyle çalışmaya devam eder.

-- ---------------------------------------------------------------
-- 1) Profil: görünen ad ve avatar; WhatsApp numarası artık herkese açık değil
-- ---------------------------------------------------------------
--
-- "Public profiles are viewable by everyone" politikası tüm satırları herkese
-- açıyordu; tabloda whatsapp_number da vardı: bütün satıcıların numaraları
-- API'den toplu çekilebiliyordu. Uygulama numarayı yalnızca get_seller_whatsapp
-- (security definer) ile okur. Politika kalkar: satırı yalnızca sahibi okur
-- ("Users can insert/update their own profile", FOR ALL). Başkalarının adı ve
-- avatarı yalnızca bu alanları dönen RPC'lerle gelir (fn_public_profile).
--
-- Sütun düzeyinde SELECT kısıtı kullanılamaz: PostgREST upsert'ü (ON CONFLICT
-- DO UPDATE ... = excluded.whatsapp_number) o sütunu okur ve canlıdaki ilan
-- verme akışı bozulurdu (lib/messaging-rls.test.ts bunu sınar).
--
-- avatar_url'i yalnızca sunucu yazar (app/api/profile/avatar, servis anahtarı):
-- kullanıcı kendi satırına herhangi bir dış adres yazamaz (sütun yetkisi).

alter table public.profiles
  add column display_name text
    check (display_name is null or (display_name = btrim(display_name)
           and char_length(display_name) between 2 and 30
           and display_name !~ '[[:cntrl:]<>]')),
  add column avatar_url text,
  add column updated_at timestamptz not null default now();

drop policy if exists "Public profiles are viewable by everyone" on public.profiles;

revoke all on public.profiles from anon;
revoke insert, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
-- PostgREST upsert'ü ON CONFLICT'te yüklenen bütün sütunları (id dahil) günceller;
-- id'nin başkasına çevrilmesini RLS (auth.uid() = id) engeller
grant insert (id, whatsapp_number, display_name) on public.profiles to authenticated;
grant update (id, whatsapp_number, display_name, updated_at) on public.profiles to authenticated;

-- Avatarlar: herkese açık okunur; yazma/silme yalnızca sunucudan (servis anahtarı)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- 2) Tablolar
-- ---------------------------------------------------------------

-- Bir alıcı, bir ilan için tek konuşma açar
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.vehicles(id) on delete cascade,
  buyer_id    uuid not null references auth.users(id) on delete cascade,
  seller_id   uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (listing_id, buyer_id),
  check (buyer_id <> seller_id)
);
create index conversations_buyer_idx on public.conversations (buyer_id, updated_at desc);
create index conversations_seller_idx on public.conversations (seller_id, updated_at desc);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  text            text not null check (char_length(btrim(text)) between 1 and 2000),
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_sender_idx on public.messages (sender_id, created_at);

-- Google Play kullanıcı içeriği politikası: engelleme ve kullanıcı şikayeti.
-- İlan şikayetleri mevcut reports tablosuna gider (moderasyon paneli onu okur).
create table public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.user_reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid references auth.users(id) on delete set null,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid references public.conversations(id) on delete set null,
  reason           text not null check (reason in ('spam', 'harassment', 'fraud', 'inappropriate', 'other')),
  details          text check (details is null or char_length(details) <= 500),
  status           text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id) on delete set null,
  check (reporter_id is distinct from reported_user_id)
);
-- Aynı kişiyi, açık şikayeti varken tekrar şikayet etmek yeni kayıt açmaz
create unique index user_reports_open_key on public.user_reports (reporter_id, reported_user_id) where status = 'open';

-- ---------------------------------------------------------------
-- 3) Yardımcılar
-- ---------------------------------------------------------------

-- Oturumdaki kullanıcı ile karşı taraf arasında (iki yönden biri) engel var mı?
-- Yalnızca kendi ilişkisini sorabilir; başkalarının engellerini sızdırmaz.
create or replace function public.fn_blocked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = auth.uid() and b.blocked_id = p_other)
        or (b.blocker_id = p_other and b.blocked_id = auth.uid())
  );
$function$;

-- Konuşmanın karşı tarafı (katılımcı değilse null)
create or replace function public.fn_conversation_partner(p_conversation_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select case when c.buyer_id = auth.uid() then c.seller_id
              when c.seller_id = auth.uid() then c.buyer_id end
    from public.conversations c
   where c.id = p_conversation_id;
$function$;

-- İlan özeti: başlık, fiyat, kapak, durum (sohbet başlığı ve gelen kutusu için)
create or replace function public.fn_listing_summary(p_vehicle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', v.id,
    'title', trim(concat_ws(' ', b.name, m.name, v.year::text)),
    'price', v.price,
    'currency', v.currency,
    'status', v.status,
    'cover_url', coalesce(
      (select i.image_url from public.vehicle_images i where i.vehicle_id = v.id
        order by i.is_primary desc, i.display_order limit 1),
      (select vd.thumbnail_url from public.videos vd where vd.vehicle_id = v.id and vd.thumbnail_url is not null
        order by (vd.status = 'ready') desc limit 1)
    )
  )
  from public.vehicles v
  left join public.brands b on b.id = v.brand_id
  left join public.models m on m.id = v.model_id
  where v.id = p_vehicle_id;
$function$;

-- Herkese açık profil alanları (ad yoksa null; arayüz "gözüyle üyesi" der)
create or replace function public.fn_public_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p_user_id,
    'display_name', (select p.display_name from public.profiles p where p.id = p_user_id),
    'avatar_url', (select p.avatar_url from public.profiles p where p.id = p_user_id)
  );
$function$;

-- ---------------------------------------------------------------
-- 4) RLS ve yetkiler
-- ---------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.user_blocks enable row level security;
alter table public.user_reports enable row level security;

revoke all on public.conversations, public.messages, public.user_blocks, public.user_reports from anon, authenticated;

-- Konuşmalar: yalnızca iki taraf görür; açmak start_conversation ile
grant select on public.conversations to authenticated;
create policy conversations_select_participant on public.conversations
  for select to authenticated
  using (auth.uid() in (buyer_id, seller_id));

-- Mesajlar: yalnızca iki taraf okur; gönderen kendisi olmalı ve aralarında
-- engel olmamalı. is_read ve created_at istemciden yazılamaz (sütun yetkisi);
-- okundu işareti mark_conversation_read ile.
grant select on public.messages to authenticated;
grant insert (conversation_id, sender_id, text) on public.messages to authenticated;
create policy messages_select_participant on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
     where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
  ));
create policy messages_insert_participant on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
       where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
    )
    and not public.fn_blocked_with(public.fn_conversation_partner(conversation_id))
  );

-- Engeller: yalnızca kendi koyduğun engelleri görür, ekler, kaldırırsın
grant select, delete on public.user_blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.user_blocks to authenticated;
create policy user_blocks_select_own on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy user_blocks_insert_own on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy user_blocks_delete_own on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- Kullanıcı şikayetleri: yalnızca eklenir; okuma moderasyon (servis anahtarı)
grant insert (reporter_id, reported_user_id, conversation_id, reason, details) on public.user_reports to authenticated;
create policy user_reports_insert_own on public.user_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

revoke execute on function public.fn_blocked_with(uuid) from public, anon;
grant execute on function public.fn_blocked_with(uuid) to authenticated;
revoke execute on function public.fn_conversation_partner(uuid) from public, anon;
grant execute on function public.fn_conversation_partner(uuid) to authenticated;
revoke execute on function public.fn_listing_summary(uuid) from public, anon, authenticated;
revoke execute on function public.fn_public_profile(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 5) Tetikleyiciler: konuşmayı öne al, mesaj hızını sınırla
-- ---------------------------------------------------------------

create or replace function public.fn_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.text := btrim(new.text);
  -- Spam sınırı: gönderen başına dakikada 30 mesaj
  if (select count(*) from public.messages m
       where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Çok hızlı mesaj gönderiyorsun; biraz bekleyip tekrar dene.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create trigger trg_messages_before_insert
  before insert on public.messages
  for each row execute function public.fn_messages_before_insert();

create or replace function public.fn_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.conversations set updated_at = new.created_at where id = new.conversation_id;
  return new;
end;
$function$;

create trigger trg_messages_after_insert
  after insert on public.messages
  for each row execute function public.fn_messages_after_insert();

-- ---------------------------------------------------------------
-- 6) RPC'ler
-- ---------------------------------------------------------------

-- İlan için konuşmayı açar ya da mevcut olanı döner
create or replace function public.start_conversation(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_seller uuid;
  v_status public.vehicle_status;
begin
  if v_uid is null then
    raise exception 'Mesaj göndermek için giriş yapmalısın.' using errcode = 'insufficient_privilege';
  end if;

  select c.id into v_id from public.conversations c where c.listing_id = p_listing_id and c.buyer_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  select v.seller_id, v.status into v_seller, v_status from public.vehicles v where v.id = p_listing_id;
  if v_seller is null or v_status <> 'active' then
    raise exception 'İlan bulunamadı ya da yayında değil.' using errcode = 'no_data_found';
  end if;
  if v_seller = v_uid then
    raise exception 'Kendi ilanına mesaj gönderemezsin.' using errcode = 'check_violation';
  end if;
  if public.fn_blocked_with(v_seller) then
    raise exception 'Bu kullanıcıyla mesajlaşamazsın.' using errcode = 'insufficient_privilege';
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (p_listing_id, v_uid, v_seller)
  on conflict (listing_id, buyer_id) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.conversations c where c.listing_id = p_listing_id and c.buyer_id = v_uid;
  end if;
  return v_id;
end;
$function$;

-- Sohbet ekranının başlığı: ilan özeti, karşı taraf, engel durumu
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
    'role', case when v_conv.buyer_id = v_uid then 'buyer' else 'seller' end,
    'listing', public.fn_listing_summary(v_conv.listing_id),
    'partner', public.fn_public_profile(v_partner),
    'i_blocked', exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = v_partner),
    'blocked_me', exists (select 1 from public.user_blocks b where b.blocker_id = v_partner and b.blocked_id = v_uid)
  );
end;
$function$;

-- Gelen kutusu: son mesaj ve okunmamış sayısıyla, en yeni konuşma önce
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
        'role', case when c.buyer_id = auth.uid() then 'buyer' else 'seller' end,
        'listing', public.fn_listing_summary(c.listing_id),
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

-- Konuşmadaki gelen mesajları okundu yapar; kaç mesajın değiştiğini döner
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  if public.fn_conversation_partner(p_conversation_id) is null then
    raise exception 'Konuşma bulunamadı.' using errcode = 'no_data_found';
  end if;
  update public.messages m
     set is_read = true
   where m.conversation_id = p_conversation_id and m.sender_id <> auth.uid() and not m.is_read;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Okunmamış mesaj sayısı (alt menü ve profil rozeti)
create or replace function public.unread_message_count()
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select count(*)::integer
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where auth.uid() in (c.buyer_id, c.seller_id)
     and m.sender_id <> auth.uid()
     and not m.is_read;
$function$;

revoke execute on function public.start_conversation(uuid) from public, anon;
revoke execute on function public.get_conversation(uuid) from public, anon;
revoke execute on function public.list_conversations() from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.unread_message_count() from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;
grant execute on function public.get_conversation(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.unread_message_count() to authenticated;

-- ---------------------------------------------------------------
-- 7) Realtime: yeni mesaj ve okundu bilgisi anında (RLS'e göre süzülür)
-- ---------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
