"use client";

import { Clock, FileImage, Film, HardDrive, ImagePlus, Images, LoaderCircle, Smartphone, Star, Video, X } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { MAX_PHOTOS, MAX_PHOTO_BYTES } from "../../lib/listing";
import { FieldError } from "./FormControls";
import type { PickedPhoto, PickedVideo } from "./types";

// Medya alanları: sürükle-bırak ya da dokunarak seçim, önizleme, sınır bilgisi.
// Dosyaların kurallara uygunluğu sayfada (handleVideoPick / handlePhotosPick)
// denetlenir; burası yalnızca seçimi iletir ve durumu gösterir.

const MB = 1024 * 1024;

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** Sınırları ikonlu kısa etiketlerle gösterir */
function LimitList({ id, items }: { id: string; items: { icon: ReactNode; text: string }[] }) {
  return (
    <ul id={id} className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-[#5B616B]">
      {items.map((item) => (
        <li key={item.text} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-[#8A9099]">
            {item.icon}
          </span>
          {item.text}
        </li>
      ))}
    </ul>
  );
}

/** Sürüklenen dosyayı bırakma alanı; disabled iken dosya kabul etmez */
function useDropTarget(disabled: boolean, onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (disabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled && event.dataTransfer.files.length > 0) onFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
}

const DROPZONE =
  "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#003399]/20 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

function dropzoneTone(dragging: boolean, invalid: boolean) {
  if (dragging) return "border-[#003399] bg-[#EAEFF7]";
  if (invalid) return "border-[#F1B5AF] bg-[#FFFBFA] hover:border-[#D92D20]";
  return "border-[#C9CED6] bg-[#FAFBFC] hover:border-[#003399] hover:bg-[#F5F7FB]";
}

export function VideoDropzone({
  id,
  video,
  error,
  disabled,
  maxSeconds,
  maxBytes,
  onPick,
  onRemove,
}: {
  id: string;
  video: PickedVideo | null;
  error: string | null;
  disabled: boolean;
  maxSeconds: number;
  maxBytes: number;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const { dragging, handlers } = useDropTarget(disabled, (files) => onPick(files[0]));
  const limitsId = `${id}-limits`;
  const limits = [
    { icon: <Smartphone className="h-3.5 w-3.5" />, text: "Dikey (portre)" },
    { icon: <Clock className="h-3.5 w-3.5" />, text: `En fazla ${maxSeconds} sn` },
    { icon: <HardDrive className="h-3.5 w-3.5" />, text: `En fazla ${Math.round(maxBytes / MB)} MB` },
  ];

  const input = (
    <input
      id={id}
      type="file"
      accept="video/*"
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : limitsId}
      onChange={(event) => {
        onPick(event.target.files?.[0]);
        event.target.value = "";
      }}
      className="sr-only"
    />
  );

  if (video) {
    return (
      <div>
        <div
          {...handlers}
          className={`flex gap-4 rounded-2xl border p-3 transition-colors ${
            dragging ? "border-[#003399] bg-[#EAEFF7]" : "border-[#E3E6EA] bg-[#FAFBFC]"
          }`}
        >
          <div className="relative aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-xl bg-black sm:w-32">
            <video src={video.previewUrl} className="h-full w-full object-cover" muted playsInline />
            {video.durationSeconds !== null && (
              <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                {formatDuration(video.durationSeconds)}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[#E6F6EC] px-2 py-0.5 text-[12px] font-semibold text-[#1B7A3D]">
              <Video aria-hidden="true" className="h-3.5 w-3.5" />
              Video hazır
            </span>
            <p className="mt-2 truncate text-[14px] font-semibold text-[#15181C]" title={video.file.name}>
              {video.file.name}
            </p>
            <p className="mt-0.5 text-[13px] text-[#5B616B]">
              {formatSize(video.file.size)}
              {video.durationSeconds !== null && ` · ${formatDuration(video.durationSeconds)}`}
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-3">
              <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[#D5D9DF] bg-white px-3 text-[14px] font-semibold text-[#15181C] hover:border-[#B9BFC8] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#003399]/20 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                Değiştir
                {input}
              </label>
              <button
                type="button"
                onClick={onRemove}
                disabled={disabled}
                className="inline-flex h-10 items-center rounded-lg px-3 text-[14px] font-semibold text-[#B42318] hover:bg-[#FDEDEC] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#D92D20]/20"
              >
                Kaldır
              </button>
            </div>
          </div>
        </div>
        <FieldError id={id} message={error} />
      </div>
    );
  }

  return (
    <div>
      <label {...handlers} className={`${DROPZONE} ${dropzoneTone(dragging, Boolean(error))} min-h-44 px-5 py-7`}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EAEFF7] text-[#003399]">
          <Film aria-hidden="true" className="h-6 w-6" />
        </span>
        <span className="mt-3 text-[15px] font-semibold text-[#15181C]">Dikey video yükle</span>
        <span className="mt-0.5 text-[13px] text-[#5B616B]">
          Sürükleyip bırak ya da <span className="font-semibold text-[#003399]">dosya seç</span>
        </span>
        {input}
      </label>
      {error ? <FieldError id={id} message={error} /> : null}
      <LimitList id={limitsId} items={limits} />
    </div>
  );
}

export function PhotoDropzone({
  id,
  photos,
  error,
  disabled,
  checking = false,
  onPick,
  onRemove,
}: {
  id: string;
  photos: PickedPhoto[];
  error: string | null;
  disabled: boolean;
  /** Seçilen fotoğraflar denetleniyor (tür, imza, açılabilirlik) */
  checking?: boolean;
  onPick: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const { dragging, handlers } = useDropTarget(disabled || photos.length >= MAX_PHOTOS, onPick);
  const limitsId = `${id}-limits`;
  const limits = [
    { icon: <FileImage className="h-3.5 w-3.5" />, text: "JPEG, PNG, WebP" },
    { icon: <HardDrive className="h-3.5 w-3.5" />, text: `Fotoğraf başına en fazla ${MAX_PHOTO_BYTES / MB} MB` },
    { icon: <Images className="h-3.5 w-3.5" />, text: `En fazla ${MAX_PHOTOS} fotoğraf` },
  ];

  const input = (
    <input
      id={id}
      type="file"
      // HEIC seçilebilsin diye image/*: iPhone Safari JPEG'e çevirir; diğerleri
      // seçimde açık bir mesajla reddedilir (lib/image-decode.ts inspectImageFile)
      accept="image/*"
      multiple
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : limitsId}
      onChange={(event) => {
        onPick(Array.from(event.target.files ?? []));
        event.target.value = "";
      }}
      className="sr-only"
    />
  );

  return (
    <div>
      {photos.length === 0 ? (
        <label {...handlers} className={`${DROPZONE} ${dropzoneTone(dragging, Boolean(error))} min-h-36 px-5 py-6`}>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EAEFF7] text-[#003399]">
            <ImagePlus aria-hidden="true" className="h-6 w-6" />
          </span>
          <span className="mt-3 text-[15px] font-semibold text-[#15181C]">Fotoğraf ekle</span>
          <span className="mt-0.5 text-[13px] text-[#5B616B]">
            Sürükleyip bırak ya da <span className="font-semibold text-[#003399]">dosya seç</span>
          </span>
          {input}
        </label>
      ) : (
        <div
          {...handlers}
          className={`rounded-2xl border p-2 transition-colors ${
            dragging ? "border-[#003399] bg-[#EAEFF7]" : "border-transparent"
          }`}
        >
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((photo, index) => (
              <li
                key={photo.previewUrl}
                // Kapak, ızgarada 2×2 büyük kare olarak öne çıkar
                className={`relative aspect-square overflow-hidden rounded-xl bg-[#E6E8EB] ${
                  index === 0 ? "col-span-2 row-span-2" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- yerel object URL, next/image optimize edemez */}
                <img src={photo.previewUrl} alt={`${index + 1}. fotoğraf`} className="h-full w-full object-cover" />
                {index === 0 && (
                  <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-black/70 px-2.5 py-1 text-[12px] font-semibold text-white backdrop-blur-sm">
                    <Star aria-hidden="true" className="h-3 w-3 fill-current" />
                    Kapak fotoğrafı
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  disabled={disabled}
                  aria-label={`${index + 1}. fotoğrafı kaldır`}
                  className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
            {photos.length < MAX_PHOTOS && (
              <li>
                <label
                  className={`${DROPZONE} ${dropzoneTone(false, false)} aspect-square gap-1 text-[12.5px] font-semibold text-[#003399]`}
                >
                  <ImagePlus aria-hidden="true" className="h-5 w-5" />
                  Ekle
                  {input}
                </label>
              </li>
            )}
          </ul>
          <p className="mt-2 px-1 text-[12.5px] text-[#5B616B]">
            {photos.length}/{MAX_PHOTOS} fotoğraf · ilk fotoğraf aramalarda kapak olarak görünür
          </p>
        </div>
      )}
      {checking && (
        <p role="status" className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#5B616B]">
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          Fotoğraflar kontrol ediliyor…
        </p>
      )}
      <FieldError id={id} message={error} />
      <LimitList id={limitsId} items={limits} />
    </div>
  );
}
