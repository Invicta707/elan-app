const amountFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

const CURRENCIES: Record<string, { symbol: string; spoken: string }> = {
  TRY: { symbol: "₺", spoken: "TL" },
  USD: { symbol: "$", spoken: "dolar" },
  EUR: { symbol: "€", spoken: "euro" },
};

/** Para biriminin simgesi ve okunuşu (bilinmeyen kod olduğu gibi) */
export function currencyParts(currency: string): { symbol: string; spoken: string } {
  return CURRENCIES[currency] ?? { symbol: currency, spoken: currency };
}

const SIZES = {
  // Masaüstü yan panel
  md: {
    plate: "h-11 rounded-[5px] border-2 shadow-[0_3px_0_rgba(0,0,0,0.45)]",
    strip: "w-7 text-[15px]",
    amount: "px-3 text-[2rem] tracking-[0.01em]",
  },
  // Mobil akış kartı: videonun alt şeridinde küçük etiket
  sm: {
    plate: "h-7 rounded-[4px] border-[1.5px] shadow-[0_2px_0_rgba(0,0,0,0.35)]",
    strip: "w-[18px] text-[11px]",
    amount: "px-1.5 text-[19px]",
  },
} as const;

// Fiyat, Türkiye plakasından esinlenen bir etikette: soldaki mavi şeritte para
// birimi. Akış kartı (video üstünde, küçük) ve masaüstü yan panel aynı etiketi kullanır.
export default function PricePlate({
  price,
  currency,
  size = "md",
  className = "",
}: {
  price: number;
  currency: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { symbol, spoken } = currencyParts(currency);
  const s = SIZES[size];
  return (
    <p className={`inline-flex shrink-0 items-stretch overflow-hidden border-black bg-white text-black ${s.plate} ${className}`}>
      <span aria-hidden="true" className={`flex items-center justify-center bg-[#003399] font-semibold text-white ${s.strip}`}>
        {symbol}
      </span>
      <span className={`flex items-center font-extrabold leading-none tabular-nums [font-family:var(--font-display)] ${s.amount}`}>
        {amountFormatter.format(price)}
        <span className="sr-only"> {spoken}</span>
      </span>
    </p>
  );
}
