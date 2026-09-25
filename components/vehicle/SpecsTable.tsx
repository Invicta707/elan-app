import type { ReactNode } from "react";
import { currencySymbol, formatAmount } from "../../lib/search";
import { BODY_TYPE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "../../lib/vehicle-labels";
import type { VehicleSpecs } from "../../lib/vehicle-page";

export function formatVehiclePrice(price: number, currency: string): string {
  return `${currencySymbol(currency)}${formatAmount(price)}`;
}

// Detay çekmecesi ve /vehicles/[id] sayfasındaki özellikler tablosu
export default function SpecsTable({ specs, headingId }: { specs: VehicleSpecs; headingId: string }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Marka", value: specs.brandName },
    { label: "Model", value: specs.modelName },
    { label: "Yıl", value: specs.year },
    { label: "Kilometre", value: `${formatAmount(specs.mileageKm)} km` },
    { label: "Fiyat", value: formatVehiclePrice(specs.price, specs.currency) },
    { label: "Yakıt türü", value: FUEL_LABELS[specs.fuelType] ?? specs.fuelType },
    { label: "Vites", value: TRANSMISSION_LABELS[specs.transmission] ?? specs.transmission },
    {
      label: "Kasa tipi",
      value: specs.bodyType === undefined ? "…" : specs.bodyType ? (BODY_TYPE_LABELS[specs.bodyType] ?? "—") : "—",
    },
    { label: "Şehir", value: specs.city ?? "—" },
    {
      label: "Hasar durumu",
      value: specs.hasHeavyDamage ? <span className="text-[#C4282E]">Ağır Hasarlı</span> : "Hasarsız / Hafif",
    },
  ];

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-2 text-[15px] font-semibold">
        Araç bilgileri
      </h3>
      <dl className="divide-y divide-[#E9ECEF] rounded-lg border border-[#E3E6EA] bg-white">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 px-3 py-2.5">
            <dt className="text-[14px] text-[#5B616B]">{row.label}</dt>
            <dd className="text-right text-[15px] font-semibold">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
