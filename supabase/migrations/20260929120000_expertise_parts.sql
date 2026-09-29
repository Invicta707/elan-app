-- Boya / değişen şeması: vehicles.expertise_summary.parts.
--
-- Satıcı /sell'de aracın üstten şemasında parçaların durumunu seçer; ilan
-- şu biçimle yazılır (lib/body-parts.ts expertiseSummary):
--   { "parts": { "hood": "painted", "front_bumper": "local_paint", ... } }
-- Yalnızca orijinal olmayan parçalar yazılır; listede olmayan parça orijinaldir.
-- Şema detay çekmecesinde ve mobil detay penceresinde okunur
-- (components/vehicle/BodyDiagram.tsx).
--
-- Kurallar:
--   * expertise_summary bir nesne olmalı; "parts" varsa yine nesne, anahtarları
--     13 parçadan biri, değerleri original | local_paint | painted | changed.
--     Diğer üst düzey anahtarlara dokunulmaz (ileride rapor özeti için).
--   * "parts" varsa boyalı ve değişen parça sayısı ondan türetilir: satıcının
--     ya da istemcinin yazdığı sayılar yok sayılır, şema ile rozetler hiçbir
--     zaman çelişmez. painted_parts_count = local_paint + painted,
--     changed_parts_count = changed. "parts" yoksa (eski ilanlar) sayılara
--     dokunulmaz.

-- ---------------------------------------------------------------
-- 1) Biçim denetimi
-- ---------------------------------------------------------------

create or replace function public.fn_expertise_summary_valid(p_summary jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_summary is null then true
    when jsonb_typeof(p_summary) <> 'object' then false
    when not (p_summary ? 'parts') then true
    when jsonb_typeof(p_summary -> 'parts') <> 'object' then false
    else not exists (
      select 1
        from jsonb_each(p_summary -> 'parts') as part(key, value)
       where part.key not in (
               'front_bumper', 'hood', 'roof', 'trunk', 'rear_bumper',
               'left_front_fender', 'left_front_door', 'left_rear_door', 'left_rear_fender',
               'right_front_fender', 'right_front_door', 'right_rear_door', 'right_rear_fender'
             )
          or jsonb_typeof(part.value) <> 'string'
          or (part.value #>> '{}') not in ('original', 'local_paint', 'painted', 'changed')
    )
  end
$function$;

grant execute on function public.fn_expertise_summary_valid(jsonb) to anon, authenticated, service_role;

alter table public.vehicles drop constraint if exists vehicles_expertise_summary_valid;
alter table public.vehicles
  add constraint vehicles_expertise_summary_valid check (public.fn_expertise_summary_valid(expertise_summary));

-- ---------------------------------------------------------------
-- 2) Sayılar parça listesinden
-- ---------------------------------------------------------------

create or replace function public.fn_vehicles_expertise_counts()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.expertise_summary ? 'parts' and jsonb_typeof(new.expertise_summary -> 'parts') = 'object' then
    select count(*) filter (where value #>> '{}' in ('local_paint', 'painted')),
           count(*) filter (where value #>> '{}' = 'changed')
      into new.painted_parts_count, new.changed_parts_count
      from jsonb_each(new.expertise_summary -> 'parts');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_vehicles_expertise_counts on public.vehicles;
create trigger trg_vehicles_expertise_counts
  before insert or update on public.vehicles
  for each row execute function public.fn_vehicles_expertise_counts();
