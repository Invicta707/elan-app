-- Marka / model kataloğu: Türkiye'de ikinci el ve sıfır pazarında yaygın
-- markalar ve seri düzeyinde modelleri. İlan formu (app/sell) ve arama
-- filtreleri bu tablolardan beslenir; slug'lar arama URL'sinde kullanılır
-- (/search?marka=volkswagen&model=passat).
--
-- Şema iki seviyeli (marka → model) olduğu için model = seri: "3 Serisi",
-- "Clio", "Egea". Donanım/motor (320i, 1.6 TDI) katalogda yer almaz.
--
-- Tekrar çalıştırılabilir: var olan marka (slug) ve model (marka + slug)
-- atlanır, mevcut kayıtlar değiştirilmez. Tek transaction içinde çalışır.

-- Slug: Türkçe karakterler ASCII'ye, harf/rakam dışındakiler tek tireye.
-- Geçici şemada: migration bitince kaybolur, veritabanında iz bırakmaz.
create function pg_temp.slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(value, 'ÇĞİÖŞÜçğıöşüËë', 'CGIOSUcgiosuEe')),
    '[^a-z0-9]+', '-', 'g'
  ))
$$;

-- 1) Test verisinden kalan donanım adları (seri değil). Hiçbir ilan
-- kullanmıyorsa kaldırılır; yerlerine aşağıda seri adları eklenir.
delete from public.models m
 using public.brands b
 where b.id = m.brand_id
   and (b.slug, m.slug) in (('bmw', '320i-m-sport'), ('porsche', '911-carrera-s'))
   and not exists (select 1 from public.vehicles v where v.model_id = m.id);

-- 2) Markalar
insert into public.brands (name, slug)
select name, pg_temp.slugify(name)
  from unnest(array[
    'Alfa Romeo', 'Audi', 'BMW', 'BYD', 'Chery', 'Chevrolet', 'Citroen',
    'Cupra', 'Dacia', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Jeep', 'Kia',
    'Land Rover', 'Lexus', 'Mazda', 'Mercedes-Benz', 'MG', 'Mini',
    'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Porsche', 'Renault', 'Seat',
    'Skoda', 'Suzuki', 'Tesla', 'Tofaş', 'Togg', 'Toyota', 'Volkswagen', 'Volvo'
  ]) as name
on conflict (slug) do nothing;

-- 3) Modeller (marka slug'ı → model adları)
insert into public.models (brand_id, name, slug)
select b.id, model.name, pg_temp.slugify(model.name)
  from (values
    ('alfa-romeo',    array['Giulia', 'Giulietta', 'MiTo', 'Stelvio', 'Tonale']),
    ('audi',          array['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q4 e-tron', 'Q5', 'Q7', 'Q8', 'TT']),
    ('bmw',           array['1 Serisi', '2 Serisi', '3 Serisi', '4 Serisi', '5 Serisi', '7 Serisi',
                            'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4', 'i4', 'iX', 'iX1']),
    ('byd',           array['Atto 3', 'Dolphin', 'Han', 'Seal', 'Seal U']),
    ('chery',         array['Omoda 5', 'Tiggo 4 Pro', 'Tiggo 7 Pro', 'Tiggo 8 Pro']),
    ('chevrolet',     array['Aveo', 'Captiva', 'Cruze', 'Kalos', 'Lacetti', 'Spark', 'Trax']),
    ('citroen',       array['Berlingo', 'C-Elysee', 'C3', 'C3 Aircross', 'C4', 'C4 X', 'C5 Aircross']),
    ('cupra',         array['Ateca', 'Born', 'Formentor', 'Leon']),
    ('dacia',         array['Dokker', 'Duster', 'Jogger', 'Lodgy', 'Logan', 'Sandero', 'Sandero Stepway', 'Spring']),
    ('fiat',          array['500', '500X', 'Albea', 'Bravo', 'Doblo', 'Egea', 'Egea Cross', 'Fiorino',
                            'Linea', 'Palio', 'Panda', 'Punto', 'Tipo']),
    ('ford',          array['B-Max', 'C-Max', 'EcoSport', 'Fiesta', 'Focus', 'Kuga', 'Mondeo', 'Mustang',
                            'Puma', 'Ranger', 'Tourneo Connect', 'Tourneo Courier', 'Tourneo Custom', 'Transit']),
    ('honda',         array['Accord', 'City', 'Civic', 'CR-V', 'HR-V', 'Jazz', 'ZR-V']),
    ('hyundai',       array['Accent', 'Accent Blue', 'Accent Era', 'Bayon', 'Elantra', 'Getz', 'i10', 'i20',
                            'i30', 'Ioniq', 'Kona', 'Santa Fe', 'Tucson']),
    ('jeep',          array['Avenger', 'Cherokee', 'Compass', 'Grand Cherokee', 'Renegade', 'Wrangler']),
    ('kia',           array['Ceed', 'Cerato', 'EV6', 'Niro', 'Picanto', 'Rio', 'Sorento', 'Sportage', 'Stonic', 'XCeed']),
    ('land-rover',    array['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Evoque',
                            'Range Rover Sport', 'Range Rover Velar']),
    ('lexus',         array['CT', 'ES', 'IS', 'NX', 'RX', 'UX']),
    ('mazda',         array['2', '3', '6', 'CX-3', 'CX-30', 'CX-5', 'MX-5']),
    ('mercedes-benz', array['A Serisi', 'B Serisi', 'C Serisi', 'CLA', 'CLS', 'E Serisi', 'EQA', 'EQB',
                            'G Serisi', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'S Serisi', 'Vito']),
    ('mg',            array['HS', 'MG4', 'ZS']),
    ('mini',          array['Clubman', 'Cooper', 'Countryman']),
    ('mitsubishi',    array['ASX', 'Colt', 'Eclipse Cross', 'L200', 'Lancer', 'Outlander', 'Space Star']),
    ('nissan',        array['Juke', 'Micra', 'Navara', 'Note', 'Qashqai', 'X-Trail']),
    ('opel',          array['Astra', 'Combo', 'Corsa', 'Crossland', 'Grandland', 'Insignia', 'Meriva',
                            'Mokka', 'Vectra', 'Zafira']),
    ('peugeot',       array['206', '207', '208', '301', '308', '408', '508', '2008', '3008', '5008',
                            'Partner', 'Rifter']),
    ('porsche',       array['718', '911', 'Cayenne', 'Macan', 'Panamera', 'Taycan']),
    ('renault',       array['Austral', 'Captur', 'Clio', 'Fluence', 'Kadjar', 'Kangoo', 'Koleos', 'Laguna',
                            'Megane', 'Scenic', 'Symbol', 'Taliant', 'Talisman', 'Twingo', 'Zoe']),
    ('seat',          array['Arona', 'Ateca', 'Ibiza', 'Leon', 'Tarraco', 'Toledo']),
    ('skoda',         array['Enyaq', 'Fabia', 'Kamiq', 'Karoq', 'Kodiaq', 'Octavia', 'Rapid', 'Scala', 'Superb']),
    ('suzuki',        array['Jimny', 'S-Cross', 'Swift', 'SX4', 'Vitara']),
    ('tesla',         array['Model 3', 'Model S', 'Model X', 'Model Y']),
    ('tofas',         array['Doğan', 'Kartal', 'Murat 131', 'Serçe', 'Şahin']),
    ('togg',          array['T10F', 'T10X']),
    ('toyota',        array['Auris', 'C-HR', 'Camry', 'Corolla', 'Corolla Cross', 'Hilux', 'Land Cruiser',
                            'Proace City', 'RAV4', 'Verso', 'Yaris', 'Yaris Cross']),
    ('volkswagen',    array['Amarok', 'Arteon', 'Caddy', 'Golf', 'ID.3', 'ID.4', 'Jetta', 'Passat', 'Polo',
                            'Scirocco', 'T-Cross', 'T-Roc', 'Taigo', 'Tiguan', 'Touareg', 'Transporter']),
    ('volvo',         array['EX30', 'S60', 'S80', 'S90', 'V40', 'V60', 'XC40', 'XC60', 'XC90'])
  ) as catalog(brand_slug, model_names)
  cross join lateral unnest(catalog.model_names) as model(name)
  join public.brands b on b.slug = catalog.brand_slug
on conflict (brand_id, slug) do nothing;

-- 4) Kontrol: modelsiz marka kalmasın. 3. adımdaki marka slug'ı yanlış
-- yazılırsa join o satırları sessizce atardı; bu durumda hiçbir şey uygulanmaz.
do $$
declare
  empty_brands text;
begin
  select string_agg(b.name, ', ' order by b.name)
    into empty_brands
    from public.brands b
   where not exists (select 1 from public.models m where m.brand_id = b.id);

  if empty_brands is not null then
    raise exception 'Modeli olmayan markalar: %', empty_brands;
  end if;
end $$;
