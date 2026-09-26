// /sell formunda seçilen medya. previewUrl: URL.createObjectURL ile açılır,
// kaldırılınca ya da sayfadan çıkılınca serbest bırakılır.

export type PickedVideo = {
  file: File;
  previewUrl: string;
  durationSeconds: number | null;
  isVertical: boolean | null;
};

export type PickedPhoto = { file: File; previewUrl: string };
