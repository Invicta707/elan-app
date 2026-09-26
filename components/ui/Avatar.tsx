import Image from "next/image";
import { initialOf } from "../../lib/profile";

// Yuvarlak profil fotoğrafı; fotoğraf yoksa adın baş harfi (renkli zemin).
export default function Avatar({
  url,
  name,
  size,
  className = "",
}: {
  url: string | null | undefined;
  name: string | null | undefined;
  /** Piksel: hem kutu hem next/image boyutu */
  size: number;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#2B4FB5] to-[#0A1F66] font-bold text-white [font-family:var(--font-display)] ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {url ? (
        <Image src={url} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <span aria-hidden="true">{initialOf(name, "g")}</span>
      )}
    </span>
  );
}
