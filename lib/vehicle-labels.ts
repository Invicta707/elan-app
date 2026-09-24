import type { FuelType, TransmissionType } from "./feed";
import type { BodyType } from "./search";

// Araç özelliklerinin ekranda görünen adları. Anahtar sırası /sell formundaki
// seçeneklerin sırasıdır (Object.keys ekleme sırasını korur).

export const FUEL_LABELS: Record<FuelType, string> = {
  benzin: "Benzin",
  dizel: "Dizel",
  hibrit: "Hibrit",
  elektrik: "Elektrik",
  lpg: "LPG",
};

export const TRANSMISSION_LABELS: Record<TransmissionType, string> = {
  otomatik: "Otomatik",
  manuel: "Manuel",
};

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  sedan: "Sedan",
  hatchback: "Hatchback",
  suv: "SUV",
  crossover: "Crossover",
  coupe: "Coupe",
  cabrio: "Cabrio",
  station_wagon: "Station Wagon",
  pickup: "Pickup",
  minivan: "Minivan",
};
