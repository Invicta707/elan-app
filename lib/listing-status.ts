// İlan durumları ve satıcının yapabileceği geçişler. UI'dan bağımsız.
// Asıl denetim veritabanındaki set_vehicle_status'tadır; buradaki tablo
// sadece hangi butonların gösterileceğini belirler. İkisinin aynı kaldığını
// lib/listing-status.test.ts migration dosyasını okuyarak doğrular.

export type VehicleStatus = "draft" | "pending_video" | "active" | "sold" | "archived";

export const VEHICLE_STATUSES: readonly VehicleStatus[] = [
  "draft",
  "pending_video",
  "active",
  "sold",
  "archived",
];

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  draft: "Taslak",
  pending_video: "Video işleniyor",
  active: "Yayında",
  sold: "Satıldı",
  archived: "Yayından kaldırıldı",
};

export const OWNER_TRANSITIONS: Record<VehicleStatus, readonly VehicleStatus[]> = {
  active: ["sold", "archived"],
  archived: ["active", "sold"],
  draft: ["archived"],
  pending_video: ["archived"],
  sold: [],
};

export function canTransition(from: VehicleStatus, to: VehicleStatus): boolean {
  return OWNER_TRANSITIONS[from].includes(to);
}

export type StatusAction = {
  target: VehicleStatus;
  label: string;
  /** Geri alınamayan işlemde onay metni; null ise tek dokunuşla uygulanır */
  confirm: string | null;
  tone: "primary" | "neutral" | "danger";
};

function actionFor(from: VehicleStatus, target: VehicleStatus): StatusAction {
  switch (target) {
    case "sold":
      return {
        target,
        label: "Satıldı olarak işaretle",
        confirm: "İlan satıldı olarak işaretlensin mi? Bu işlem geri alınamaz.",
        tone: "danger",
      };
    case "active":
      return { target, label: "Yayına al", confirm: null, tone: "primary" };
    case "archived":
      // Hiç yayınlanmamış ilan için "geri çek", yayındaki için "yayından kaldır"
      return {
        target,
        label: from === "active" ? "Yayından kaldır" : "İlanı geri çek",
        confirm: null,
        tone: "neutral",
      };
    default:
      return { target, label: STATUS_LABELS[target], confirm: null, tone: "neutral" };
  }
}

/** Bu durumdaki bir ilan için gösterilecek aksiyonlar. */
export function statusActions(status: VehicleStatus): StatusAction[] {
  return OWNER_TRANSITIONS[status].map((target) => actionFor(status, target));
}
