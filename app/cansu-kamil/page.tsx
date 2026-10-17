import { notFound } from "next/navigation";
import { isCansuPageDisabled, shouldShowKillSwitch } from "../../lib/cansu-kamil-switch";
import { getSupabaseAdmin } from "../../lib/supabase-server";
import CansuKamilView from "./CansuKamilView";

// Sürpriz sayfası: her istekte kapatma bayrağı okunur (app_settings,
// lib/cansu-kamil-switch.ts). Kapatıldıysa herkese 404. ?admin=kamil yalnızca
// en alttaki "Sayfayı Kapat / 404 Yap" düğmesini gösterir; kapatma yönetici
// oturumu ister.
export default async function CansuKamilPage({ searchParams }: PageProps<"/cansu-kamil">) {
  const { admin } = await searchParams;
  if (await isCansuPageDisabled(getSupabaseAdmin)) notFound();
  return <CansuKamilView showKillSwitch={shouldShowKillSwitch(admin)} />;
}
