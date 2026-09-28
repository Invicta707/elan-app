// Test (deneme) ilanları açar: vitrin, filtreler ve vitrin penceresindeki ↑/↓
// gerçek veriyle denensin diye yöneticinin hesabına 5 ilan (BMW 320i, Mercedes
// C200, Fiat Egea, Renault Megane, Toyota Corolla).
//
//   node scripts/seed-test-listings.mjs --seller <kullanıcı-uuid> [--dry-run] [--force]
//   node scripts/seed-test-listings.mjs --refresh-media [--dry-run]
//
// Her ilan vehicles.is_test = true: kartta, pencerede ve akışta "Test ilanı"
// etiketiyle görünür; yönetim panelinden (Moderasyon → Test ilanları) tek
// düğmeyle videosu, fotoğrafları ve bağlı kayıtlarıyla silinir
// (supabase/migrations/20260928200000_test_listings.sql).
//
// Medya burada üretilir ve açıkça "TEST İLANI" yazar: sharp ile SVG'den kapak ve
// 3 fotoğraf (1200×900 JPEG), ffmpeg ile kapaktan 8 sn'lik dikey video
// (720×1280, H.264). Görseller sade: düz, ilana özgü tonda zemin ve üst
// üçte birde yazı; ortası (vitrin kartının oynat işareti) ve altı (Shorts
// oynatıcısının satıcı / başlık / fiyat şeridi) boş, çizim yok. Video
// Cloudflare Stream'e yüklenir; işlenince (ready)
// uygulamanın webhook'u bu uid'yi tanımadığı için yok sayar. İlanın video satırı
// ancak ondan sonra (ready + WEBHOOK_GRACE_MS) yazılır, yoksa webhook ilanı
// yeniden denetime sokardı. Sonra ilan onaylı ve yayında olur.
//
// Anahtarlar .env.local'den okunur (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) ve
// hiçbir yere yazdırılmaz. --dry-run yalnızca medyayı üretir (yükleme ve
// veritabanı yok). Test ilanı zaten varsa --force verilmedikçe durur.
//
// --refresh-media: yayındaki test ilanlarının (marka/model ile eşleşen) videosunu
// ve fotoğraflarını yeniden üretilen medyayla değiştirir; ilan kimlikleri, yorumlar
// ve diğer kayıtlar kalır. Yeni video hazır olup webhook'u yok sayıldıktan sonra
// video satırı yeni uid'ye geçer, fotoğraflar boş sıra numaralarına yüklenip
// satırlar yeni adrese çevrilir; en son eski Cloudflare videoları ve eski
// fotoğraf dosyaları KALICI olarak silinir.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const PHOTO_BUCKET = "vehicle-photos";
const WEBHOOK_GRACE_MS = 60_000;
const READY_TIMEOUT_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const LISTINGS = [
  {
    slug: "bmw-320i",
    brand: "bmw",
    model: "3-serisi",
    headline: "BMW 320i",
    year: 2019,
    price: 1_450_000,
    mileageKm: 78_000,
    fuel: "benzin",
    transmission: "otomatik",
    body: "sedan",
    color: "Beyaz",
    city: "İstanbul",
    tramer: 0,
    painted: 0,
    changed: 0,
    tint: "#1E3A8A",
    ageDays: 0,
  },
  {
    slug: "mercedes-c200",
    brand: "mercedes-benz",
    model: "c-serisi",
    headline: "Mercedes C200",
    year: 2018,
    price: 1_690_000,
    mileageKm: 96_000,
    fuel: "benzin",
    transmission: "otomatik",
    body: "sedan",
    color: "Siyah",
    city: "Ankara",
    tramer: 12_500,
    painted: 2,
    changed: 0,
    // Boya / değişen şeması (expertise_summary.parts): sayılarla tutarlı
    parts: { front_bumper: "local_paint", hood: "painted" },
    tint: "#3F3F46",
    ageDays: 1,
  },
  {
    slug: "fiat-egea",
    brand: "fiat",
    model: "egea",
    headline: "Fiat Egea 1.3 Multijet",
    year: 2021,
    price: 685_000,
    mileageKm: 42_000,
    fuel: "dizel",
    transmission: "manuel",
    body: "sedan",
    color: "Gri",
    city: "Bursa",
    tramer: 0,
    painted: 0,
    changed: 0,
    tint: "#7F1D1D",
    ageDays: 2,
  },
  {
    slug: "renault-megane",
    brand: "renault",
    model: "megane",
    headline: "Renault Megane 1.5 dCi",
    year: 2020,
    price: 845_000,
    mileageKm: 61_000,
    fuel: "dizel",
    transmission: "otomatik",
    body: "hatchback",
    color: "Mavi",
    city: "İzmir",
    tramer: 4_800,
    painted: 1,
    changed: 1,
    parts: { right_front_door: "painted", trunk: "changed" },
    tint: "#0F3D5E",
    ageDays: 3,
  },
  {
    slug: "toyota-corolla",
    brand: "toyota",
    model: "corolla",
    headline: "Toyota Corolla Hybrid",
    year: 2022,
    price: 1_120_000,
    mileageKm: 25_000,
    fuel: "hibrit",
    transmission: "otomatik",
    body: "sedan",
    color: "Kırmızı",
    city: "Antalya",
    tramer: 0,
    painted: 0,
    changed: 0,
    tint: "#14532D",
    ageDays: 5,
  },
];

const FUEL = { benzin: "Benzin", dizel: "Dizel", lpg: "LPG", hibrit: "Hibrit", elektrik: "Elektrik" };
const GEAR = { manuel: "Manuel", otomatik: "Otomatik" };

// ---------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false, force: false, refresh: false, seller: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--force") args.force = true;
    else if (argv[i] === "--refresh-media") args.refresh = true;
    else if (argv[i] === "--seller") args.seller = argv[++i] ?? null;
  }
  return args;
}

function readEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const amount = (value) => new Intl.NumberFormat("tr-TR").format(value);
const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------
// Medya
// ---------------------------------------------------------------

const FONT = "Segoe UI, Arial, sans-serif";

/** "TEST İLANI" etiketi: aralıklı büyük harf, yarı saydam beyaz (kapakta çizim ya da hap yok) */
function testLabel(x, y, fontSize) {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fontSize}" letter-spacing="${Math.round(fontSize * 0.18)}" fill="#FFFFFF" fill-opacity="0.72">TEST İLANI</text>`;
}

/** Dikey kapak (videonun kendisi): düz tonlu zemin, yazılar üst üçte birde */
function posterSvg(listing) {
  const facts = `${listing.year} · ${amount(listing.mileageKm)} km · ${listing.city}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    <rect width="1080" height="1920" fill="#121212" />
    <rect width="1080" height="1920" fill="${listing.tint}" opacity="0.35" />
    ${testLabel(540, 300, 40)}
    <text x="540" y="430" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${listing.headline.length > 14 ? 88 : 112}" fill="#FFFFFF">${escapeXml(listing.headline)}</text>
    <text x="540" y="520" text-anchor="middle" font-family="${FONT}" font-size="52" fill="#E4E4E7">${escapeXml(facts)}</text>
  </svg>`;
}

/** Yatay fotoğraf (4:3): düz tonlu zemin, yazılar ortada */
function photoSvg(listing, view) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <rect width="1200" height="900" fill="#18181B" />
    <rect width="1200" height="900" fill="${listing.tint}" opacity="${view.tintOpacity}" />
    ${testLabel(600, 360, 34)}
    <text x="600" y="460" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="68" fill="#FFFFFF">${escapeXml(`${listing.headline} · ${listing.year}`)}</text>
    <text x="600" y="530" text-anchor="middle" font-family="${FONT}" font-size="36" fill="#D4D4D8">${escapeXml(view.label)} · gözüyle vitrin denemesi</text>
  </svg>`;
}

const PHOTO_VIEWS = [
  { label: "Yan görünüm", tintOpacity: 0.35 },
  { label: "Diğer yan", tintOpacity: 0.22 },
  { label: "İç mekân", tintOpacity: 0.15 },
];

async function buildMedia(listing, dir) {
  const poster = join(dir, `${listing.slug}-poster.png`);
  await sharp(Buffer.from(posterSvg(listing))).png().toFile(poster);

  const video = join(dir, `${listing.slug}.mp4`);
  // Kapaktan 8 sn: yavaş yakınlaşma (hareketli önizleme görünsün; ilerleme şeridi oynatıcıda)
  execFileSync(
    process.env.FFMPEG ?? "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      poster,
      "-vf",
      "zoompan=z='min(zoom+0.0006,1.14)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=240:s=720x1280:fps=30,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-movflags",
      "+faststart",
      "-an",
      video,
    ],
    { stdio: "inherit" },
  );

  const photos = [];
  for (const [index, view] of PHOTO_VIEWS.entries()) {
    const buffer = await sharp(Buffer.from(photoSvg(listing, view))).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    const file = join(dir, `${listing.slug}-${index}.jpeg`);
    writeFileSync(file, buffer);
    photos.push({ file, buffer });
  }
  return { poster, video, photos };
}

// ---------------------------------------------------------------
// Cloudflare Stream
// ---------------------------------------------------------------

async function cloudflare(env, path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new Error(`Cloudflare ${response.status}: ${body?.errors?.map((error) => error.message).join("; ") ?? "yanıt okunamadı"}`);
  }
  return body.result;
}

async function uploadVideo(env, listing, file) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)], { type: "video/mp4" }), `${listing.slug}.mp4`);
  const result = await cloudflare(env, "", { method: "POST", body: form });
  await cloudflare(env, `/${result.uid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: result.uid, meta: { name: `gozuyle-test-${listing.slug}` }, thumbnailTimestampPct: 0.35 }),
  });
  return result.uid;
}

async function deleteVideo(env, uid) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  // 404: zaten yok
  if (!response.ok && response.status !== 404) throw new Error(`Cloudflare videosu silinemedi (${response.status}): ${uid}`);
}

async function waitUntilReady(env, uid) {
  const started = Date.now();
  for (;;) {
    const video = await cloudflare(env, `/${uid}`);
    if (video.status?.state === "error") throw new Error(`Cloudflare videoyu işleyemedi: ${uid} ${video.status?.errorReasonCode ?? ""}`);
    if (video.readyToStream && video.playback?.hls) return video;
    if (Date.now() - started > READY_TIMEOUT_MS) throw new Error(`Video zamanında hazır olmadı: ${uid}`);
    await sleep(5_000);
  }
}

// ---------------------------------------------------------------
// Akış
// ---------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = join(tmpdir(), `gozuyle-seed-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  console.log(`Medya üretiliyor: ${dir}`);
  const media = [];
  for (const listing of LISTINGS) {
    media.push(await buildMedia(listing, dir));
    console.log(`  ✓ ${listing.headline}`);
  }
  if (args.dryRun) {
    console.log("--dry-run: yükleme ve veritabanı atlandı.");
    return;
  }

  const env = readEnv(".env.local");
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
    if (!env[key]) throw new Error(`.env.local: ${key} tanımlı değil.`);
  }
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  if (args.refresh) {
    await refreshMedia(env, supabase, media);
    return;
  }
  if (!args.seller || !/^[0-9a-f-]{36}$/i.test(args.seller)) throw new Error("--seller <kullanıcı-uuid> gerekli.");

  const { count, error: countError } = await supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("is_test", true);
  if (countError) throw countError;
  if (count && !args.force) throw new Error(`Zaten ${count} test ilanı var. Yenilerini eklemek için --force (ya da önce panelden sil).`);

  const { data: profile, error: profileError } = await supabase.from("profiles").select("id, username").eq("id", args.seller).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error("Satıcının profili yok.");
  console.log(`Satıcı: @${profile.username ?? "-"}`);

  const [{ data: brands, error: brandError }, { data: models, error: modelError }] = await Promise.all([
    supabase.from("brands").select("id, slug").eq("is_user_created", false),
    supabase.from("models").select("id, brand_id, slug").eq("is_user_created", false),
  ]);
  if (brandError || modelError) throw brandError ?? modelError;

  // 1) Videolar Cloudflare'e (işlenirken ilan ve fotoğraflar açılır)
  const uploads = [];
  for (const [index, listing] of LISTINGS.entries()) {
    const uid = await uploadVideo(env, listing, media[index].video);
    uploads.push(uid);
    console.log(`  ↑ video ${listing.headline}: ${uid}`);
  }

  // 2) İlan (taslak) + fotoğraflar
  const created = [];
  for (const [index, listing] of LISTINGS.entries()) {
    const brand = brands.find((row) => row.slug === listing.brand);
    const model = brand && models.find((row) => row.brand_id === brand.id && row.slug === listing.model);
    if (!brand || !model) throw new Error(`Katalogda yok: ${listing.brand}/${listing.model}`);

    const description =
      `Bu ilan test amaçlıdır: gözüyle vitrinini, filtrelerini ve ilan penceresini denemek için yönetici tarafından eklendi. ` +
      `Araç satılık değildir; ilan yönetim panelinden silinecektir.\n\n` +
      `${listing.headline} · ${listing.year} · ${amount(listing.mileageKm)} km · ${FUEL[listing.fuel]} · ${GEAR[listing.transmission]} · ${listing.color}`;

    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .insert({
        seller_id: args.seller,
        brand_id: brand.id,
        model_id: model.id,
        year: listing.year,
        price: listing.price,
        currency: "TRY",
        mileage_km: listing.mileageKm,
        fuel_type: listing.fuel,
        transmission: listing.transmission,
        body_type: listing.body,
        color: listing.color,
        city: listing.city,
        description,
        tramer_amount: listing.tramer,
        painted_parts_count: listing.painted,
        changed_parts_count: listing.changed,
        expertise_summary: listing.parts ? { parts: listing.parts } : {},
        has_heavy_damage: false,
        status: "draft",
        is_test: true,
        created_at: new Date(Date.now() - listing.ageDays * DAY_MS - index * 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    const bucket = supabase.storage.from(PHOTO_BUCKET);
    for (const [order, photo] of media[index].photos.entries()) {
      const path = `${vehicle.id}/${order}.jpeg`;
      const { error: uploadError } = await bucket.upload(path, photo.buffer, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;
      const { error: imageError } = await supabase.from("vehicle_images").insert({
        vehicle_id: vehicle.id,
        image_url: bucket.getPublicUrl(path).data.publicUrl,
        is_primary: order === 0,
        display_order: order,
      });
      if (imageError) throw imageError;
    }
    created.push(vehicle.id);
    console.log(`  + ilan ${listing.headline}: ${vehicle.id} (${media[index].photos.length} fotoğraf)`);
  }

  // 3) Video hazır + webhook'un yok sayması için bekleme → video satırı, onay, yayın
  for (const [index, listing] of LISTINGS.entries()) {
    const video = await waitUntilReady(env, uploads[index]);
    const readyAt = Date.parse(video.readyToStreamAt ?? video.modified ?? new Date().toISOString());
    const wait = readyAt + WEBHOOK_GRACE_MS - Date.now();
    if (wait > 0) {
      console.log(`  … ${listing.headline}: webhook için ${Math.ceil(wait / 1000)} sn bekleniyor`);
      await sleep(wait);
    }

    const { error: videoError } = await supabase.from("videos").insert({
      vehicle_id: created[index],
      stream_uid: uploads[index],
      hls_url: video.playback.hls,
      thumbnail_url: video.thumbnail ?? null,
      duration_seconds: typeof video.duration === "number" && video.duration > 0 ? Math.round(video.duration) : null,
      status: "ready",
      order_index: 0,
    });
    if (videoError) throw videoError;

    const { error: publishError } = await supabase
      .from("vehicles")
      .update({ moderation_status: "approved", moderated_at: new Date().toISOString(), status: "active" })
      .eq("id", created[index])
      .eq("is_test", true);
    if (publishError) throw publishError;
    console.log(`  ✓ yayında ${listing.headline}: /vehicles/${created[index]}`);
  }

  console.log(`\n${created.length} test ilanı yayında. Silmek için: /admin/reports → Test ilanları.`);
}

// ---------------------------------------------------------------
// Yayındaki test ilanlarının medyasını yenileme (--refresh-media)
// ---------------------------------------------------------------

/** vehicle-photos adresinden bucket içi yol: "<ilan>/<sıra>.<uzantı>" */
function photoPath(url, vehicleId) {
  const marker = `/${PHOTO_BUCKET}/`;
  const at = url.indexOf(marker);
  const path = at === -1 ? null : url.slice(at + marker.length);
  if (!path || !path.startsWith(`${vehicleId}/`)) throw new Error(`Beklenmeyen fotoğraf adresi: ${url}`);
  return path;
}

async function refreshMedia(env, supabase, media) {
  const { data: rows, error } = await supabase
    .from("vehicles")
    .select("id, brands(slug), models(slug), videos(id, stream_uid), vehicle_images(id, image_url, display_order)")
    .eq("is_test", true);
  if (error) throw error;

  // Her test ilanı LISTINGS'teki bir girdiyle marka/model üzerinden eşleşmeli
  const plan = rows.map((row) => {
    const index = LISTINGS.findIndex((item) => item.brand === row.brands?.slug && item.model === row.models?.slug);
    if (index === -1) throw new Error(`Eşleşmeyen test ilanı: ${row.id}`);
    if ((row.videos ?? []).length !== 1) throw new Error(`Test ilanının tek videosu olmalı: ${row.id}`);
    const images = [...(row.vehicle_images ?? [])].sort((a, b) => a.display_order - b.display_order);
    if (images.length !== media[index].photos.length) throw new Error(`Fotoğraf sayısı farklı: ${row.id}`);
    return { row, index, listing: LISTINGS[index], images, oldVideo: row.videos[0] };
  });
  if (new Set(plan.map((item) => item.index)).size !== plan.length) throw new Error("Aynı marka/model iki test ilanında.");
  console.log(`${plan.length} test ilanının medyası yenilenecek.`);

  // 1) Yeni videolar (işlenirken fotoğraflar değişir)
  for (const item of plan) {
    item.newUid = await uploadVideo(env, item.listing, media[item.index].video);
    console.log(`  ↑ video ${item.listing.headline}: ${item.newUid}`);
  }

  // 2) Fotoğraflar: boş sıra numaralarına yükle, satırları yeni adrese çevir
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  for (const item of plan) {
    const oldPaths = item.images.map((image) => photoPath(image.image_url, item.row.id));
    const used = new Set(oldPaths.map((path) => Number(path.split("/")[1].split(".")[0])));
    const free = Array.from({ length: 10 }, (_, n) => n).filter((n) => !used.has(n));
    if (free.length < item.images.length) throw new Error(`Boş fotoğraf sırası yok: ${item.row.id}`);
    for (const [order, image] of item.images.entries()) {
      const path = `${item.row.id}/${free[order]}.jpeg`;
      const { error: uploadError } = await bucket.upload(path, media[item.index].photos[order].buffer, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error: imageError } = await supabase
        .from("vehicle_images")
        .update({ image_url: bucket.getPublicUrl(path).data.publicUrl })
        .eq("id", image.id);
      if (imageError) throw imageError;
    }
    item.oldPaths = oldPaths;
    console.log(`  + fotoğraflar ${item.listing.headline}: ${item.images.length}`);
  }

  // 3) Video hazır + webhook'un yok sayması için bekleme → video satırı yeni uid'ye
  for (const item of plan) {
    const video = await waitUntilReady(env, item.newUid);
    const readyAt = Date.parse(video.readyToStreamAt ?? video.modified ?? new Date().toISOString());
    const wait = readyAt + WEBHOOK_GRACE_MS - Date.now();
    if (wait > 0) {
      console.log(`  … ${item.listing.headline}: webhook için ${Math.ceil(wait / 1000)} sn bekleniyor`);
      await sleep(wait);
    }
    const { error: videoError } = await supabase
      .from("videos")
      .update({
        stream_uid: item.newUid,
        hls_url: video.playback.hls,
        thumbnail_url: video.thumbnail ?? null,
        duration_seconds: typeof video.duration === "number" && video.duration > 0 ? Math.round(video.duration) : null,
        status: "ready",
      })
      .eq("id", item.oldVideo.id);
    if (videoError) throw videoError;
    console.log(`  ✓ video yenilendi ${item.listing.headline}`);
  }

  // 4) Eski medya: Cloudflare videoları ve fotoğraf dosyaları kalıcı olarak silinir
  for (const item of plan) {
    await deleteVideo(env, item.oldVideo.stream_uid);
    const { error: removeError } = await bucket.remove(item.oldPaths);
    if (removeError) throw removeError;
    console.log(`  − eski medya silindi ${item.listing.headline}: video ${item.oldVideo.stream_uid}, ${item.oldPaths.length} fotoğraf`);
  }

  console.log(`\n${plan.length} test ilanının medyası yenilendi.`);
}

main().catch((error) => {
  console.error(`\nDurdu: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
