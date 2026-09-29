"use client";

import { CircleAlert, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import AuthModal from "../../components/AuthModal";
import FeedHeader from "../../components/FeedHeader";
import {
  ChoiceGroup,
  Field,
  FieldError,
  GroupedNumberInput,
  TextInput,
  controlClass,
  describedBy,
} from "../../components/sell/FormControls";
import BodyPartsEditor from "../../components/sell/BodyPartsEditor";
import { CatalogCombobox } from "../../components/sell/CatalogCombobox";
import { PhotoDropzone, VideoDropzone } from "../../components/sell/MediaPickers";
import {
  FormCard,
  SellActionBar,
  SellStepper,
  SellSuccess,
  SubmitProgress,
} from "../../components/sell/SellChrome";
import type { PickedPhoto, PickedVideo } from "../../components/sell/types";
import { useSupabaseSession } from "../../lib/auth";
import { bodyPartsSummary } from "../../lib/body-parts";
import { MAX_BRAND_NAME, MAX_MODEL_NAME } from "../../lib/catalog-search";
import type { FuelType, TransmissionType } from "../../lib/feed";
import {
  EMPTY_LISTING_DRAFT,
  LISTING_STEPS,
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  PHOTO_BUCKET,
  PHOTO_SIZE_ERROR,
  buildListingRecords,
  buildVehicleImageRow,
  catalogIds,
  catalogRpcArgs,
  groupThousands,
  listingFieldErrors,
  onlyDigits,
  photoUpload,
  stepFieldErrors,
  validateListingDraft,
  type CatalogSelection,
  type DamageStatus,
  type ListingDraft as Draft,
  type ListingField,
  type VehicleImageRow,
} from "../../lib/listing";
import { inspectImageFile } from "../../lib/image-decode";
import { fetchCatalogCached, TURKISH_CITIES, type BodyType, type Catalog } from "../../lib/search";
import {
  overallSubmitPercent,
  submitPhaseLabel,
  type SubmitPhase,
} from "../../lib/sell-progress";
import { supabase } from "../../lib/supabase";
import { uploadVideoToCloudflare } from "../../lib/tus-upload";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "../../lib/vehicle-labels";

// Cloudflare tarafındaki gerçek sınırlar lib/cloudflare.ts'de tanımlı ("server-only",
// istemciye import edilemez); burada sadece kullanıcıya erken geri bildirim için
// aynı değerler tekrarlanıyor. Asıl doğrulama /api/upload/video ve Cloudflare'de yapılır.
const MAX_VIDEO_DURATION_SECONDS = 60;
const MAX_VIDEO_FILE_BYTES = 500 * 1024 * 1024;

const MAX_PRICE_DIGITS = 12;
const MAX_MILEAGE_DIGITS = 7;

function toOptions<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

const BODY_TYPE_OPTIONS = toOptions(BODY_TYPE_LABELS);
const FUEL_OPTIONS = toOptions(FUEL_LABELS);
const TRANSMISSION_OPTIONS = toOptions(TRANSMISSION_LABELS);
const DAMAGE_OPTIONS: readonly { value: DamageStatus; label: string }[] = [
  { value: "none", label: "Hasarsız / hafif" },
  { value: "heavy", label: "Ağır hasarlı" },
];

const LAST_STEP = LISTING_STEPS.length - 1;
const MEDIA_STEP = LISTING_STEPS.findIndex((s) => s.id === "media");
const VIDEO_REQUIRED = "Bir video seçmelisin.";

/** Alanın DOM id'si: hatalı ilk alana odaklanmak için sabit */
const fieldId = (field: ListingField) => `sell-${field}`;
const VIDEO_INPUT_ID = "sell-video";
const PHOTOS_INPUT_ID = "sell-photos";

const STEP_OF_FIELD = Object.fromEntries(
  LISTING_STEPS.flatMap((step, index) => step.fields.map((field) => [field, index])),
) as Record<ListingField, number>;

const STEP_INTRO: Record<(typeof LISTING_STEPS)[number]["id"], string> = {
  vehicle: "Aracının modelini ve temel özelliklerini seç.",
  media: "Dikey video ilanın vitrini; fotoğraflar isteğe bağlı.",
  details: "Fiyatı, konumu ve alıcıların sana ulaşacağı numarayı gir.",
};

export default function SellPage() {
  const { session, isLoading: isSessionLoading } = useSupabaseSession();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  const [draft, setDraft] = useState<Draft>(EMPTY_LISTING_DRAFT);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // Seçilen fotoğraflar denetlenirken (tür, imza, açılabilirlik) seçici kapalı
  const [checkingPhotos, setCheckingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Adımlar: hatalar, alan terk edilince ya da o adımda "Devam et"e basılınca görünür
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState<boolean[]>(() => LISTING_STEPS.map(() => false));
  const [touched, setTouched] = useState<Partial<Record<ListingField, boolean>>>({});
  // Marka/model kutusuna yazılıp listeden seçilmemiş metin (hata metninde anılır)
  const [pending, setPending] = useState<{ brand: string | null; model: string | null }>({ brand: null, model: null });

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);
  const [processingConfirmed, setProcessingConfirmed] = useState(false);
  // Yayına yalnızca yönetici onayıyla girer; gönderim anında pratikte hep false
  const [published, setPublished] = useState(false);

  const uploadAbortRef = useRef<(() => void) | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepChangedByUser = useRef(false);

  useEffect(() => {
    let active = true;
    fetchCatalogCached()
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

  const isSubmitting = phase !== "idle" && phase !== "done";

  // Yükleme sürerken sayfadan çıkılırsa video yarıda kalır: tarayıcı onay sorar
  useEffect(() => {
    if (!isSubmitting) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isSubmitting]);

  // Adım değişince başlığa odaklan (ekran okuyucu yeni adımı okur) ve yukarı kaydır
  useEffect(() => {
    if (!stepChangedByUser.current) return;
    stepChangedByUser.current = false;
    stepHeadingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const models = useMemo(
    () => catalog?.models.filter((m) => m.brandId === draft.brandId) ?? [],
    [catalog, draft.brandId],
  );

  const fieldErrors = useMemo(() => listingFieldErrors(draft), [draft]);

  function stepInvalid(index: number): boolean {
    return (
      Object.keys(stepFieldErrors(index, fieldErrors)).length > 0 || (index === MEDIA_STEP && !video)
    );
  }

  function errorFor(field: ListingField): string | null {
    if (!(attempted[STEP_OF_FIELD[field]] || touched[field])) return null;
    const error = fieldErrors[field] ?? null;
    const typed = field === "brandId" ? pending.brand : field === "modelId" ? pending.model : null;
    return error && typed ? `Listeden seç ya da “${typed.trim()}” olarak kullan.` : error;
  }

  const hasBrand = Boolean(draft.brandId || draft.brandName);

  const touch = (field: ListingField) => () => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  const update = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));

  function markAttempted(index: number) {
    setAttempted((current) => current.map((value, i) => value || i === index));
  }

  function goToStep(index: number) {
    stepChangedByUser.current = true;
    setStep(index);
  }

  /** Adımdaki ilk hatalı alana odaklanır (hata metni görünür olduktan sonra) */
  function focusFirstInvalid(index: number) {
    const field = LISTING_STEPS[index].fields.find((f) => fieldErrors[f]);
    const target = field ? fieldId(field) : index === MEDIA_STEP && !video ? VIDEO_INPUT_ID : null;
    if (!target) return;
    // React, form olayının sonunda DOM'u günceller; odak ondan sonra verilir
    setTimeout(() => {
      const element = document.getElementById(target);
      element?.focus({ preventScroll: true });
      element?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  function showStepErrors(index: number) {
    markAttempted(index);
    if (index !== step) goToStep(index);
    focusFirstInvalid(index);
  }

  /** Stepper'dan: geri her zaman, ileri ancak aradaki adımlar geçerliyse */
  function canReach(index: number): boolean {
    for (let i = 0; i < index; i += 1) if (stepInvalid(i)) return false;
    return true;
  }

  function selectStep(index: number) {
    if (index < step || canReach(index)) goToStep(index);
  }

  async function handleVideoPick(file: File | undefined) {
    setVideoError(null);
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

    if (video) URL.revokeObjectURL(video.previewUrl);
    setVideo({
      file,
      previewUrl,
      durationSeconds: meta?.durationSeconds ?? null,
      isVertical: meta?.isVertical ?? null,
    });
  }

  function removeVideo() {
    if (video) URL.revokeObjectURL(video.previewUrl);
    setVideo(null);
    setVideoError(null);
  }

  async function handlePhotosPick(incoming: File[]) {
    setPhotoError(null);
    if (incoming.length === 0) return;

    // Profil fotoğrafıyla aynı denetim (lib/image-decode.ts inspectImageFile): esnek
    // tür beyanı, ilk bayt imzası (PNG/JPEG/WebP), boyut ve tarayıcıda açılabilirlik.
    // Storage aynı tür ve boyut sınırlarını ayrıca uygular. Sırayla denetlenir:
    // büyük telefon fotoğrafları aynı anda açılıp belleği doldurmasın.
    const room = MAX_PHOTOS - photos.length;
    const accepted: PickedPhoto[] = [];
    let error: string | null = null;
    setCheckingPhotos(true);
    try {
      for (const file of incoming) {
        if (accepted.length >= room) {
          error ??= `En fazla ${MAX_PHOTOS} fotoğraf seçebilirsin.`;
          break;
        }
        const result = await inspectImageFile(file, { maxBytes: MAX_PHOTO_BYTES, sizeError: PHOTO_SIZE_ERROR });
        if (result.ok) accepted.push({ file, type: result.type, previewUrl: URL.createObjectURL(file) });
        else error ??= result.message;
      }
    } finally {
      setCheckingPhotos(false);
    }

    if (error) setPhotoError(error);
    if (accepted.length > 0) setPhotos((current) => [...current, ...accepted].slice(0, MAX_PHOTOS));
  }

  function removePhoto(index: number) {
    setPhotoError(null);
    setPhotos((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  const formError = validateListingDraft(draft) ?? (video ? null : VIDEO_REQUIRED);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    // Ara adımlarda "Devam et": yalnızca bu adımın alanları denetlenir
    if (step < LAST_STEP) {
      if (stepInvalid(step)) showStepErrors(step);
      else goToStep(step + 1);
      return;
    }

    // Son adım: bütün adımlar; eksik varsa ilk eksik adıma dönülür
    markAttempted(step);
    const firstInvalid = LISTING_STEPS.findIndex((_, index) => stepInvalid(index));
    if (firstInvalid !== -1) {
      showStepErrors(firstInvalid);
      return;
    }

    if (formError) {
      setSubmitError(formError);
      return;
    }
    if (!video) {
      setSubmitError(VIDEO_REQUIRED);
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
      setProcessingConfirmed(false);
      setPublished(false);

      // Taslak, doğrulamadan sonra (giriş penceresi açıkken) değişmiş olabilir;
      // buildListingRecords yeniden doğrular ve geçersizse hata fırlatır.
      setPhase("creating-listing");
      const records = buildListingRecords(userId, draft);

      // 1) WhatsApp numarası (90XXXXXXXXXX) profile yazılır; get_seller_whatsapp buradan okur
      const { error: profileError } = await supabase.from("profiles").upsert(records.profile);
      if (profileError) throw new Error("İletişim numaran kaydedilemedi: " + profileError.message);

      // 2) İlan "pending_video" durumunda açılır; video hazır olunca webhook
      // (bkz. app/api/webhooks/cloudflare/route.ts) ilanı içerik denetimine alır,
      // denetimden geçerse "active" olur (lib/listing-moderation.ts).
      // Marka/model listeden seçildiyse id'ler hazır; yazılan adı RPC bulur ya da kataloğa ekler
      const catalogRow = catalogIds(records.catalog) ?? (await resolveCatalog(records.catalog));

      const { data: vehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .insert({ ...records.vehicle, ...catalogRow })
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
            | { ok?: boolean; published?: boolean; decision?: string | null; error?: { message?: string } }
            | null;

          if (!devResponse.ok || !devBody?.ok) {
            setDevNotice(
              devBody?.error?.message ??
                "Video Cloudflare'de henüz işlenmedi; ilan otomatik yayına alınamadı (yerel geliştirme).",
            );
          } else {
            setProcessingConfirmed(true);
            setPublished(Boolean(devBody.published));
            if (devBody.decision === "rejected") {
              setDevNotice("Yerel geliştirme: içerik denetimi ilanı reddetti.");
            } else if (!devBody.published) {
              setDevNotice(
                devBody.decision === "safe"
                  ? "Yerel geliştirme: otomatik tarama temiz; ilan /admin/reports'tan yönetici onayı bekliyor."
                  : "Yerel geliştirme: ilan içerik denetiminde (şüpheli ya da denetlenemedi); /admin/reports'tan karar verilmeli.",
              );
            }
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
        <SellSuccess
          hasPhotos={photos.length > 0}
          processingConfirmed={processingConfirmed}
          published={published}
          devNotice={devNotice}
        />
      </main>
    );
  }

  const current = LISTING_STEPS[step];
  const brandName = draft.brandId ? (catalog?.brands.find((b) => b.id === draft.brandId)?.name ?? "") : draft.brandName;
  const modelName = draft.modelId ? (models.find((m) => m.id === draft.modelId)?.name ?? "") : draft.modelName;
  const mediaError = videoError ?? (attempted[MEDIA_STEP] && !video ? VIDEO_REQUIRED : null);

  return (
    <main className="min-h-dvh bg-[#F2F3F5] text-[#15181C]">
      <FeedHeader activeTab="sell" tone="solid" />

      <form
        noValidate
        onSubmit={handleSubmit}
        className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-3 pb-[calc(7rem+var(--bottom-nav-height))]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[28px] font-semibold leading-tight [font-family:var(--font-display)]">İlan Ver</h1>
          <Link
            href="/my-listings"
            className="rounded-sm text-[14px] font-semibold text-[#003399] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
          >
            Vitrinim
          </Link>
        </div>

        <SellStepper
          steps={LISTING_STEPS}
          current={step}
          reachable={(index) => index < step || canReach(index)}
          onSelect={selectStep}
          disabled={isSubmitting}
        />

        <div className="mt-1">
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className="text-[20px] font-semibold leading-tight outline-none [font-family:var(--font-display)]"
          >
            {isSubmitting ? "İlanın yayınlanıyor" : current.title}
          </h2>
          <p className="mt-0.5 text-[14px] text-[#5B616B]">
            {isSubmitting ? "Bu sayfadan ayrılma; video yüklemesi yarıda kalır." : STEP_INTRO[current.id]}
          </p>
        </div>

        {isSubmitting ? (
          <FormCard title="Yayın durumu">
            <SubmitProgress phase={phase} uploadPercent={uploadPercent} hasPhotos={photos.length > 0} />
          </FormCard>
        ) : current.id === "vehicle" ? (
          <>
            <FormCard title="Model">
              {catalogError ? (
                <p className="flex items-start gap-1.5 text-[14px] text-[#B42318]">
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  Marka/model listesi yüklenemedi. Sayfayı yenileyip tekrar dene.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                  <Field
                    id={fieldId("brandId")}
                    label="Marka"
                    error={errorFor("brandId")}
                    className="col-span-2 sm:col-span-1"
                  >
                    <CatalogCombobox
                      id={fieldId("brandId")}
                      options={catalog?.brands ?? []}
                      selectedId={draft.brandId}
                      customName={draft.brandName}
                      maxLength={MAX_BRAND_NAME}
                      placeholder={catalog ? "Marka ara ya da yaz" : "Yükleniyor…"}
                      emptyHint="Marka adını yaz."
                      disabled={!catalog}
                      invalid={Boolean(errorFor("brandId"))}
                      describedBy={describedBy(fieldId("brandId"), { error: errorFor("brandId") })}
                      onBlur={touch("brandId")}
                      onPendingChange={(text) => setPending((p) => ({ ...p, brand: text }))}
                      onChange={({ id, name }) => {
                        if (id === draft.brandId && name === draft.brandName) return;
                        // Marka değişince model sıfırlanır (katalog modeli yalnızca kendi markasında geçerli)
                        update({ brandId: id, brandName: name, modelId: "", modelName: "" });
                        setPending((p) => ({ ...p, model: null }));
                      }}
                    />
                  </Field>
                  <Field
                    id={fieldId("modelId")}
                    label="Model"
                    error={errorFor("modelId")}
                    className="col-span-2 sm:col-span-1"
                  >
                    <CatalogCombobox
                      // Marka değişince kutu (yazılan metinle birlikte) sıfırdan kurulur
                      key={draft.brandId || `yeni:${draft.brandName}`}
                      id={fieldId("modelId")}
                      options={draft.brandId ? models : []}
                      selectedId={draft.modelId}
                      customName={draft.modelName}
                      maxLength={MAX_MODEL_NAME}
                      placeholder={hasBrand ? "Model ara ya da yaz" : "Önce marka seç"}
                      emptyHint="Yeni marka için model adını yaz."
                      disabled={!hasBrand}
                      invalid={Boolean(errorFor("modelId"))}
                      describedBy={describedBy(fieldId("modelId"), { error: errorFor("modelId") })}
                      onBlur={touch("modelId")}
                      onPendingChange={(text) => setPending((p) => ({ ...p, model: text }))}
                      onChange={({ id, name }) => update({ modelId: id, modelName: name })}
                    />
                  </Field>
                  <Field id={fieldId("year")} label="Model yılı" error={errorFor("year")}>
                    <TextInput
                      id={fieldId("year")}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="2019"
                      maxLength={4}
                      value={draft.year}
                      invalid={Boolean(errorFor("year"))}
                      aria-describedby={describedBy(fieldId("year"), { error: errorFor("year") })}
                      onBlur={touch("year")}
                      onChange={(event) => update({ year: onlyDigits(event.target.value).slice(0, 4) })}
                    />
                  </Field>
                  <Field id={fieldId("mileageKm")} label="Kilometre" error={errorFor("mileageKm")}>
                    <GroupedNumberInput
                      id={fieldId("mileageKm")}
                      placeholder="85.000"
                      trailing="km"
                      maxDigits={MAX_MILEAGE_DIGITS}
                      value={draft.mileageKm}
                      invalid={Boolean(errorFor("mileageKm"))}
                      aria-describedby={describedBy(fieldId("mileageKm"), { error: errorFor("mileageKm") })}
                      onBlur={touch("mileageKm")}
                      onValueChange={(mileageKm) => update({ mileageKm })}
                    />
                  </Field>
                </div>
              )}
            </FormCard>

            <FormCard title="Özellikler">
              <div className="flex flex-col gap-5">
                <Field id={fieldId("bodyType")} label="Kasa tipi" error={errorFor("bodyType")} asGroup>
                  <ChoiceGroup<BodyType>
                    id={fieldId("bodyType")}
                    name="bodyType"
                    columns={3}
                    options={BODY_TYPE_OPTIONS}
                    value={draft.bodyType}
                    invalid={Boolean(errorFor("bodyType"))}
                    onChange={(bodyType) => update({ bodyType })}
                  />
                </Field>
                <Field id={fieldId("fuelType")} label="Yakıt türü" error={errorFor("fuelType")} asGroup>
                  <ChoiceGroup<FuelType>
                    id={fieldId("fuelType")}
                    name="fuelType"
                    columns={3}
                    options={FUEL_OPTIONS}
                    value={draft.fuelType}
                    invalid={Boolean(errorFor("fuelType"))}
                    onChange={(fuelType) => update({ fuelType })}
                  />
                </Field>
                <Field id={fieldId("transmission")} label="Vites" error={errorFor("transmission")} asGroup>
                  <ChoiceGroup<TransmissionType>
                    id={fieldId("transmission")}
                    name="transmission"
                    options={TRANSMISSION_OPTIONS}
                    value={draft.transmission}
                    invalid={Boolean(errorFor("transmission"))}
                    onChange={(transmission) => update({ transmission })}
                  />
                </Field>
                <Field id="sell-damageStatus" label="Hasar durumu" asGroup>
                  <ChoiceGroup<DamageStatus>
                    id="sell-damageStatus"
                    name="damageStatus"
                    options={DAMAGE_OPTIONS}
                    value={draft.damageStatus}
                    invalid={false}
                    onChange={(damageStatus) => update({ damageStatus })}
                  />
                </Field>
              </div>
            </FormCard>

            {/* Boyalı / değişen sayıları buradan hesaplanır (lib/body-parts.ts); satıcı ayrıca sayı girmez */}
            <FormCard
              title="Boya ve değişen"
              tag={{ label: "İsteğe bağlı", tone: "optional" }}
              description="Boyalı ya da değişen parça varsa şemada işaretle. Dokunmazsan bütün parçalar orijinal sayılır."
            >
              <BodyPartsEditor
                id="sell-bodyParts"
                value={draft.bodyParts ?? {}}
                onChange={(bodyParts) => update({ bodyParts })}
              />
            </FormCard>
          </>
        ) : current.id === "media" ? (
          <>
            <FormCard
              title="Video"
              tag={{ label: "Zorunlu", tone: "required" }}
              description="Alıcılar ilanı akışta bu videoyla görür."
            >
              <VideoDropzone
                id={VIDEO_INPUT_ID}
                video={video}
                error={mediaError}
                disabled={false}
                maxSeconds={MAX_VIDEO_DURATION_SECONDS}
                maxBytes={MAX_VIDEO_FILE_BYTES}
                onPick={handleVideoPick}
                onRemove={removeVideo}
              />
            </FormCard>
            <FormCard
              title="Fotoğraflar"
              tag={{ label: "İsteğe bağlı", tone: "optional" }}
              description="İlk fotoğraf arama sonuçlarında kapak olur."
            >
              <PhotoDropzone
                id={PHOTOS_INPUT_ID}
                photos={photos}
                error={photoError}
                disabled={checkingPhotos}
                checking={checkingPhotos}
                onPick={(files) => void handlePhotosPick(files)}
                onRemove={removePhoto}
              />
            </FormCard>
          </>
        ) : (
          <>
            <FormCard title="Fiyat ve konum">
              <div className="flex flex-col gap-4">
                <Field id={fieldId("price")} label="Fiyat" error={errorFor("price")}>
                  <GroupedNumberInput
                    id={fieldId("price")}
                    placeholder="750.000"
                    leading="₺"
                    maxDigits={MAX_PRICE_DIGITS}
                    value={draft.price}
                    invalid={Boolean(errorFor("price"))}
                    aria-describedby={describedBy(fieldId("price"), { error: errorFor("price") })}
                    onBlur={touch("price")}
                    onValueChange={(price) => update({ price })}
                    className="text-[18px] font-semibold tabular-nums"
                  />
                </Field>
                <Field id={fieldId("city")} label="Şehir" error={errorFor("city")}>
                  <TextInput
                    id={fieldId("city")}
                    list="sell-city-list"
                    autoComplete="address-level1"
                    placeholder="İstanbul"
                    leading={<MapPin className="h-4 w-4" />}
                    value={draft.city}
                    invalid={Boolean(errorFor("city"))}
                    aria-describedby={describedBy(fieldId("city"), { error: errorFor("city") })}
                    onBlur={touch("city")}
                    onChange={(event) => update({ city: event.target.value })}
                  />
                  <datalist id="sell-city-list">
                    {TURKISH_CITIES.map((city) => (
                      <option key={city} value={city} />
                    ))}
                  </datalist>
                </Field>
              </div>
            </FormCard>

            <FormCard title="Açıklama" tag={{ label: "İsteğe bağlı", tone: "optional" }}>
              <label htmlFor="sell-description" className="sr-only">
                Açıklama
              </label>
              <textarea
                id={fieldId("description")}
                rows={4}
                placeholder="Bakım geçmişi, ekstralar, değişen parçalar…"
                value={draft.description}
                onChange={(event) => update({ description: event.target.value })}
                onBlur={touch("description")}
                aria-invalid={Boolean(errorFor("description"))}
                aria-describedby={describedBy(fieldId("description"), { error: errorFor("description") })}
                className={controlClass(Boolean(errorFor("description")), "block resize-y px-3.5 py-3 leading-relaxed")}
              />
              <FieldError id={fieldId("description")} message={errorFor("description")} />
            </FormCard>

            <FormCard title="İletişim">
              <Field
                id={fieldId("whatsapp")}
                label="WhatsApp numarası"
                error={errorFor("whatsapp")}
                hint="Alıcılar “WhatsApp'tan yaz” butonuyla bu numaraya ulaşır."
              >
                <TextInput
                  id={fieldId("whatsapp")}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="05XX XXX XX XX"
                  leading={<Phone className="h-4 w-4" />}
                  value={draft.whatsapp}
                  invalid={Boolean(errorFor("whatsapp"))}
                  aria-describedby={describedBy(fieldId("whatsapp"), { error: errorFor("whatsapp"), hint: true })}
                  onBlur={touch("whatsapp")}
                  onChange={(event) => update({ whatsapp: event.target.value })}
                />
              </Field>
            </FormCard>

            <FormCard title="Özet">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
                <dt className="text-[#5B616B]">Araç</dt>
                <dd className="text-right font-semibold">
                  {[brandName, modelName, draft.year].filter(Boolean).join(" ") || "—"}
                </dd>
                <dt className="text-[#5B616B]">Kilometre</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {draft.mileageKm ? `${groupThousands(draft.mileageKm)} km` : "—"}
                </dd>
                <dt className="text-[#5B616B]">Fiyat</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {draft.price ? `₺${groupThousands(draft.price)}` : "—"}
                </dd>
                <dt className="text-[#5B616B]">Boya / değişen</dt>
                <dd className="text-right font-semibold">{bodyPartsSummary(draft.bodyParts ?? {})}</dd>
                <dt className="text-[#5B616B]">Medya</dt>
                <dd className="text-right font-semibold">
                  {video ? "Video" : "Video yok"}
                  {photos.length > 0 ? ` · ${photos.length} fotoğraf` : ""}
                </dd>
              </dl>
            </FormCard>

            <p className="px-1 text-[13px] leading-snug text-[#5B616B]">
              İlanı oluşturarak{" "}
              <Link href="/terms" className="font-semibold text-[#003399] underline underline-offset-2">
                Kullanım Koşulları
              </Link>
              &apos;nı kabul etmiş olursun. Kurallara aykırı ilanlar yayından kaldırılır.
            </p>
          </>
        )}

        <div role="status" aria-live="polite">
          {submitError && (
            <p className="flex items-start gap-2 rounded-xl border border-[#F1C7C3] bg-[#FDEDEC] px-3.5 py-3 text-[14px] text-[#B42318]">
              <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              {submitError}
            </p>
          )}
        </div>

        <SellActionBar
          stepIndex={step}
          stepCount={LISTING_STEPS.length}
          stepTitle={current.title}
          submitting={isSubmitting}
          submitPercent={overallSubmitPercent(phase, uploadPercent)}
          submitLabel={submitPhaseLabel(phase, uploadPercent)}
          disabled={step === LAST_STEP && isSessionLoading}
          onBack={() => goToStep(step - 1)}
        />
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

/** Yazılan marka/model adını kataloğun id'lerine çevirir (bkz. *_user_catalog_entries.sql) */
async function resolveCatalog(catalog: CatalogSelection): Promise<{ brand_id: string; model_id: string }> {
  const { data, error } = await supabase.rpc("resolve_listing_catalog", catalogRpcArgs(catalog));
  const row = (Array.isArray(data) ? data[0] : data) as { brand_id?: string; model_id?: string } | null;
  if (error || !row?.brand_id || !row?.model_id) {
    throw new Error("Marka/model kaydedilemedi: " + (error?.message ?? "bilinmeyen hata"));
  }
  return { brand_id: row.brand_id, model_id: row.model_id };
}

async function uploadPhotos(vehicleId: string, photos: PickedPhoto[]): Promise<void> {
  const rows: VehicleImageRow[] = [];

  for (let i = 0; i < photos.length; i += 1) {
    // Yol ve tür, ilk baytlardan okunan gerçek türden (tarayıcının bildirdiği tür değil)
    const { path, body } = photoUpload(vehicleId, i, photos[i].file, photos[i].type);
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, body, { upsert: true, contentType: photos[i].type });
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
