-- Benzersiz kullanıcı adı, takip sistemi ve "Takip Edilenler" akışı.
--
-- Geriye dönük uyumlu: yalnızca yeni sütun, tablo, fonksiyon, tetikleyici ve
-- yetkiler. Canlıdaki kod profiles'a yalnızca {id, whatsapp_number,
-- display_name, updated_at} yazıyor; yeni sütunlara (username, sayaçlar)
-- istemcinin yazma yetkisi yok: kullanıcı adı yalnızca set_username ile,
-- sayaçlar yalnızca follows tetikleyicisiyle değişir.
--
-- Kurallar TS tarafında lib/username.ts'te aynen var; eşitliği
-- lib/social-rls.test.ts denetliyor.

-- ---------------------------------------------------------------
-- 1) Kullanıcı adı kuralları
-- ---------------------------------------------------------------

-- Sistem sayfaları, uygulama sözcükleri ve kurumsal adlar: kimse alamaz
create or replace function public.fn_reserved_usernames()
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select array[
    '_next', 'about', 'account', 'admin', 'akis', 'anonim', 'anonymous', 'api', 'ara', 'arac',
    'araclar', 'assets', 'auth', 'ayarlar', 'bildirim', 'bildirimler', 'bot', 'callback', 'cikis', 'contact',
    'dashboard', 'destek', 'email', 'explore', 'favicon', 'favoriler', 'favorites', 'feed', 'follow', 'followers',
    'following', 'giris', 'gizlilik', 'guvenlik', 'hakkinda', 'help', 'hesap', 'icons', 'ilan', 'ilan_ver',
    'ilanlar', 'iletisim', 'info', 'kayit', 'kesfet', 'kosullar', 'kullanici', 'kvkk', 'login', 'logout',
    'mail', 'manifest', 'mesaj', 'mesajlar', 'messages', 'moderation', 'moderator', 'my_listings', 'notifications', 'null',
    'official', 'owner', 'privacy', 'profile', 'profiles', 'public', 'register', 'report', 'reports', 'resmi',
    'robots', 'root', 'search', 'security', 'sell', 'settings', 'signin', 'signup', 'sistem', 'sitemap',
    'staff', 'static', 'support', 'takip', 'takipci', 'takipciler', 'team', 'terms', 'test', 'undefined',
    'user', 'users', 'vehicles', 'vitrin', 'vitrinim', 'www', 'yardim', 'yonetici', 'yonetim'
  ]::text[];
$function$;

-- Listedeki adlar, marka adını içerenler (ör. gozuyle_destek) ve yetkili
-- gibi görünen önekler (admin…, moderator…, destek…, support…)
create or replace function public.fn_is_reserved_username(p_username text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_username = any (public.fn_reserved_usernames())
      or strpos(p_username, 'gozuyle') > 0
      or p_username ~ '^(admin|moderator|destek|support)';
$function$;

-- profiles.username için tam kural (biçim + küçük harf + rezerve)
create or replace function public.fn_is_valid_username(p_username text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_username is not null
     and p_username = lower(p_username)
     and p_username ~ '^[a-z0-9_]{3,20}$'
     and not public.fn_is_reserved_username(p_username);
$function$;

-- CHECK kısıtı bu fonksiyonları her profiles yazımında çağırır (canlıdaki
-- upsert dahil): istemci rolleri çalıştırabilmeli
grant execute on function public.fn_reserved_usernames() to anon, authenticated, service_role;
grant execute on function public.fn_is_reserved_username(text) to anon, authenticated, service_role;
grant execute on function public.fn_is_valid_username(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------
-- 2) profiles: kullanıcı adı ve takip sayaçları
-- ---------------------------------------------------------------

alter table public.profiles
  add column username text,
  -- İlk belirleme serbest; sonraki değişikliklerden sonra 7 gün beklenir
  add column username_changed_at timestamptz,
  add column followers_count integer not null default 0,
  add column following_count integer not null default 0;

alter table public.profiles
  add constraint profiles_username_valid check (username is null or public.fn_is_valid_username(username)),
  add constraint profiles_username_key unique (username),
  add constraint profiles_followers_count_check check (followers_count >= 0),
  add constraint profiles_following_count_check check (following_count >= 0);

-- Sütun yetkileri değişmedi: authenticated yalnızca (id, whatsapp_number,
-- display_name[, updated_at]) yazabilir. Yeni sütunlar bu listede değil.

-- ---------------------------------------------------------------
-- 3) follows tablosu
-- ---------------------------------------------------------------

create table public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- Kullanıcı kendini takip edemez
  constraint follows_not_self check (follower_id <> following_id)
);

-- Aynı kişi iki kez takip edilemez; takip edenin listesi bu indeksin ilk sütunundan okunur
create unique index follows_pair_key on public.follows (follower_id, following_id);
-- Bir kullanıcının takipçileri
create index follows_following_idx on public.follows (following_id, created_at desc);

alter table public.follows enable row level security;

revoke all on public.follows from anon, authenticated;

-- Herkes okuyabilir (kim kimi takip ediyor herkese açık)
grant select on public.follows to anon, authenticated;
create policy follows_select_all on public.follows
  for select to anon, authenticated
  using (true);

-- Yalnızca kendi adına takip eder; aralarında engel varsa takip edemez.
-- id ve created_at istemciden yazılamaz (hız sınırı created_at'e bakar).
grant insert (follower_id, following_id) on public.follows to authenticated;
create policy follows_insert_own on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid() and not public.fn_blocked_with(following_id));

-- Yalnızca kendi takibini bırakır
grant delete on public.follows to authenticated;
create policy follows_delete_own on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------
-- 4) Tetikleyiciler: profil satırı, hız sınırı, sayaçlar, engel
-- ---------------------------------------------------------------

create or replace function public.fn_follows_before_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.created_at := now();

  -- profiles satırı ilk ad/numara/kullanıcı adı kaydında açılıyordu; takip
  -- için iki tarafın da satırı olmalı (yabancı anahtar). Kayıt reddedilirse
  -- (RLS, kısıt) bu ekleme de geri alınır.
  insert into public.profiles (id)
  values (new.follower_id), (new.following_id)
  on conflict (id) do nothing;

  if (select count(*) from public.follows f
       where f.follower_id = new.follower_id and f.created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Çok hızlı takip ediyorsun; biraz bekleyip tekrar dene.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.follows f where f.follower_id = new.follower_id) >= 5000 then
    raise exception 'En fazla 5000 kişiyi takip edebilirsin.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create trigger trg_follows_before_insert
  before insert on public.follows
  for each row execute function public.fn_follows_before_insert();

-- Sayaçlar: iki satır her zaman aynı sırayla (id'ye göre) kilitlenir; karşılıklı
-- aynı anda takip eden iki kullanıcı kilitlenip kalmaz (deadlock)
create or replace function public.fn_follows_counters()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_follower  uuid := case when tg_op = 'INSERT' then new.follower_id else old.follower_id end;
  v_following uuid := case when tg_op = 'INSERT' then new.following_id else old.following_id end;
  v_delta     integer := case when tg_op = 'INSERT' then 1 else -1 end;
begin
  perform 1 from public.profiles p where p.id in (v_follower, v_following) order by p.id for update;

  update public.profiles
     set following_count = greatest(following_count + v_delta, 0)
   where id = v_follower;
  update public.profiles
     set followers_count = greatest(followers_count + v_delta, 0)
   where id = v_following;

  return null;
end;
$function$;

create trigger trg_follows_counters
  after insert or delete on public.follows
  for each row execute function public.fn_follows_counters();

-- Engellenince iki yöndeki takip de kalkar
create or replace function public.fn_user_blocks_drop_follows()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  delete from public.follows f
   where (f.follower_id = new.blocker_id and f.following_id = new.blocked_id)
      or (f.follower_id = new.blocked_id and f.following_id = new.blocker_id);
  return null;
end;
$function$;

create trigger trg_user_blocks_drop_follows
  after insert on public.user_blocks
  for each row execute function public.fn_user_blocks_drop_follows();

revoke execute on function public.fn_follows_before_insert() from public, anon, authenticated;
revoke execute on function public.fn_follows_counters() from public, anon, authenticated;
revoke execute on function public.fn_user_blocks_drop_follows() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 5) RPC'ler: kullanıcı adı
-- ---------------------------------------------------------------

-- Canlı kontrol: 'invalid' | 'reserved' | 'current' (zaten senin) | 'taken' | 'available'
create or replace function public.check_username(p_username text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_name  text := lower(btrim(coalesce(p_username, '')));
  v_owner uuid;
begin
  if v_name !~ '^[a-z0-9_]{3,20}$' then
    return 'invalid';
  end if;
  if public.fn_is_reserved_username(v_name) then
    return 'reserved';
  end if;
  select p.id into v_owner from public.profiles p where p.username = v_name;
  if v_owner is null then
    return 'available';
  end if;
  return case when v_owner = auth.uid() then 'current' else 'taken' end;
end;
$function$;

-- Kullanıcı adını belirler ya da değiştirir; profil satırı yoksa açar.
-- İlk belirleme ve ilk değişiklik serbest (yazım hatası düzeltilebilsin);
-- sonrasında son değişiklikten itibaren 7 gün beklenir.
create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid     uuid := auth.uid();
  v_name    text := lower(btrim(coalesce(p_username, '')));
  v_current text;
  v_changed timestamptz;
begin
  if v_uid is null then
    raise exception 'Kullanıcı adı belirlemek için giriş yapmalısın.' using errcode = 'insufficient_privilege';
  end if;
  if v_name !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Kullanıcı adı 3–20 karakter olmalı; yalnızca küçük harf, rakam ve alt çizgi.' using errcode = 'check_violation';
  end if;
  if public.fn_is_reserved_username(v_name) then
    raise exception 'Bu kullanıcı adı kullanılamaz.' using errcode = 'check_violation';
  end if;

  select p.username, p.username_changed_at into v_current, v_changed
    from public.profiles p where p.id = v_uid for update;

  if v_current = v_name then
    return v_name;
  end if;
  if v_current is not null and v_changed is not null and v_changed > now() - interval '7 days' then
    raise exception 'Kullanıcı adını 7 günde bir değiştirebilirsin.' using errcode = 'check_violation';
  end if;

  begin
    insert into public.profiles (id, username, username_changed_at, updated_at)
    values (v_uid, v_name, null, now())
    on conflict (id) do update
      set username = excluded.username,
          -- İlk belirlemede null kalır; değişiklikte bekleme süresi başlar
          username_changed_at = case when public.profiles.username is null then null else now() end,
          updated_at = now();
  exception when unique_violation then
    raise exception 'Bu kullanıcı adı alınmış.' using errcode = 'unique_violation';
  end;

  return v_name;
end;
$function$;

revoke execute on function public.check_username(text) from public, anon;
revoke execute on function public.set_username(text) from public, anon;
grant execute on function public.check_username(text) to authenticated;
grant execute on function public.set_username(text) to authenticated;

-- ---------------------------------------------------------------
-- 6) RPC'ler: herkese açık profil ve takip edilenler akışı
-- ---------------------------------------------------------------

-- /@kullanici_adi sayfası: yalnızca herkese açık alanlar (WhatsApp numarası
-- asla). Oturum varsa takip durumu da döner. Bulunamazsa null.
create or replace function public.get_public_profile(p_username text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'followers_count', p.followers_count,
    'following_count', p.following_count,
    'listings_count', (select count(*) from public.vehicles v where v.seller_id = p.id and v.status = 'active'),
    'is_me', coalesce(p.id = auth.uid(), false),
    'is_following', exists (
      select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id
    )
  )
  from public.profiles p
  where p.username = lower(btrim(coalesce(p_username, '')));
$function$;

-- Akış kartları ve ilan sayfası için satıcıların kısa profili (en fazla 50).
-- Yalnızca herkese açık yüzü olanlar döner: kullanıcı adı olan ya da yayında
-- ilanı olan kullanıcılar. Diğer kullanıcıların adı id ile sorgulanamaz.
create or replace function public.get_public_profiles(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'is_following', exists (
      select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id
    )
  )), '[]'::jsonb)
  from public.profiles p
  where p.id = any ((coalesce(p_ids, '{}'::uuid[]))[1:50])
    and (p.username is not null
         or exists (select 1 from public.vehicles v where v.seller_id = p.id and v.status = 'active'));
$function$;

-- Takip edilenlerin yayındaki ilanları. vehicles satırı döndüğü için
-- PostgREST'te akış sorgusu gibi süzülür, sıralanır ve videos ile birleştirilir
-- (bkz. lib/feed.ts). Çağıranın yetkileriyle çalışır (RLS geçerli).
create or replace function public.following_feed()
returns setof public.vehicles
language sql
stable
security invoker
set search_path to ''
as $function$
  select v.*
    from public.vehicles v
   where v.status = 'active'
     and v.seller_id in (select f.following_id from public.follows f where f.follower_id = auth.uid());
$function$;

revoke execute on function public.get_public_profile(text) from public;
revoke execute on function public.get_public_profiles(uuid[]) from public;
revoke execute on function public.following_feed() from public, anon;
grant execute on function public.get_public_profile(text) to anon, authenticated;
grant execute on function public.get_public_profiles(uuid[]) to anon, authenticated;
grant execute on function public.following_feed() to authenticated;
