import { NextResponse } from "next/server";
import { checkAdminStatus, fetchAdminCounts } from "../../../../lib/moderation-server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

// GET /api/admin/status — "İlan Onay Paneli" girişi (Vitrinim, Ayarlar)
//
// Authorization: Bearer <access_token>
// 401: oturum yok ya da geçersiz
// 200 { admin: false }: giriş gösterilmez (yönetici listesi tarayıcıya hiç gelmez)
// 200 { admin: true, pendingListings, openReports }: rozet için sayılar (okunamazsa null)
//
// Her giriş yapmış kullanıcının Vitrinim'i sorar: yönetici olmayan için yalnızca
// token doğrulanır (bkz. lib/moderation-server.ts checkAdminStatus).

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const check = await checkAdminStatus(request);
  if (check.status === 401) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Giriş yapmalısın." } },
      { status: 401, headers: NO_STORE },
    );
  }
  if (!check.admin) return NextResponse.json({ admin: false }, { headers: NO_STORE });

  const counts = await fetchAdminCounts(getSupabaseAdmin());
  return NextResponse.json({ admin: true, ...counts }, { headers: NO_STORE });
}
