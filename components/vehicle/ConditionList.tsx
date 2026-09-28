import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { FeedVehicle } from "../../lib/feed";

// Ekspertiz özeti: boya, değişen parça, tramer ve ağır hasar, durum rozetleri
// olarak. Olumlu durum (boyasız, değişensiz, tramer yok, ağır hasar yok) koyu
// zümrüt rozette onay simgesiyle; boya ve tramer amber, değişen parça ve ağır
// hasar kırmızı rozette. Masaüstü "İlan detayı" çekmecesi (koyu) ve mobil
// detay penceresi (açık) aynı listeyi çizer; altında boya/değişen şeması.

export type ConditionTone = "positive" | "warning" | "danger";
type Theme = "dark" | "light";

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

type ConditionFields = Pick<FeedVehicle, "paintedPartsCount" | "changedPartsCount" | "tramerAmount" | "hasHeavyDamage">;

export function conditionItems(v: ConditionFields): { label: string; tone: ConditionTone }[] {
  return [
    v.paintedPartsCount === 0
      ? { label: "Boyasız", tone: "positive" }
      : { label: `${v.paintedPartsCount} parça boyalı`, tone: "warning" },
    v.changedPartsCount === 0
      ? { label: "Değişensiz", tone: "positive" }
      : { label: `${v.changedPartsCount} parça değişen`, tone: "danger" },
    v.tramerAmount === 0
      ? { label: "Tramer kaydı yok", tone: "positive" }
      : { label: `Tramer ${tryFormatter.format(v.tramerAmount)}`, tone: "warning" },
    v.hasHeavyDamage
      ? { label: "Ağır hasar kayıtlı", tone: "danger" }
      : { label: "Ağır hasar kaydı yok", tone: "positive" },
  ];
}

const BADGES: Record<Theme, Record<ConditionTone, string>> = {
  dark: {
    positive: "bg-emerald-950/40 text-emerald-400 border-emerald-800/40",
    warning: "bg-amber-950/40 text-amber-400 border-amber-800/40",
    danger: "bg-red-950/40 text-red-400 border-red-800/40",
  },
  // Beyaz zeminde aynı renkler okunmaz: açık zeminli, koyu metinli karşılıkları
  light: {
    positive: "bg-emerald-50 text-emerald-800 border-emerald-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
  },
};

const ICONS = { positive: CheckCircle2, warning: AlertTriangle, danger: ShieldAlert } as const;

export default function ConditionList({
  vehicle,
  tone,
  className = "",
}: {
  vehicle: ConditionFields;
  tone: Theme;
  className?: string;
}) {
  return (
    <ul aria-label="Ekspertiz özeti" className={`flex flex-wrap gap-1.5 ${className}`}>
      {conditionItems(vehicle).map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <li
            key={item.label}
            data-condition={item.tone}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium ${BADGES[tone][item.tone]}`}
          >
            <Icon aria-hidden="true" className="h-[13px] w-[13px] shrink-0" strokeWidth={2.4} />
            {item.label}
          </li>
        );
      })}
    </ul>
  );
}
