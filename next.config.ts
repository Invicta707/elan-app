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
};

export default nextConfig;