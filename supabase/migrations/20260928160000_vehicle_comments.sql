-- İlan yorumları (akışta video altı yorum penceresi).
--
-- Kurallar:
--   * Yorumu herkes okur, ilan yayındaysa. Satıcı kendi ilanının, yazar kendi
--     yorumunun satırını ilan yayında değilken de görür (silebilsin diye).
--   * Yalnızca oturum açmış, e-postası onaylı, kullanıcı adı olan (yorum
--     herkese açık: yazarı @ad ile görünür) kullanıcı, yayındaki ilana yazar.
--     İlan sahibiyle arasında engel varsa (iki yönden biri) yazamaz.
--   * Silme: yorumun yazarı ya da ilanın sahibi. Yönetici silmesi sunucudan
--     yapılır (ADMIN_EMAILS, onaylı e-posta; /api/vehicles/[id]/comments/[commentId]):
--     yönetici adresi veritabanına yazılmaz.
--   * Düzenleme yok (UPDATE yetkisi ve politikası yok): silip yeniden yazılır.
--   * Metin 1–500 karakter (baştaki/sondaki boşluk kırpılır), temel metin
--     filtresinden geçer (fn_moderation_text_category; TS aynası lib/text-moderation.ts).
--   * Spam sınırı: aynı ilana 10 saniyede bir, toplamda dakikada 10 yorum.
--     Hata kodu PT429: PostgREST bunu HTTP 429 olarak döner.
--   * vehicles.comments_count tetikleyiciyle tutulur; kullanıcı yazamaz
--     (fn_guard_vehicle_counters, aşağıda).

-- ---------------------------------------------------------------
-- 0) Sayaç koruması canlıdakiyle aynı mı?
-- ---------------------------------------------------------------
--
-- fn_guard_vehicle_counters migration'larla değil, panelden kurulmuştu:
-- sayaçları yalnızca bir tetikleyicinin içinden (pg_trigger_depth() > 1)
-- değiştirmeye izin verir ve her güncellemede updated_at'i yeniler. Aşağıda
-- comments_count eklenerek yeniden yazılıyor; gövde beklenenden farklıysa
-- (biri değiştirmişse) hiçbir şey uygulanmaz.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.fn_guard_vehicle_counters'::regproc) into v_def;
  if position('new.saves_count := old.saves_count;' in v_def) = 0
     or position('pg_trigger_depth() <= 1' in v_def) = 0
     or position('new.updated_at := now();' in v_def) = 0 then
    raise exception 'fn_guard_vehicle_counters beklenen gövdede değil; yorum migration''ı uygulanmadı.';
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 1) Tablo ve sayaç sütunu
-- ---------------------------------------------------------------

create table public.vehicle_comments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- BEFORE tetikleyicisi kırptıktan sonra denetlenir
  constraint vehicle_comments_content_length check (char_length(content) between 1 and 500)
);

-- İlanın yorumları, en yenisi önce (imleçli sayfalama)
create index vehicle_comments_vehicle_created_idx
  on public.vehicle_comments (vehicle_id, created_at desc, id desc);
-- Kullanıcının son yorumları (spam sınırı)
create index vehicle_comments_user_created_idx
  on public.vehicle_comments (user_id, created_at desc);

alter table public.vehicles add column if not exists comments_count integer not null default 0;

-- Canlıdaki gövde + comments_count (yalnızca iki satır eklendi)
create or replace function public.fn_guard_vehicle_counters()
 returns trigger
 language plpgsql
as $function$
begin
  if tg_op = 'INSERT' then
    -- Yeni ilan her zaman sıfır sayaçla başlar, client ne gönderirse göndersin
    new.likes_count := 0;
    new.views_count := 0;
    new.saves_count := 0;
    new.comments_count := 0;
    return new;

  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
    if pg_trigger_depth() <= 1 then
      new.likes_count := old.likes_count;
      new.views_count := old.views_count;
      new.saves_count := old.saves_count;
      new.comments_count := old.comments_count;
    end if;
    return new;
  end if;

  return null;
end;
$function$;

-- ---------------------------------------------------------------
-- 2) Kim yazabilir: nedenli yardımcı
-- ---------------------------------------------------------------
--
-- null: yazabilir. Aksi halde neden (API kullanıcıya uygun metni gösterir):
--   auth_required, email_unconfirmed, listing_unavailable, username_required, blocked
-- security definer: auth.users, profiles ve user_blocks kullanıcıya kapalı;
-- yalnızca oturumdaki kullanıcının kendi durumunu söyler.
create or replace function public.fn_comment_block_reason(p_vehicle_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_seller uuid;
begin
  if v_uid is null then
    return 'auth_required';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    return 'email_unconfirmed';
  end if;
  select v.seller_id into v_seller from public.vehicles v where v.id = p_vehicle_id and v.status = 'active';
  if not found then
    return 'listing_unavailable';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.username is not null) then
    return 'username_required';
  end if;
  if exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = v_seller and b.blocked_id = v_uid)
        or (b.blocker_id = v_uid and b.blocked_id = v_seller)
  ) then
    return 'blocked';
  end if;
  return null;
end;
$function$;

revoke execute on function public.fn_comment_block_reason(uuid) from public, anon;
grant execute on function public.fn_comment_block_reason(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------
-- 3) Yetkiler ve RLS
-- ---------------------------------------------------------------

alter table public.vehicle_comments enable row level security;

revoke all on public.vehicle_comments from anon, authenticated;
grant select on public.vehicle_comments to anon, authenticated;
-- Yalnızca bu sütunlar: id, zaman damgaları sunucunun
grant insert (vehicle_id, user_id, content) on public.vehicle_comments to authenticated;
grant delete on public.vehicle_comments to authenticated;
grant all on public.vehicle_comments to service_role;

create policy vehicle_comments_select_visible on public.vehicle_comments
  for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.vehicles v
       where v.id = vehicle_comments.vehicle_id
         and (v.status = 'active' or v.seller_id = (select auth.uid()))
    )
  );

create policy vehicle_comments_insert_own on public.vehicle_comments
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.fn_comment_block_reason(vehicle_id) is null);

create policy vehicle_comments_delete_author_or_seller on public.vehicle_comments
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.vehicles v
       where v.id = vehicle_comments.vehicle_id and v.seller_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------
-- 4) Tetikleyiciler: kırpma + spam sınırı, metin filtresi, sayaç
-- ---------------------------------------------------------------
--
-- Aynı olaydaki BEFORE tetikleyicileri ada göre çalışır: önce kırpma ve hız
-- sınırı (before_insert), sonra metin filtresi (text_filter).

create or replace function public.fn_vehicle_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.content := btrim(new.content);
  -- Zaman sunucunun: istemci geçmiş bir zaman yazıp spam sınırını atlatamaz
  new.created_at := now();
  new.updated_at := now();

  if coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated') then
    if exists (
      select 1 from public.vehicle_comments c
       where c.user_id = new.user_id
         and c.vehicle_id = new.vehicle_id
         and c.created_at > now() - interval '10 seconds'
    ) then
      raise exception 'Bu ilana az önce yorum yazdın; birkaç saniye bekleyip tekrar dene.'
        using errcode = 'PT429';
    end if;
    if (select count(*) from public.vehicle_comments c
         where c.user_id = new.user_id and c.created_at > now() - interval '1 minute') >= 10 then
      raise exception 'Çok hızlı yorum yazıyorsun; biraz bekleyip tekrar dene.'
        using errcode = 'PT429';
    end if;
  end if;
  return new;
end;
$function$;

create trigger trg_vehicle_comments_before_insert
  before insert on public.vehicle_comments
  for each row execute function public.fn_vehicle_comments_before_insert();

create or replace function public.fn_vehicle_comments_text_filter()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if public.fn_moderation_text_category(new.content) is not null then
    raise exception 'Yorumunuz topluluk kurallarına uymayan ifadeler içeriyor.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create trigger trg_vehicle_comments_text_filter
  before insert on public.vehicle_comments
  for each row execute function public.fn_vehicle_comments_text_filter();

-- Sayaç: tetikleyici içinden yazıldığı için (pg_trigger_depth() > 1)
-- fn_guard_vehicle_counters değişikliğe izin verir. İlan silinirken (CASCADE)
-- satır artık yoktur; güncelleme hiçbir satıra dokunmaz.
create or replace function public.fn_vehicle_comments_count()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    update public.vehicles set comments_count = comments_count + 1 where id = new.vehicle_id;
    return new;
  end if;
  update public.vehicles set comments_count = greatest(comments_count - 1, 0) where id = old.vehicle_id;
  return old;
end;
$function$;

create trigger trg_vehicle_comments_count
  after insert or delete on public.vehicle_comments
  for each row execute function public.fn_vehicle_comments_count();

-- ---------------------------------------------------------------
-- 5) Okuma: yorumlar yazarlarıyla, imleçli
-- ---------------------------------------------------------------
--
-- İlan görünmüyorsa (yayında değil ve sahibi değil) null. Aksi halde
-- { total, comments: [...] }: en yenisi önce; p_before/p_before_id son görülen
-- yorumun zamanı ve kimliği. Yazarın herkese açık yüzü (kullanıcı adı, ad,
-- avatar); WhatsApp numarası gibi alanlar asla dönmez. Oturumdaki kullanıcının
-- engellediği kişilerin yorumları ona gösterilmez.
create or replace function public.list_vehicle_comments(
  p_vehicle_id uuid,
  p_limit integer default 20,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with v as (
    select x.id, x.seller_id, x.comments_count
      from public.vehicles x
     where x.id = p_vehicle_id
       and (x.status = 'active' or x.seller_id = auth.uid())
  ),
  page as (
    select c.id, c.user_id, c.content, c.created_at
      from public.vehicle_comments c
      join v on v.id = c.vehicle_id
     where (p_before is null
            or c.created_at < p_before
            or (c.created_at = p_before and p_before_id is not null and c.id < p_before_id))
       and not exists (
         select 1 from public.user_blocks b
          where b.blocker_id = auth.uid() and b.blocked_id = c.user_id
       )
     order by c.created_at desc, c.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  )
  select case when not exists (select 1 from v) then null else jsonb_build_object(
    'total', (select v.comments_count from v),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'user_id', page.user_id,
        'content', page.content,
        'created_at', page.created_at,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'is_seller', page.user_id = (select v.seller_id from v),
        'is_mine', auth.uid() is not null and page.user_id = auth.uid(),
        'can_delete', auth.uid() is not null
                      and (page.user_id = auth.uid() or (select v.seller_id from v) = auth.uid())
      ) order by page.created_at desc, page.id desc)
        from page
        left join public.profiles p on p.id = page.user_id
    ), '[]'::jsonb)
  ) end;
$function$;

revoke execute on function public.list_vehicle_comments(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.list_vehicle_comments(uuid, integer, timestamptz, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------
-- 6) Denetim kaydı: yorum kararları (ret, yönetici silmesi)
-- ---------------------------------------------------------------

alter table public.content_moderation_events
  drop constraint if exists content_moderation_events_subject_type_check;
alter table public.content_moderation_events
  add constraint content_moderation_events_subject_type_check
  check (subject_type in ('listing', 'avatar', 'message', 'comment'));
