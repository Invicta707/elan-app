// Test (deneme) ilanları açar: vitrin, filtreler ve vitrin penceresindeki ↑/↓
// gerçek veriyle denensin diye yöneticinin hesabına 5 ilan (BMW 320i, Mercedes
// C200, Fiat Egea, Renault Megane, Toyota Corolla).
//
//   node scripts/seed-test-listings.mjs --seller <kullanıcı-uuid> [--dry-run] [--force]
//
// Her ilan vehicles.is_test = true: kartta, pencerede ve akışta "Test ilanı"
// etiketiyle görünür; yönetim panelinden (Moderasyon → Test ilanları) tek
// düğmeyle videosu, fotoğrafları ve bağlı kayıtlarıyla silinir
// (supabase/migrations/20260928200000_test_listings.sql).
//
// Medya burada üretilir ve açıkça "TEST İLANI" yazar: sharp ile SVG'den kapak ve
// 3 fotoğraf (1200×900 JPEG), ffmpeg ile kapaktan 8 sn'lik dikey video
// (720×1280, H.264). Video Cloudflare Stream'e yüklenir; işlenince (ready)
// uygulamanın webhook'u bu uid'yi tanımadığı için yok sayar. İlanın video satırı
// ancak ondan sonra (ready + WEBHOOK_GRACE_MS) yazılır, yoksa webhook ilanı
// yeniden denetime sokardı. Sonra ilan onaylı ve yayında olur.
//
// Anahtarlar .env.local'den okunur (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) ve
// hiçbir yere yazdırılmaz. --dry-run yalnızca medyayı üretir (yükleme ve
// veritabanı yok). Test ilanı zaten varsa --force verilmedikçe durur.

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
  const args = { dryRun: false, force: false, seller: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--force") args.force = true;
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

/** Yandan sedan silueti (200×70 kutu), ince beyaz çizgi */
function carSilhouette(x, y, scale, stroke = 3) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#FFFFFF" stroke-width="${stroke / scale}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 50 L8 39 Q10 31 24 29 L56 25 Q72 11 96 9 L128 9 Q150 10 167 25 L186 28 Q196 30 197 41 L197 50 Z" />
    <path d="M64 25 L80 14 L126 14 L149 25 Z" />
    <path d="M104 14 L104 45" />
    <circle cx="50" cy="52" r="12" fill="#121212" />
    <circle cx="156" cy="52" r="12" fill="#121212" />
  </g>`;
}

function testPill(cx, y, width, height, fontSize) {
  return `<rect x="${cx - width / 2}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#FFFFFF" />
    <text x="${cx}" y="${y + height * 0.68}" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${fontSize}" fill="#121212">TEST İLANI</text>`;
}

function pricePlate(x, y, price) {
  return `<g transform="translate(${x} ${y})">
    <rect width="520" height="112" rx="10" fill="#FFFFFF" stroke="#000000" stroke-width="6" />
    <rect x="3" y="3" width="74" height="106" rx="7" fill="#003399" />
    <text x="40" y="76" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="52" fill="#FFFFFF">₺</text>
    <text x="298" y="82" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="66" fill="#000000">${amount(price)}</text>
  </g>`;
}

function posterSvg(listing) {
  const facts = `${listing.year} · ${amount(listing.mileageKm)} km · ${listing.city}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    <rect width="1080" height="1920" fill="#121212" />
    <rect width="1080" height="1920" fill="${listing.tint}" opacity="0.35" />
    <rect x="0" y="1290" width="1080" height="6" fill="#52525B" />
    ${testPill(540, 190, 420, 92, 48)}
    <text x="540" y="430" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${listing.headline.length > 14 ? 88 : 112}" fill="#FFFFFF">${escapeXml(listing.headline)}</text>
    <text x="540" y="530" text-anchor="middle" font-family="${FONT}" font-size="54" fill="#E4E4E7">${escapeXml(facts)}</text>
    ${carSilhouette(90, 920, 4.5, 7)}
    ${pricePlate(280, 1470, listing.price)}
    <text x="540" y="1770" text-anchor="middle" font-family="${FONT}" font-size="38" fill="#D4D4D8">gözüyle vitrin denemesi · araç satılık değil</text>
  </svg>`;
}

function photoSvg(listing, view) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <rect width="1200" height="900" fill="#18181B" />
    <rect width="1200" height="900" fill="${listing.tint}" opacity="${view.tintOpacity}" />
    <rect x="0" y="640" width="1200" height="5" fill="#52525B" />
    ${view.interior ? interiorSketch() : carSilhouette(view.mirror ? 1060 : 140, 330, view.mirror ? -4.6 : 4.6, 6)}
    ${testPill(600, 60, 330, 76, 40)}
    <text x="600" y="770" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="64" fill="#FFFFFF">${escapeXml(`${listing.headline} · ${listing.year}`)}</text>
    <text x="600" y="840" text-anchor="middle" font-family="${FONT}" font-size="36" fill="#D4D4D8">${escapeXml(view.label)} · gözüyle vitrin denemesi</text>
  </svg>`;
}

/** İç mekân: direksiyon ve gösterge çizgisi */
function interiorSketch() {
  return `<g fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round">
    <path d="M120 470 Q600 330 1080 470" />
    <circle cx="600" cy="470" r="150" />
    <circle cx="600" cy="470" r="40" />
    <path d="M460 470 L560 470 M640 470 L740 470 M600 510 L600 620" />
  </g>`;
}

const PHOTO_VIEWS = [
  { label: "Yan görünüm", tintOpacity: 0.35, mirror: false },
  { label: "Diğer yan", tintOpacity: 0.22, mirror: true },
  { label: "İç mekân", tintOpacity: 0.15, interior: true },
];

async function buildMedia(listing, dir) {
  const poster = join(dir, `${listing.slug}-poster.png`);
  await sharp(Buffer.from(posterSvg(listing))).png().toFile(poster);

  const video = join(dir, `${listing.slug}.mp4`);
  // Kapaktan 8 sn: yavaş yakınlaşma ve altta ilerleyen şerit (hareketli önizleme görünsün)
  execFileSync(
    process.env.FFMPEG ?? "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      poster,
      "-vf",
      "zoompan=z='min(zoom+0.0006,1.14)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=240:s=720x1280:fps=30," +
        "drawbox=x=0:y=ih-12:w='iw*t/8':h=12:color=white@0.9:t=fill,format=yuv420p",
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

  if (!args.seller || !/^[0-9a-f-]{36}$/i.test(args.seller)) throw new Error("--seller <kullanıcı-uuid> gerekli.");
  const env = readEnv(".env.local");
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
    if (!env[key]) throw new Error(`.env.local: ${key} tanımlı değil.`);
  }
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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

main().catch((error) => {
  console.error(`\nDurdu: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
