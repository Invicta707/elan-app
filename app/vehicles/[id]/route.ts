import { NextResponse, type NextRequest } from "next/server";
import { fetchListingPath } from "../../../lib/vehicle-page";

// Eski ilan adresi /vehicles/<id> → 301 ile /ilan/<yıl>-<marka>-<model>-<kasa>-<il>-<id>.
// WhatsApp'ta ve arama motorlarında kalan eski bağlantılar tek adımda yeni
// adrese gider; sorgu dizisi (ör. utm_*) korunur. İlan okunamazsa /ilan/<id>'e
// gider, orası "Bu ilan artık yayında değil" sayfasını (404) gösterir.
export async function GET(request: NextRequest, { params }: RouteContext<"/vehicles/[id]">) {
  const { id } = await params;
  const target = new URL(await fetchListingPath(id), request.nextUrl);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 301);
}

export const HEAD = GET;
