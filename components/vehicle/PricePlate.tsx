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

// Fiyat, Türkiye plakasından esinlenen bir etikette: soldaki mavi şeritte para
// birimi. Akış kartı (video üstünde) ve masaüstü yan panel aynı etiketi kullanır.
export default function PricePlate({
  price,
  currency,
  className = "",
}: {
  price: number;
  currency: string;
  className?: string;
}) {
  const { symbol, spoken } = currencyParts(currency);
  return (
    <p
      className={`inline-flex h-11 items-stretch overflow-hidden rounded-[5px] border-2 border-black bg-white text-black shadow-[0_3px_0_rgba(0,0,0,0.45)] ${className}`}
    >
      <span
        aria-hidden="true"
        className="flex w-7 items-center justify-center bg-[#003399] text-[15px] font-semibold text-white"
      >
        {symbol}
      </span>
      <span className="flex items-center px-3 text-[2rem] font-extrabold leading-none tracking-[0.01em] tabular-nums [font-family:var(--font-display)]">
        {amountFormatter.format(price)}
        <span className="sr-only"> {spoken}</span>
      </span>
    </p>
  );
}
