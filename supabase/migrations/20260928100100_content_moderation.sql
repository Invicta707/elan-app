-- Otomatik içerik denetimi: karantina, denetim kaydı ve temel metin filtresi.
-- Tek transaction: bir adım (ya da sondaki denetim) başarısız olursa hiçbir şey
-- uygulanmaz. Geriye dönük uyumlu: mevcut ilanlar denetimden geçmiş sayılır,
-- mevcut sütunlar ve politikalar yalnızca daraltılır.
--
-- Akış (lib/video-activation.ts, lib/listing-moderation.ts):
--   yeni ilan (pending_video, denetim 'pending')
--     → video işlendi → 'pending_moderation' (akışta, aramada görünmez)
--     → görsel + metin denetimi
--         temiz   → denetim 'approved', ilan 'active'
--         şüpheli → 'pending_moderation'da kalır; /admin/reports'ta elle karar
--         ihlal   → denetim 'rejected', ilan 'rejected'; video ve fotoğraflar silinir

-- ---------------------------------------------------------------
-- 1) vehicles: denetim durumu
-- ---------------------------------------------------------------
--
-- moderation_status: pending (henüz karar yok) | approved | rejected.
-- moderation_reason: kararın nedeni (ör. 'sexual', 'violence', 'review:gore',
-- 'manual'); satıcıya yalnızca genel bir uyarı gösterilir.
-- Üçünü de yalnızca sunucu yazar (aşağıdaki fn_guard_vehicle_content).

alter table public.vehicles
  add column moderation_status text not null default 'pending'
    constraint vehicles_moderation_status_check
    check (moderation_status in ('pending', 'approved', 'rejected')),
  add column moderation_reason text,
  add column moderated_at timestamptz;

-- Mevcut ilanlar (yayında, satılmış, arşivde, kaldırılmış) bu kurallardan önce
-- yayınlanmıştı: denetimden geçmiş sayılır, satıcı arşivdeki ilanını yine yayına
-- alabilir. Henüz videosu işlenmemiş ilanlar ('draft', 'pending_video') denetime girer.
update public.vehicles
   set moderation_status = 'approved',
       moderated_at = now()
 where status not in ('draft', 'pending_video');

-- Yönetim kuyruğu: kararı bekleyen ilanlar
create index vehicles_moderation_pending_idx
  on public.vehicles (created_at)
  where moderation_status = 'pending';

-- ---------------------------------------------------------------
-- 2) Denetim kayıtları
-- ---------------------------------------------------------------
--
-- Her otomatik ya da elle verilen karar için bir satır (Google Play / App Store
-- UGC incelemesinde "denetim kaydı" olarak gösterilebilir). Metnin ya da
-- görselin kendisi saklanmaz: yalnızca karar, nedenler ve puanlar.
-- Yalnızca sunucu (servis anahtarı) okur ve yazar: RLS açık, politika yok.

create table public.content_moderation_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null
    constraint content_moderation_events_subject_type_check
    check (subject_type in ('listing', 'avatar', 'message')),
  subject_id uuid,
  -- İçeriğin sahibi (satıcı, avatarın sahibi, mesajı yazan)
  user_id uuid references auth.users(id) on delete set null,
  -- Elle verilen kararda yönetici (otomatik kararda boş)
  moderator_id uuid references auth.users(id) on delete set null,
  provider text not null,
  decision text not null
    constraint content_moderation_events_decision_check
    check (decision in ('safe', 'flagged', 'rejected')),
  reasons text[] not null default '{}',
  scores jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.content_moderation_events enable row level security;
revoke all on public.content_moderation_events from anon, authenticated;

create index content_moderation_events_subject_idx
  on public.content_moderation_events (subject_type, subject_id, created_at desc);

-- ---------------------------------------------------------------
-- 3) Temel metin filtresi (TS aynası: lib/text-moderation.ts)
-- ---------------------------------------------------------------
--
-- Küfür, taciz/tehdit, nefret söylemi ve yasa dışı teklifler için kelime
-- listesi. Kısa kökler yalnızca tam sözcük ('word'), çakışmayan uzun kökler
-- sözcük başından ('prefix') aranır: "ı" → "i" katlandığında "sık", "sıkıntı",
-- "canımı sıktı" küfürle çakışmasın. Liste ve sadeleştirme kuralı TS ile
-- birebir aynı olmalı; lib/content-moderation-rls.test.ts ikisini karşılaştırır.

create or replace function public.fn_moderation_terms()
returns table (ord integer, term text, match_kind text, category text)
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select * from (values
      (1, 'amk', 'word', 'profanity'),
      (2, 'amq', 'word', 'profanity'),
      (3, 'aq', 'word', 'profanity'),
      (4, 'yarak', 'word', 'profanity'),
      (5, 'yaragi', 'word', 'profanity'),
      (6, 'yaragim', 'word', 'profanity'),
      (7, 'pic', 'word', 'profanity'),
      (8, 'pust', 'word', 'profanity'),
      (9, 'gotune', 'word', 'profanity'),
      (10, 'gotunu', 'word', 'profanity'),
      (11, 'fck', 'word', 'profanity'),
      (12, 'slut', 'word', 'profanity'),
      (13, 'sikerim', 'word', 'profanity'),
      (14, 'sikeyim', 'word', 'profanity'),
      (15, 'sikiyim', 'word', 'profanity'),
      (16, 'sikecem', 'word', 'profanity'),
      (17, 'sikicem', 'word', 'profanity'),
      (18, 'sikerler', 'word', 'profanity'),
      (19, 'sikik', 'word', 'profanity'),
      (20, 'amina ko', 'prefix', 'profanity'),
      (21, 'aminako', 'prefix', 'profanity'),
      (22, 'amcik', 'prefix', 'profanity'),
      (23, 'amcig', 'prefix', 'profanity'),
      (24, 'siktir', 'prefix', 'profanity'),
      (25, 'siktig', 'prefix', 'profanity'),
      (26, 'orospu', 'prefix', 'profanity'),
      (27, 'orosbu', 'prefix', 'profanity'),
      (28, 'orspu', 'prefix', 'profanity'),
      (29, 'orusbu', 'prefix', 'profanity'),
      (30, 'dalyarak', 'prefix', 'profanity'),
      (31, 'yarak kafa', 'prefix', 'profanity'),
      (32, 'pezeven', 'prefix', 'profanity'),
      (33, 'kahpe', 'prefix', 'profanity'),
      (34, 'kaltak', 'prefix', 'profanity'),
      (35, 'gavat', 'prefix', 'profanity'),
      (36, 'yavsak', 'prefix', 'profanity'),
      (37, 'ibne', 'prefix', 'profanity'),
      (38, 'serefsiz', 'prefix', 'profanity'),
      (39, 'gotveren', 'prefix', 'profanity'),
      (40, 'got veren', 'prefix', 'profanity'),
      (41, 'gotlek', 'prefix', 'profanity'),
      (42, 'fuck', 'prefix', 'profanity'),
      (43, 'motherfuck', 'prefix', 'profanity'),
      (44, 'bitch', 'prefix', 'profanity'),
      (45, 'cunt', 'prefix', 'profanity'),
      (46, 'whore', 'prefix', 'profanity'),
      (47, 'ashole', 'prefix', 'profanity'),
      (48, 'niga', 'word', 'hate'),
      (49, 'nigas', 'word', 'hate'),
      (50, 'fagot', 'word', 'hate'),
      (51, 'oldurecegim', 'word', 'harassment'),
      (52, 'oldururum', 'word', 'harassment'),
      (53, 'olduresim', 'word', 'harassment'),
      (54, 'seni oldur', 'prefix', 'harassment'),
      (55, 'gebert', 'prefix', 'harassment'),
      (56, 'kafani kes', 'prefix', 'harassment'),
      (57, 'kafani kir', 'prefix', 'harassment'),
      (58, 'evini yak', 'prefix', 'harassment'),
      (59, 'kendini oldur', 'prefix', 'harassment'),
      (60, 'tecavuz', 'prefix', 'harassment'),
      (61, 'irzina', 'prefix', 'harassment'),
      (62, 'ciplak foto', 'prefix', 'harassment'),
      (63, 'ciplak resim', 'prefix', 'harassment'),
      (64, 'esrar', 'word', 'illegal'),
      (65, 'skunk', 'word', 'illegal'),
      (66, 'uyusturucu', 'prefix', 'illegal'),
      (67, 'kokain', 'prefix', 'illegal'),
      (68, 'eroin', 'prefix', 'illegal'),
      (69, 'metamfetamin', 'prefix', 'illegal'),
      (70, 'bonzai', 'prefix', 'illegal'),
      (71, 'ekstazi', 'prefix', 'illegal'),
      (72, 'extasy', 'prefix', 'illegal'),
      (73, 'ecstasy', 'prefix', 'illegal'),
      (74, 'captagon', 'prefix', 'illegal'),
      (75, 'kaptagon', 'prefix', 'illegal'),
      (76, 'silah sat', 'prefix', 'illegal'),
      (77, 'satilik silah', 'prefix', 'illegal'),
      (78, 'ruhsatsiz silah', 'prefix', 'illegal'),
      (79, 'tabanca sat', 'prefix', 'illegal'),
      (80, 'satilik tabanca', 'prefix', 'illegal'),
      (81, 'mermi sat', 'prefix', 'illegal'),
      (82, 'sahte plaka', 'prefix', 'illegal'),
      (83, 'sahte ruhsat', 'prefix', 'illegal'),
      (84, 'sahte belge', 'prefix', 'illegal'),
      (85, 'sahte ehliyet', 'prefix', 'illegal'),
      (86, 'sahte kimlik', 'prefix', 'illegal'),
      (87, 'deneme bonusu', 'prefix', 'illegal'),
      (88, 'kacak bahis', 'prefix', 'illegal'),
      (89, 'yasadisi bahis', 'prefix', 'illegal'),
      (90, 'canli bahis', 'prefix', 'illegal')
  ) as t(ord, term, match_kind, category)
$function$;

-- Metni karşılaştırma biçimine getirir (TS: normalizeForModeration). Yalnızca
-- ASCII üzerinde çalışır; lower() yerine translate: sonuç yerel ayardan
-- (locale) bağımsızdır.
create or replace function public.fn_moderation_normalize(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path to ''
as $function$
declare
  v_text text;
  v_token text;
  v_run text := '';
  v_out text[] := array[]::text[];
begin
  if p_text is null then
    return '';
  end if;

  -- Türkçe harfler ve simge ikameleri, birleşen aksan işaretleri, büyük harf
  v_text := translate(p_text, 'İIıŞşĞğÜüÖöÇçÂâÎîÛû@$', 'iiissgguuooccaaiiuuas');
  v_text := regexp_replace(v_text, '[̀-ͯ]', '', 'g');
  v_text := translate(v_text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  v_text := btrim(regexp_replace(v_text, '[^a-z0-9]+', ' ', 'g'));
  if v_text = '' then
    return '';
  end if;

  foreach v_token in array string_to_array(v_text, ' ') loop
    -- Harf içeren sözcükte rakam → harf (s1kt1r); yıl, km, fiyat olduğu gibi kalır
    if v_token ~ '[a-z]' then
      v_token := translate(v_token, '0134579', 'oieastg');
    end if;
    -- Ayrı yazılmış tek harfler ("s i k t i r") birleşir
    if v_token ~ '^[a-z]$' then
      v_run := v_run || v_token;
      continue;
    end if;
    if length(v_run) >= 3 then
      v_out := v_out || v_run;
    elsif v_run <> '' then
      v_out := v_out || string_to_array(v_run, null);
    end if;
    v_run := '';
    v_out := v_out || v_token;
  end loop;
  if length(v_run) >= 3 then
    v_out := v_out || v_run;
  elsif v_run <> '' then
    v_out := v_out || string_to_array(v_run, null);
  end if;

  -- Tekrar eden harfler teke iner ("siiiktir")
  return array_to_string(
    array(select regexp_replace(t.token, '(.)\1+', '\1', 'g')
            from unnest(v_out) with ordinality as t(token, ord)
           order by t.ord),
    ' ');
end;
$function$;

-- Metnin ihlal ettiği ilk kategori; temizse null (TS: textModerationCategory)
create or replace function public.fn_moderation_text_category(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path to ''
as $function$
declare
  v_padded text;
  v_term record;
begin
  if p_text is null or p_text = '' then
    return null;
  end if;
  v_padded := ' ' || public.fn_moderation_normalize(p_text) || ' ';
  if length(v_padded) <= 2 then
    return null;
  end if;
  for v_term in select t.term, t.match_kind, t.category from public.fn_moderation_terms() t order by t.ord loop
    if strpos(v_padded, case when v_term.match_kind = 'word' then ' ' || v_term.term || ' ' else ' ' || v_term.term end) > 0 then
      return v_term.category;
    end if;
  end loop;
  return null;
end;
$function$;

-- ---------------------------------------------------------------
-- 4) Mesajlar: filtreye takılan mesaj yazılmaz
-- ---------------------------------------------------------------
--
-- Uygulama mesajı /api/messages üzerinden gönderir (orada ayrıca OpenAI
-- denetimi var), ama messages_insert_participant kullanıcının tabloya doğrudan
-- yazmasına da izin verir. Bu tetikleyici her iki yolda da aynı taban kuralı
-- uygular. trg_messages_before_insert'ten (boşluk kırpma, hız sınırı) sonra
-- çalışır: aynı olaydaki BEFORE tetikleyicileri ada göre sıralanır.

create or replace function public.fn_messages_text_filter()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if public.fn_moderation_text_category(new.text) is not null then
    raise exception 'Mesajın topluluk kurallarına aykırı ifadeler içeriyor. Düzenleyip tekrar gönder.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create trigger trg_messages_text_filter
  before insert or update of text on public.messages
  for each row execute function public.fn_messages_text_filter();

-- ---------------------------------------------------------------
-- 5) Kullanıcının yazdığı marka/model adları ilanda görünür
-- ---------------------------------------------------------------

create or replace function public.fn_catalog_name_filter()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.is_user_created and public.fn_moderation_text_category(new.name) is not null then
    raise exception 'Bu marka ya da model adı kullanılamaz.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create trigger trg_brands_name_filter
  before insert or update of name on public.brands
  for each row execute function public.fn_catalog_name_filter();

create trigger trg_models_name_filter
  before insert or update of name on public.models
  for each row execute function public.fn_catalog_name_filter();

-- ---------------------------------------------------------------
-- 6) vehicles: denetim alanlarını ve ilan metnini kullanıcıya karşı koru
-- ---------------------------------------------------------------
--
-- vehicles_update_own satıcının kendi satırını doğrudan yazmasına izin veriyor
-- (tablo düzeyinde UPDATE yetkisi; bkz. *_harden_listing_rls.sql). Kurallar,
-- yalnızca kullanıcı isteklerinde (JWT rolü ya da oturum rolü anon/authenticated):
--   * Yeni ilan her zaman denetim 'pending' ile açılır (istemci ne gönderirse göndersin).
--   * Denetim alanları kullanıcı tarafından değiştirilemez.
--   * Açıklama, ilan denetime girdikten sonra değiştirilemez: onaylanan metin
--     yayında kalan metindir. Denetim ilanı önce 'pending_moderation'a alır,
--     sonra metni okur (lib/listing-moderation.ts).
--   * Açıklama, şehir ve renk temel metin filtresinden geçmeli.
-- Sunucu yolları (servis anahtarı, veritabanı yöneticisi) kısıtlanmaz.
--
-- Aynı olaydaki BEFORE tetikleyicileri ada göre çalışır: trg_vehicles_check_publishable
-- bundan önce çalışsa bile, sahte bir 'approved' değeri burada tüm isteği düşürür.

create or replace function public.fn_guard_vehicle_content()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated')
     and current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.moderation_status := 'pending';
    new.moderation_reason := null;
    new.moderated_at := null;
  else
    if new.moderation_status is distinct from old.moderation_status
       or new.moderation_reason is distinct from old.moderation_reason
       or new.moderated_at is distinct from old.moderated_at then
      raise exception 'İlanın denetim bilgisi değiştirilemez.'
        using errcode = 'insufficient_privilege';
    end if;

    if new.description is distinct from old.description
       and old.status not in ('draft', 'pending_video') then
      raise exception 'İlan açıklaması içerik denetiminden sonra değiştirilemez.'
        using errcode = 'check_violation';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.description is distinct from old.description)
       and public.fn_moderation_text_category(new.description) is not null
     or (tg_op = 'INSERT' or new.city is distinct from old.city)
       and public.fn_moderation_text_category(new.city) is not null
     or (tg_op = 'INSERT' or new.color is distinct from old.color)
       and public.fn_moderation_text_category(new.color) is not null then
    raise exception 'İlan metni topluluk kurallarına aykırı ifadeler içeriyor.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

create trigger trg_vehicles_guard_content
  before insert or update on public.vehicles
  for each row execute function public.fn_guard_vehicle_content();

-- ---------------------------------------------------------------
-- 7) Yayın şartı: işlenmiş video + onaylanmış içerik
-- ---------------------------------------------------------------
--
-- İsteği kim yaparsa yapsın (satıcı, servis anahtarı, yönetici) ilan yalnızca
-- içerik denetimi 'approved' ise 'active' olur. Böylece satıcı, denetimi
-- beklerken arşive aldığı ilanı "Yayına al" ile denetimsiz yayınlayamaz; sunucu
-- da ilanı, denetim kararını aynı güncellemede yazmadan yayına alamaz.
-- Video şartı *_harden_listing_rls.sql'deki gibi.

create or replace function public.fn_check_vehicle_publishable()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new; -- zaten yayında; sadece yayına geçiş anı denetlenir
  end if;

  if not exists (
       select 1 from public.videos x
        where x.vehicle_id = new.id
          and x.status = 'ready'
          and x.hls_url is not null
     ) then
    raise exception 'İlan yayınlanamadı: videosu henüz işlenmedi. Video hazır olduktan sonra tekrar dene.'
      using errcode = 'check_violation';
  end if;

  if new.moderation_status is distinct from 'approved' then
    raise exception 'İlan yayınlanamadı: içerik denetimi henüz tamamlanmadı.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------
-- 8) vehicle_images: fotoğraf yalnızca denetimden önce eklenir ya da değişir
-- ---------------------------------------------------------------
--
-- Storage tarafı zaten böyle (fn_can_upload_vehicle_photo: ilan draft ya da
-- pending_video). Ama klasöre yüklenmiş, listede olmayan bir dosya onaydan
-- sonra vehicle_images'a eklenebilirdi; denetlenmemiş bir fotoğraf yayına
-- girerdi. Artık satır yalnızca ilan denetime girmeden eklenir/güncellenir.
-- Adres kuralı (fn_is_vehicle_photo_url) aynen kalır.

drop policy if exists vehicle_images_insert_own_vehicle on public.vehicle_images;
drop policy if exists vehicle_images_update_own_vehicle on public.vehicle_images;

create policy vehicle_images_insert_own_vehicle
  on public.vehicle_images
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and v.seller_id = (select auth.uid())
         and v.status in ('draft', 'pending_video')
    )
    and public.fn_is_vehicle_photo_url(vehicle_id, image_url)
  );

create policy vehicle_images_update_own_vehicle
  on public.vehicle_images
  for update
  to authenticated
  using (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and v.seller_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_images.vehicle_id
         and v.seller_id = (select auth.uid())
         and v.status in ('draft', 'pending_video')
    )
    and public.fn_is_vehicle_photo_url(vehicle_id, image_url)
  );

-- Son denetim: adres kuralını ya da durum şartını içermeyen başka bir yazma
-- politikası kalmamalı (politikalar OR ile birleşir; tek bir gevşek politika
-- hepsini geçersiz kılar).
do $$
declare
  v_loose text;
begin
  select string_agg(p.policyname || ' (' || p.cmd || ')', ', ')
    into v_loose
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = 'vehicle_images'
     and p.cmd in ('INSERT', 'UPDATE', 'ALL')
     and p.permissive = 'PERMISSIVE'
     and (coalesce(p.with_check, p.qual, '') not like '%fn_is_vehicle_photo_url%'
          or coalesce(p.with_check, p.qual, '') not like '%pending_video%');

  if v_loose is not null then
    raise exception 'vehicle_images üzerinde denetim şartı olmayan yazma politikaları var: %', v_loose;
  end if;
end $$;
