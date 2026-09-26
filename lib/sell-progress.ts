// /sell gönderim aşamaları: hangi adımın sürdüğü ve genel ilerleme yüzdesi.
// UI'dan bağımsız; app/sell/page.tsx aşamayı yönetir, components/sell/
// SubmitProgress ve alt çubuk bu değerleri gösterir.

export type SubmitPhase =
  | "idle"
  | "creating-listing"
  | "uploading-photos"
  | "requesting-upload-url"
  | "uploading-video"
  | "processing-video"
  | "done";

export type SubmitStepId = "listing" | "photos" | "video-upload" | "video-processing";
export type SubmitStepStatus = "pending" | "active" | "done" | "skipped";

export const SUBMIT_STEPS: readonly { id: SubmitStepId; title: string }[] = [
  { id: "listing", title: "İlan kaydı" },
  { id: "photos", title: "Fotoğraflar" },
  { id: "video-upload", title: "Video yükleme" },
  { id: "video-processing", title: "Video işleme" },
];

/** Aşamanın hangi adımda olduğu (done: hepsi bitti) */
const PHASE_STEP: Record<SubmitPhase, number> = {
  idle: -1,
  "creating-listing": 0,
  "uploading-photos": 1,
  "requesting-upload-url": 2,
  "uploading-video": 2,
  "processing-video": 3,
  done: 4,
};

/**
 * Her adımın durumu. Fotoğraf yoksa fotoğraf adımı atlanır. Video işleme
 * canlıda Cloudflare'de, gönderimden sonra sürer: "done" iken bile "active"
 * kalır (başarı ekranı "işleniyor" gösterir). Yerelde /api/dev/complete-upload
 * işlemi beklediği için orada tamamlanmış sayılır.
 */
export function submitStepStatuses(
  phase: SubmitPhase,
  { hasPhotos, processingConfirmed }: { hasPhotos: boolean; processingConfirmed: boolean },
): Record<SubmitStepId, SubmitStepStatus> {
  const current = PHASE_STEP[phase];
  const statusAt = (index: number): SubmitStepStatus =>
    current > index ? "done" : current === index ? "active" : "pending";

  return {
    listing: statusAt(0),
    photos: hasPhotos ? statusAt(1) : current >= 1 ? "skipped" : "pending",
    "video-upload": statusAt(2),
    "video-processing":
      phase === "done" ? (processingConfirmed ? "done" : "active") : statusAt(3),
  };
}

/** Genel ilerleme (0–100). Süresi en uzun olan video yüklemesi aralığın çoğunu kaplar. */
export function overallSubmitPercent(phase: SubmitPhase, uploadPercent: number): number {
  switch (phase) {
    case "idle":
      return 0;
    case "creating-listing":
      return 5;
    case "uploading-photos":
      return 12;
    case "requesting-upload-url":
      return 18;
    case "uploading-video":
      return Math.round(20 + (Math.min(Math.max(uploadPercent, 0), 100) * 75) / 100);
    case "processing-video":
      return 97;
    case "done":
      return 100;
  }
}

export function submitPhaseLabel(phase: SubmitPhase, uploadPercent: number): string {
  switch (phase) {
    case "creating-listing":
      return "İlan oluşturuluyor…";
    case "uploading-photos":
      return "Fotoğraflar yükleniyor…";
    case "requesting-upload-url":
      return "Video yüklemesi hazırlanıyor…";
    case "uploading-video":
      return `Video yükleniyor… %${uploadPercent}`;
    case "processing-video":
      return "Video işleniyor…";
    default:
      return "";
  }
}
