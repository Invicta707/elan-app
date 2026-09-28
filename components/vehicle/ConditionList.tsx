import type { FeedVehicle } from "../../lib/feed";

// Ekspertiz özeti: boya, değişen parça ve tramer, ekspertiz raporlarındaki
// renk kodlarıyla (orijinal / boyalı / değişen). Akış kartı ve masaüstü yan
// panel aynı listeyi çizer.

type ConditionTone = "original" | "painted" | "changed";

const TONE_MARKERS: Record<ConditionTone, string> = {
  original: "bg-[#E9ECEF]",
  painted: "bg-[#F5A524]",
  changed: "bg-[#E5484D]",
};

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

type ConditionFields = Pick<FeedVehicle, "paintedPartsCount" | "changedPartsCount" | "tramerAmount">;

export function conditionItems(v: ConditionFields): { label: string; tone: ConditionTone }[] {
  return [
    v.paintedPartsCount === 0
      ? { label: "Boyasız", tone: "original" }
      : { label: `${v.paintedPartsCount} parça boyalı`, tone: "painted" },
    v.changedPartsCount === 0
      ? { label: "Değişensiz", tone: "original" }
      : { label: `${v.changedPartsCount} parça değişen`, tone: "changed" },
    v.tramerAmount === 0
      ? { label: "Tramer kaydı yok", tone: "original" }
      : { label: `Tramer ${tryFormatter.format(v.tramerAmount)}`, tone: "painted" },
  ];
}

export default function ConditionList({ vehicle, className = "" }: { vehicle: ConditionFields; className?: string }) {
  return (
    <ul aria-label="Ekspertiz özeti" className={className}>
      {conditionItems(vehicle).map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[2px] ring-1 ring-black/40 ${TONE_MARKERS[item.tone]}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
