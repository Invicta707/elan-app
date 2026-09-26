import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        // Cloudflare Stream video kapakları (videos.thumbnail_url)
        protocol: "https",
        hostname: "**.cloudflarestream.com",
      },
    ],
  },
  async rewrites() {
    return [
      // Herkese açık profil: /@kullanici_adi → app/u/[username]. app/ altında "@"
      // ile başlayan klasör paralel rota yuvası sayıldığı için rewrite gerekiyor.
      { source: "/@:username", destination: "/u/:username" },
    ];
  },
};

export default nextConfig;
