-- Kalıcı istek sınırı: sabit pencereli sayaç (ilk kullanıcı: /api/reports).
--
-- Bellek içi sınır (lib/rate-limit.ts) her Vercel sunucu örneğinde ayrı sayar
-- ve örnek yeniden başlayınca sıfırlanır. Bu sayaç veritabanında tutulduğu
-- için bütün örnekler için ortaktır.
--
-- Gizlilik (KVKK/GDPR): tabloya IP adresi ya da kullanıcı id'si düz yazılmaz.
-- Anahtar sunucuda, gizli anahtarla alınmış HMAC-SHA256 özetidir
-- (lib/rate-limit-server.ts rateLimitKey). Düz SHA-256 IPv4 için kaba kuvvetle
-- geri çözülebilirdi. Her satır penceresi bitince (en geç 24 saat) bir sonraki
-- çağrıda silinir.
--
-- Tabloya ve fonksiyona yalnızca sunucu (servis anahtarı) erişir.

create table public.rate_limits (
  key            text        not null check (char_length(key) <= 200),
  window_seconds integer     not null check (window_seconds > 0),
  window_start   timestamptz not null,
  expires_at     timestamptz not null,
  hits           integer     not null default 0,
  -- Aynı anahtar farklı pencerelerde (dakika, saat, gün) ayrı sayılır
  primary key (key, window_seconds, window_start)
);

create index rate_limits_expires_at_idx on public.rate_limits (expires_at);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- Her anahtar için sayacı bir artırır. Dönen değer: 0 → izin verildi;
-- > 0 → aşılan kuralların en geç biten penceresine kalan saniye (Retry-After).
-- Reddedilen istekler de sayılır: pencere bitene kadar sınırda kalınır.
-- p_now yalnızca testler içindir; uygulama göndermez.
create or replace function public.fn_rate_limit_hit(
  p_keys           text[],
  p_limits         integer[],
  p_window_seconds integer[],
  p_now            timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count        integer := coalesce(array_length(p_keys, 1), 0);
  v_retry        integer := 0;
  v_window_start timestamptz;
  v_expires_at   timestamptz;
  v_hits         integer;
begin
  if v_count = 0
     or coalesce(array_length(p_limits, 1), 0) <> v_count
     or coalesce(array_length(p_window_seconds, 1), 0) <> v_count then
    raise exception 'fn_rate_limit_hit: anahtar, sınır ve pencere dizileri aynı uzunlukta olmalı.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Süresi dolan sayaçlar: kişisel veri gereğinden uzun tutulmaz
  delete from public.rate_limits where expires_at <= p_now;

  for i in 1 .. v_count loop
    if p_keys[i] is null or p_limits[i] is null or p_limits[i] < 1
       or p_window_seconds[i] is null or p_window_seconds[i] < 1 then
      raise exception 'fn_rate_limit_hit: geçersiz kural (#%).', i
        using errcode = 'invalid_parameter_value';
    end if;

    v_window_start := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds[i]) * p_window_seconds[i]);
    v_expires_at := v_window_start + make_interval(secs => p_window_seconds[i]);

    insert into public.rate_limits as r (key, window_seconds, window_start, expires_at, hits)
    values (p_keys[i], p_window_seconds[i], v_window_start, v_expires_at, 1)
    on conflict (key, window_seconds, window_start) do update set hits = r.hits + 1
    returning r.hits into v_hits;

    if v_hits > p_limits[i] then
      v_retry := greatest(v_retry, 1, ceil(extract(epoch from v_expires_at - p_now))::integer);
    end if;
  end loop;

  return v_retry;
end;
$function$;

revoke execute on function public.fn_rate_limit_hit(text[], integer[], integer[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_rate_limit_hit(text[], integer[], integer[], timestamptz) to service_role;
