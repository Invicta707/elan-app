import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Next.js tarayıcıya sadece NEXT_PUBLIC_ önekli değişkenleri gönderir.
// .env.local örneği:
//   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   (yeni anahtar formatı)
//   ya da
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...                (eski "anon" anahtarı)
//
// Buraya ASLA service_role / secret anahtarı koyma: NEXT_PUBLIC_ ile
// başlayan her değer tarayıcı paketine gömülür ve herkes görebilir.

// Değerler burada, düz process.env.X erişimiyle okunmalı: Next.js bunları
// build sırasında tarayıcı paketine gömer. Boş değer "tanımsız" sayılır (||).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase ortam değişkenleri eksik. .env.local dosyasına (Vercel'de Environment Variables'a) " +
        "NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ya da NEXT_PUBLIC_SUPABASE_ANON_KEY) " +
        "ekleyip `npm run dev` sürecini yeniden başlat ya da yeniden deploy et.",
    );
  }
  client = createClient(supabaseUrl, supabaseKey);
  return client;
}

// İstemci ilk kullanımda kurulur. Değişkenler eksikse hata import anında değil
// ilk sorguda gelir: build (sayfa verisi toplanırken modüller yüklenir ama
// Supabase çağrılmaz) ortam değişkenleri olmadan da düşmez, eksiklik ise
// kullanıldığı yerde açık bir mesajla görünür.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    // await / Promise.resolve bir değerin "then"ine bakar; gerçek istemcide yok.
    // İstemciyi kurmadan yanıtla, yoksa sadece beklenmek istemciyi kurar (ya da hata verir).
    if (property === "then") return undefined;
    const instance = getClient();
    const value = Reflect.get(instance, property, instance);
    // supabase.from(...) gibi metotlar istemcinin kendisine bağlı çalışmalı
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
