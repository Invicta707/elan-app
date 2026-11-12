import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isHatunumEnabled } from "../../../lib/hatunum-switch";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

// /hatunum/foto: sayfanın fotoğrafı. public/ altında değil: dosya ancak sayfa
// açıkken verilir, kapalıyken 404. Önbelleğe alınmaz (CDN dahil), böylece
// sayfa kapatılınca fotoğraf da hemen erişilmez olur.
export async function GET() {
  if (!(await isHatunumEnabled(getSupabaseAdmin))) {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const photo = await readFile(join(process.cwd(), "app/hatunum/zulal.jpg"));
  return new Response(new Uint8Array(photo), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
