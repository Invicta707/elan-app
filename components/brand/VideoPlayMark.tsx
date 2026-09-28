import EyePlayMark from "./EyePlayMark";

// Videonun ve vitrin kartının ortasındaki oynat işareti: yalnızca marka işareti
// (ince göz hattı, göz bebeğinin yerinde oynat üçgeni), yarı saydam beyaz.
// Daire, kenarlık ve buzlu zemin yok; açık renkli karede de okunsun diye hafif
// siyah gölge (renkli ışıma değil).
export default function VideoPlayMark({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <EyePlayMark
      className={`text-white/85 drop-shadow-[0_1px_6px_rgba(0,0,0,0.45)] ${className}`}
      strokeWidth={4}
    />
  );
}
