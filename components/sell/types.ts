import type { ImageType } from "../../lib/image-file";

// /sell formunda seçilen medya. previewUrl: URL.createObjectURL ile açılır,
// kaldırılınca ya da sayfadan çıkılınca serbest bırakılır.

export type PickedVideo = {
  file: File;
  previewUrl: string;
  durationSeconds: number | null;
  isVertical: boolean | null;
};

/** type: dosyanın ilk baytlarından okunan gerçek tür; yükleme yolu ve gövdesi bununla (lib/listing.ts photoUpload) */
export type PickedPhoto = { file: File; type: ImageType; previewUrl: string };
