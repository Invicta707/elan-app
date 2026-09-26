import { Clapperboard } from "lucide-react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import FeedHeader from "../../../components/FeedHeader";
import ShowcaseTile from "../../../components/showcase/ShowcaseTile";
import ProfileHeader from "../../../components/social/ProfileHeader";
import { fetchProfilePage, fetchPublicListings, parseProfileParam } from "../../../lib/follows";
import { profilePath } from "../../../lib/username";
import { bodyFont, displayFont } from "../../fonts";

// Herkese açık profil (vitrin). Adres /@kullanici_adi; next.config.ts'teki
// rewrite ile buraya gelir (app/ altında "@" ile başlayan klasör paralel rota
// yuvası sayıldığı için sayfa /u/[username] altında).
//
// Sunucu anonim okur: yalnızca herkese açık alanlar ve yayındaki ilanlar.
// Takip durumu tarayıcıda oturumla okunur (ProfileHeader).

type ProfilePageProps = {
  params: Promise<{ username: string }>;
};

// generateMetadata ve sayfa aynı isteği paylaşır
const getProfile = cache((username: string) => fetchProfilePage(username));

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const username = parseProfileParam((await params).username);
  const profile = username ? await getProfile(username).catch(() => null) : null;
  if (!profile) return { title: "Kullanıcı bulunamadı | gözüyle", robots: { index: false } };

  const name = profile.displayName ? `${profile.displayName} (@${profile.username})` : `@${profile.username}`;
  const title = `${name} | gözüyle`;
  const description = `${profile.listingsCount} ilan · ${profile.followersCount} takipçi. ${name} adlı satıcının videolu araç ilanları gözüyle'de.`;
  const path = profilePath(profile.username);

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "profile",
      siteName: "gözüyle",
      locale: "tr_TR",
      url: path,
      title,
      description,
      images: profile.avatarUrl ? [{ url: profile.avatarUrl, alt: name }] : undefined,
    },
    twitter: { card: "summary", title, description, images: profile.avatarUrl ? [profile.avatarUrl] : undefined },
  };
}

export default async function PublicProfilePage({ params }: ProfilePageProps) {
  const raw = (await params).username;
  const username = parseProfileParam(raw);
  if (!username) notFound();
  // /@Kamil → /@kamil (tek adres)
  if (decodeURIComponent(raw) !== username) permanentRedirect(profilePath(username));

  const profile = await getProfile(username);
  if (!profile) notFound();

  const listings = await fetchPublicListings(profile.id).catch((error) => {
    console.error("Profil ilanları okunamadı:", error);
    return null;
  });

  return (
    <main
      className={`${displayFont.variable} ${bodyFont.variable} min-h-dvh w-full bg-[#F2F3F5] text-[#15181C] [font-family:var(--font-body)]`}
    >
      <FeedHeader activeTab="profile" tone="solid" />
      <div className="mx-auto max-w-2xl px-3 pt-1 pb-[max(2.5rem,calc(var(--bottom-nav-height)+1.5rem),env(safe-area-inset-bottom))] sm:px-4">
        <ProfileHeader initial={profile} />

        <h2 className="mt-7 mb-2 flex items-center gap-2 px-1 text-[14px] font-semibold text-[#5B616B]">
          <Clapperboard aria-hidden="true" className="h-4 w-4" />
          Vitrin
        </h2>

        {listings === null ? (
          <p role="status" className="mt-8 text-center text-[15px] text-[#5B616B]">
            İlanlar yüklenemedi. Sayfayı yenileyip tekrar dene.
          </p>
        ) : listings.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-[#D5D9DF] px-6 py-10 text-center">
            <Clapperboard aria-hidden="true" className="h-8 w-8 text-[#8A9099]" />
            <p className="text-[16px] font-semibold">Yayında ilanı yok</p>
            <p className="max-w-xs text-[14px] text-[#5B616B]">
              Takip edersen yeni videolu ilanları &quot;Takip Edilenler&quot; akışında görürsün.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-1 sm:gap-1.5">
            {listings.map((listing, index) => (
              <li key={listing.id}>
                <ShowcaseTile listing={listing} priority={index < 6} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
