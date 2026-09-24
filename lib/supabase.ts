import { createClient } from "@supabase/supabase-js";

// Next.js tarayıcıya sadece NEXT_PUBLIC_ önekli değişkenleri gönderir.
// .env.local örneği:
//   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   (yeni anahtar formatı)
//   ya da
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...                (eski "anon" anahtarı)
//
// Buraya ASLA service_role / secret anahtarı koyma: NEXT_PUBLIC_ ile
// başlayan her değer tarayıcı paketine gömülür ve herkes görebilir.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabase ortam değişkenleri eksik. .env.local dosyasına NEXT_PUBLIC_SUPABASE_URL ve " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ya da NEXT_PUBLIC_SUPABASE_ANON_KEY) ekleyip " +
      "`npm run dev` sürecini yeniden başlat."
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);