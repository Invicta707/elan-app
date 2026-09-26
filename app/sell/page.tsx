"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import AuthModal from "../../components/AuthModal";
import FeedHeader from "../../components/FeedHeader";
import { useSupabaseSession } from "../../lib/auth";
import type { FuelType } from "../../lib/feed";
import {
  EMPTY_LISTING_DRAFT,
  PHOTO_BUCKET,
  buildListingRecords,
  buildVehicleImageRow,
  onlyDigits,
  photoStoragePath,
  validateListingDraft,
  type ListingDraft as Draft,
  type VehicleImageRow,
} from "../../lib/listing";
import { fetchCatalog, TURKISH_CITIES, type BodyType, type Catalog } from "../../lib/search";
import { supabase } from "../../lib/supabase";
import { uploadVideoToCloudflare } from "../../lib/tus-upload";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "../../lib/vehicle-labels";

// Cloudflare tarafındaki gerçek sınırlar lib/cloudflare.ts'de tanımlı ("server-only",
// istemciye import edilemez); burada sadece kullanıcıya erken geri bildirim için
// aynı değerler tekrarlanıyor. Asıl doğrulama /api/upload/video ve Cloudflare'de yapılır.
const MAX_VIDEO_DURATION_SECONDS = 60;
const MAX_VIDEO_FILE_BYTES = 500 * 1024 * 1024;
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function toOptions<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

const BODY_TYPE_OPTIONS = toOptions(BODY_TYPE_LABELS);
const FUEL_OPTIONS = toOptions(FUEL_LABELS);
const TRANSMISSION_OPTIONS = toOptions(TRANSMISSION_LABELS);

const fieldClass =
  "h-12 w-full rounded-md border border-[#C9CED6] bg-white px-3 text-base text-[#15181C] disabled:bg-[#EEF0F3] disabled:text-[#7A808A] focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30";

type SubmitPhase =
  | "idle"
  | "creating-listing"
  | "uploading-photos"
  | "requesting-upload-url"
  | "uploading-video"
  | "processing-video"
  | "done";

type PickedVideo = {
  file: File;
  previewUrl: string;
  durationSeconds: number | null;
  isVertical: boolean | null;
};

type PickedPhoto = { file: File; previewUrl: string };

export default function SellPage() {
  const { session, isLoading: isSessionLoading } = useSupabaseSession();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  const [draft, setDraft] = useState<Draft>(EMPTY_LISTING_DRAFT);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);

  const uploadAbortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    fetchCatalog()
      .then((data) => active && setCatalog(data))
      .catch((error) => {
        console.error("Marka/model kataloğu yüklenemedi:", error);
        if (active) setCatalogError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Seçilen dosyalardan oluşturulan object URL'ler unmount'ta serbest bırakılır
  useEffect(() => {
    return () => {
      if (video) URL.revokeObjectURL(video.previewUrl);
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const models = useMemo(
    () => catalog?.models.filter((m) => m.brandId === draft.brandId) ?? [],
    [catalog, draft.brandId],
  );

  const isSubmitting = phase !== "idle" && phase !== "done";

  async function handleVideoPick(file: File | undefined) {
    setVideoError(null);
    if (video) URL.revokeObjectURL(video.previewUrl);
    setVideo(null);
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setVideoError("Sadece video dosyası seçebilirsin.");
      return;
    }
    if (file.size > MAX_VIDEO_FILE_BYTES) {
      setVideoError(`Video en fazla ${Math.round(MAX_VIDEO_FILE_BYTES / (1024 * 1024))} MB olabilir.`);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const meta = await readVideoMeta(previewUrl).catch(() => null);

    if (meta && meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
      setVideoError(`Video en fazla ${MAX_VIDEO_DURATION_SECONDS} saniye olabilir.`);
      URL.revokeObjectURL(previewUrl);
      return;
    }
    if (meta && meta.isVertical === false) {
      setVideoError("Video dikey (portre) formatta olmalı.");
      URL.revokeObjectURL(previewUrl);
      return;
    }

    setVideo({
      file,
      previewUrl,
      durationSeconds: meta?.durationSeconds ?? null,
      isVertical: meta?.isVertical ?? null,
    });
  }

  function handlePhotosPick(files: FileList | null) {
    setPhotoError(null);
    if (!files || files.length === 0) return;

    const incoming = Array.from(files);
    const rejected = incoming.some((f) => !f.type.startsWith("image/") || f.size > MAX_PHOTO_BYTES);
    if (rejected) {
      setPhotoError(`Fotoğraflar en fazla ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB olabilir.`);
    }

    setPhotos((current) => {
      const valid = incoming.filter((f) => f.type.startsWith("image/") && f.size <= MAX_PHOTO_BYTES);
      const room = MAX_PHOTOS - current.length;
      if (valid.length > room) setPhotoError(`En fazla ${MAX_PHOTOS} fotoğraf seçebilirsin.`);
      const accepted = valid.slice(0, Math.max(0, room));
      return [...current, ...accepted.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))];
    });
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  const formError = validateListingDraft(draft) ?? (video ? null : "Bir video seçmelisin.");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    if (formError) {
      setSubmitError(formError);
      return;
    }
    if (!video) {
      setSubmitError("Bir video seçmelisin.");
      return;
    }

    if (!session) {
      setShowAuthModal(true);
      return;
    }

    setSubmitError(null);
    await runSubmit(session.user.id, session.access_token, draft, video, photos);
  }

  async function runSubmit(
    userId: string,
    accessToken: string,
    draft: Draft,
    video: PickedVideo,
    photos: PickedPhoto[],
  ) {
    try {
      setDevNotice(null);

      // Taslak, doğrulamadan sonra (giriş penceresi açıkken) değişmiş olabilir;
      // buildListingRecords yeniden doğrular ve geçersizse hata fırlatır.
      setPhase("creating-listing");
      const records = buildListingRecords(userId, draft);

      // 1) WhatsApp numarası (90XXXXXXXXXX) profile yazılır; get_seller_whatsapp buradan okur
      const { error: profileError } = await supabase.from("profiles").upsert(records.profile);
      if (profileError) throw new Error("İletişim numaran kaydedilemedi: " + profileError.message);

      // 2) İlan "pending_video" durumunda açılır; video hazır olunca webhook
      // (bkz. app/api/webhooks/cloudflare/route.ts) "active" yapar.
      const { data: vehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .insert(records.vehicle)
        .select("id")
        .single();

      if (vehicleError || !vehicle) {
        throw new Error("İlan oluşturulamadı: " + (vehicleError?.message ?? "bilinmeyen hata"));
      }

      // 3) Fotoğraflar (varsa): public "vehicle-photos" bucket'ına yüklenir,
      // kayıtları vehicle_images'a yazılır. Bu adım başarısız olsa da ilan ve
      // video akışı sürer.
      if (photos.length > 0) {
        setPhase("uploading-photos");
        await uploadPhotos(vehicle.id, photos).catch((error) =>
          console.error("Fotoğraflar yüklenemedi (ilan yine de yayınlanacak):", error),
        );
      }

      // 4) Cloudflare'e tek kullanımlık video yükleme bağlantısı
      setPhase("requesting-upload-url");
      const response = await fetch("/api/upload/video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          vehicleId: vehicle.id,
          fileSize: video.file.size,
          fileName: video.file.name,
          fileType: video.file.type,
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | { videoId?: string; uploadUrl?: string; error?: { message?: string; details?: string } }
        | null;

      if (!response.ok || !body?.uploadUrl) {
        // details: Cloudflare'in ham hata mesajı (varsa) — message'dan daha
        // açıklayıcı olduğu için ekranda öncelikli gösterilir.
        throw new Error(
          body?.error?.details ?? body?.error?.message ?? "Video yükleme bağlantısı alınamadı.",
        );
      }

      // 5) Videoyu doğrudan Cloudflare'e yükle (ilerleme yüzdesiyle)
      setPhase("uploading-video");
      setUploadPercent(0);
      const handle = uploadVideoToCloudflare(video.file, body.uploadUrl, setUploadPercent);
      uploadAbortRef.current = handle.abort;
      await handle.done;
      uploadAbortRef.current = null;

      // 6) Yerel geliştirmede Cloudflare webhook'u localhost'a ulaşamaz; video
      // Cloudflare'de işlendikten sonra videos/vehicles satırlarını burada
      // doğrudan biz güncelliyoruz (bkz. app/api/dev/complete-upload — prod'da
      // 404 döner, orada gerçek webhook devreye girer).
      if (process.env.NODE_ENV !== "production" && body.videoId) {
        setPhase("processing-video");
        try {
          const devResponse = await fetch("/api/dev/complete-upload", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ videoId: body.videoId }),
          });
          const devBody = (await devResponse.json().catch(() => null)) as
            | { ok?: boolean; error?: { message?: string } }
            | null;

          if (!devResponse.ok || !devBody?.ok) {
            setDevNotice(
              devBody?.error?.message ??
                "Video Cloudflare'de henüz işlenmedi; ilan otomatik yayına alınamadı (yerel geliştirme).",
            );
          }
        } catch (error) {
          console.error("Dev tamamlama isteği başarısız:", error);
          setDevNotice("Yerel geliştirme: video durumu Cloudflare'den alınamadı.");
        }
      }

      setPhase("done");
    } catch (error) {
      console.error("İlan yayınlanamadı:", error);
      setSubmitError(error instanceof Error ? error.message : "İlan yayınlanamadı.");
      setPhase("idle");
    }
  }

  if (phase === "done") {
    return (
      <main className="min-h-dvh bg-[#F2F3F5] text-[#15181C]">
        <FeedHeader activeTab="sell" tone="solid" />
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
          <p className="text-[22px] font-semibold [font-family:var(--font-display)]">
            İlanın alındı!
          </p>
          <p className="text-[15px] text-[#5B616B]">
            Video işlenir işlenmez ilanın yayına girecek. Bu genelde birkaç dakika sürer.
          </p>
          {devNotice && (
            <p className="max-w-xs rounded-md bg-[#FEF6E7] px-3 py-2 text-[13px] text-[#8A6116]">
              {devNotice}
            </p>
          )}
          <Link
            href="/"
            className="mt-2 h-12 rounded-md bg-[#003399] px-6 text-[16px] font-semibold leading-[3rem] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
          >
            Akışa dön
          </Link>
          <Link
            href="/my-listings"
            className="rounded-sm text-[15px] font-semibold text-[#003399] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            İlanlarımı gör
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#F2F3F5] text-[#15181C]">
      <FeedHeader activeTab="sell" tone="solid" />

      <form
        onSubmit={handleSubmit}
        className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-4 pb-[calc(8rem+var(--bottom-nav-height))]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[26px] font-semibold [font-family:var(--font-display)]">İlan Ver</h1>
          <Link
            href="/my-listings"
            className="rounded-sm text-[14px] font-semibold text-[#003399] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            İlanlarım
          </Link>
        </div>

        <Section title="Video">
          <VideoPicker
            video={video}
            error={videoError}
            disabled={isSubmitting}
            onPick={handleVideoPick}
          />
          <p className="mt-2 text-[13px] text-[#5B616B]">
            Dikey video, en fazla {MAX_VIDEO_DURATION_SECONDS} saniye ve{" "}
            {Math.round(MAX_VIDEO_FILE_BYTES / (1024 * 1024))} MB.
          </p>
        </Section>

        <Section title="Fotoğraflar">
          <PhotoPicker
            photos={photos}
            error={photoError}
            disabled={isSubmitting}
            onPick={handlePhotosPick}
            onRemove={removePhoto}
          />
        </Section>

        <Section title="Araç bilgileri">
          <VehicleFields
            draft={draft}
            onChange={setDraft}
            catalog={catalog}
            catalogError={catalogError}
            models={models}
            disabled={isSubmitting}
          />
        </Section>

        <Section title="İletişim">
          <ContactField draft={draft} onChange={setDraft} disabled={isSubmitting} />
        </Section>

        <div role="status" aria-live="polite">
          {submitError && (
            <p className="rounded-md bg-[#FDEDEC] px-3 py-2 text-[14px] text-[#B42318]">
              {submitError}
            </p>
          )}
        </div>

        <p className="text-[13px] leading-snug text-[#5B616B]">
          İlanı yayınlayarak{" "}
          <Link href="/terms" className="font-semibold text-[#003399] underline underline-offset-2">
            Kullanım Koşulları
          </Link>
          &apos;nı kabul etmiş olursun. Kurallara aykırı ilanlar yayından kaldırılır.
        </p>

        {/* Mobilde alt gezinme çubuğunun hemen üstünde; güvenli alanı çubuk karşılar */}
        <div className="fixed inset-x-0 bottom-[var(--bottom-nav-height)] z-30 border-t border-[#E3E6EA] bg-white px-4 pt-3 pb-3 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            {isSubmitting && (
              <p className="mb-2 text-center text-[13px] font-medium text-[#5B616B]">
                {phaseLabel(phase, uploadPercent)}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting || isSessionLoading}
              aria-busy={isSubmitting}
              className="h-12 w-full rounded-md bg-[#003399] text-[16px] font-semibold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399] focus-visible:ring-offset-2"
            >
              {isSubmitting ? "Yayınlanıyor…" : "İlanı yayınla"}
            </button>
          </div>
        </div>
      </form>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onAuthenticated={() => {
            setShowAuthModal(false);
            // Oturum supabase.auth.onAuthStateChange ile bir an sonra güncellenir;
            // güncel session'ı burada yeniden okuyup akışa kaldığı yerden devam ediyoruz.
            supabase.auth.getSession().then(({ data }) => {
              const next = data.session;
              if (next && video) {
                setSubmitError(null);
                void runSubmit(next.user.id, next.access_token, draft, video, photos);
              }
            });
          }}
        />
      )}
    </main>
  );
}

function phaseLabel(phase: SubmitPhase, uploadPercent: number): string {
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

async function uploadPhotos(vehicleId: string, photos: PickedPhoto[]): Promise<void> {
  const rows: VehicleImageRow[] = [];

  for (let i = 0; i < photos.length; i += 1) {
    const path = photoStoragePath(vehicleId, i, photos[i].file.type);
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, photos[i].file, { upsert: true });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    rows.push(buildVehicleImageRow(vehicleId, data.publicUrl, i));
  }

  const { error: insertError } = await supabase.from("vehicle_images").insert(rows);
  if (insertError) throw insertError;
}

function readVideoMeta(url: string): Promise<{ durationSeconds: number; isVertical: boolean }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      resolve({
        durationSeconds: el.duration,
        isVertical: el.videoHeight >= el.videoWidth,
      });
    };
    el.onerror = () => reject(new Error("Video meta verisi okunamadı."));
    el.src = url;
  });
}

// ---------------------------------------------------------------
// Alt bileşenler
// ---------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function VideoPicker({
  video,
  error,
  disabled,
  onPick,
}: {
  video: PickedVideo | null;
  error: string | null;
  disabled: boolean;
  onPick: (file: File | undefined) => void;
}) {
  const inputId = useId();

  return (
    <div>
      <label
        htmlFor={inputId}
        className={`flex aspect-[9/16] w-40 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-[#C9CED6] bg-white text-center text-[13px] text-[#5B616B] ${
          disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
        }`}
      >
        {video ? (
          <video src={video.previewUrl} className="h-full w-full object-cover" muted playsInline />
        ) : (
          <span className="px-3">Dikey video seç</span>
        )}
      </label>
      <input
        id={inputId}
        type="file"
        accept="video/*"
        disabled={disabled}
        onChange={(event) => onPick(event.target.files?.[0])}
        className="sr-only"
      />
      {error && <p className="mt-2 text-[13px] text-[#B42318]">{error}</p>}
    </div>
  );
}

function PhotoPicker({
  photos,
  error,
  disabled,
  onPick,
  onRemove,
}: {
  photos: PickedPhoto[];
  error: string | null;
  disabled: boolean;
  onPick: (files: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  const inputId = useId();

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <div key={photo.previewUrl} className="relative h-20 w-20 overflow-hidden rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element -- yerel object URL, next/image optimize edemez */}
            <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(index)}
              disabled={disabled}
              aria-label="Fotoğrafı kaldır"
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
            >
              ×
            </button>
          </div>
        ))}

        {photos.length < MAX_PHOTOS && (
          <label
            htmlFor={inputId}
            className={`flex h-20 w-20 items-center justify-center rounded-md border-2 border-dashed border-[#C9CED6] bg-white text-[13px] text-[#5B616B] ${
              disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
            }`}
          >
            + Ekle
          </label>
        )}
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        onChange={(event) => {
          onPick(event.target.files);
          event.target.value = "";
        }}
        className="sr-only"
      />
      {error && <p className="mt-2 text-[13px] text-[#B42318]">{error}</p>}
    </div>
  );
}

function VehicleFields({
  draft,
  onChange,
  catalog,
  catalogError,
  models,
  disabled,
}: {
  draft: Draft;
  onChange: (updater: (d: Draft) => Draft) => void;
  catalog: Catalog | null;
  catalogError: boolean;
  models: Catalog["models"];
  disabled: boolean;
}) {
  const brandId = useId();
  const modelId = useId();
  const yearId = useId();
  const mileageId = useId();
  const priceId = useId();
  const cityId = useId();
  const cityListId = useId();
  const bodyTypeId = useId();
  const fuelTypeId = useId();
  const transmissionLabelId = useId();
  const damageLabelId = useId();
  const descriptionId = useId();

  if (catalogError) {
    return <p className="text-[14px] text-[#B42318]">Marka/model listesi yüklenemedi.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={brandId} className="mb-1.5 block text-[14px] font-semibold">
            Marka
          </label>
          <select
            id={brandId}
            value={draft.brandId}
            disabled={disabled || !catalog}
            onChange={(event) =>
              onChange((d) => ({ ...d, brandId: event.target.value, modelId: "" }))
            }
            className={fieldClass}
          >
            <option value="">Seç</option>
            {catalog?.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={modelId} className="mb-1.5 block text-[14px] font-semibold">
            Model
          </label>
          <select
            id={modelId}
            value={draft.modelId}
            disabled={disabled || !draft.brandId}
            onChange={(event) => onChange((d) => ({ ...d, modelId: event.target.value }))}
            className={fieldClass}
          >
            <option value="">{draft.brandId ? "Seç" : "Önce marka seç"}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={yearId} className="mb-1.5 block text-[14px] font-semibold">
            Yıl
          </label>
          <input
            id={yearId}
            inputMode="numeric"
            placeholder="2019"
            disabled={disabled}
            value={draft.year}
            onChange={(event) =>
              onChange((d) => ({ ...d, year: onlyDigits(event.target.value).slice(0, 4) }))
            }
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={mileageId} className="mb-1.5 block text-[14px] font-semibold">
            Kilometre
          </label>
          <input
            id={mileageId}
            inputMode="numeric"
            placeholder="85.000"
            disabled={disabled}
            value={draft.mileageKm}
            onChange={(event) => onChange((d) => ({ ...d, mileageKm: onlyDigits(event.target.value) }))}
            className={fieldClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor={priceId} className="mb-1.5 block text-[14px] font-semibold">
          Fiyat (₺)
        </label>
        <input
          id={priceId}
          inputMode="numeric"
          placeholder="750.000"
          disabled={disabled}
          value={draft.price}
          onChange={(event) => onChange((d) => ({ ...d, price: onlyDigits(event.target.value) }))}
          className={fieldClass}
        />
      </div>

      <div>
        <label htmlFor={cityId} className="mb-1.5 block text-[14px] font-semibold">
          Şehir
        </label>
        <input
          id={cityId}
          list={cityListId}
          disabled={disabled}
          value={draft.city}
          onChange={(event) => onChange((d) => ({ ...d, city: event.target.value }))}
          className={fieldClass}
        />
        <datalist id={cityListId}>
          {TURKISH_CITIES.map((city) => (
            <option key={city} value={city} />
          ))}
        </datalist>
      </div>

      <div>
        <label htmlFor={bodyTypeId} className="mb-1.5 block text-[14px] font-semibold">
          Kasa tipi
        </label>
        <select
          id={bodyTypeId}
          value={draft.bodyType}
          disabled={disabled}
          onChange={(event) => onChange((d) => ({ ...d, bodyType: event.target.value as BodyType }))}
          className={fieldClass}
        >
          <option value="">Seç</option>
          {BODY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={fuelTypeId} className="mb-1.5 block text-[14px] font-semibold">
            Yakıt türü
          </label>
          <select
            id={fuelTypeId}
            value={draft.fuelType}
            disabled={disabled}
            onChange={(event) =>
              onChange((d) => ({ ...d, fuelType: event.target.value as FuelType }))
            }
            className={fieldClass}
          >
            <option value="">Seç</option>
            {FUEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span id={transmissionLabelId} className="mb-1.5 block text-[14px] font-semibold">
            Vites
          </span>
          <div role="group" aria-labelledby={transmissionLabelId} className="flex gap-2">
            {TRANSMISSION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange((d) => ({ ...d, transmission: option.value }))}
                aria-pressed={draft.transmission === option.value}
                className={`h-12 flex-1 rounded-md border text-[14px] font-semibold ${
                  draft.transmission === option.value
                    ? "border-[#003399] bg-[#EAEFF7] text-[#003399]"
                    : "border-[#C9CED6] bg-white text-[#15181C]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <span id={damageLabelId} className="mb-1.5 block text-[14px] font-semibold">
          Hasar durumu
        </span>
        <div role="group" aria-labelledby={damageLabelId} className="flex gap-2">
          {(
            [
              { value: "none", label: "Hasarsız / hafif" },
              { value: "heavy", label: "Ağır hasarlı" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange((d) => ({ ...d, damageStatus: option.value }))}
              aria-pressed={draft.damageStatus === option.value}
              className={`h-11 flex-1 rounded-md border text-[14px] font-semibold ${
                draft.damageStatus === option.value
                  ? "border-[#003399] bg-[#EAEFF7] text-[#003399]"
                  : "border-[#C9CED6] bg-white text-[#15181C]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor={descriptionId} className="mb-1.5 block text-[14px] font-semibold">
          Açıklama
        </label>
        <textarea
          id={descriptionId}
          rows={4}
          placeholder="Aracınla ilgili eklemek istediklerin…"
          disabled={disabled}
          value={draft.description}
          onChange={(event) => onChange((d) => ({ ...d, description: event.target.value }))}
          className="w-full rounded-md border border-[#C9CED6] bg-white px-3 py-2.5 text-base text-[#15181C] disabled:bg-[#EEF0F3] focus-visible:border-[#003399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]/30"
        />
      </div>
    </div>
  );
}

function ContactField({
  draft,
  onChange,
  disabled,
}: {
  draft: Draft;
  onChange: (updater: (d: Draft) => Draft) => void;
  disabled: boolean;
}) {
  const whatsappId = useId();

  return (
    <div>
      <label htmlFor={whatsappId} className="mb-1.5 block text-[14px] font-semibold">
        WhatsApp numarası
      </label>
      <input
        id={whatsappId}
        type="tel"
        inputMode="tel"
        placeholder="05XX XXX XX XX"
        disabled={disabled}
        value={draft.whatsapp}
        onChange={(event) => onChange((d) => ({ ...d, whatsapp: event.target.value }))}
        className={fieldClass}
      />
      <p className="mt-1.5 text-[13px] text-[#5B616B]">
        Alıcılar &quot;WhatsApp&apos;tan yaz&quot; butonuyla bu numaraya ulaşır.
      </p>
    </div>
  );
}
