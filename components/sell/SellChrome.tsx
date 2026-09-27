"use client";

import { ArrowRight, Check, ChevronLeft, CircleCheck, Clock, LoaderCircle, Minus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  SUBMIT_STEPS,
  submitStepStatuses,
  type SubmitPhase,
  type SubmitStepStatus,
} from "../../lib/sell-progress";

// /sell çerçevesi: adım göstergesi, kartlar, gönderim ilerlemesi, alt aksiyon
// çubuğu ve başarı ekranı. Durum app/sell/page.tsx'te; bunlar yalnızca gösterir.

export function FormCard({
  title,
  tag,
  description,
  children,
}: {
  title: string;
  /** Başlığın yanındaki küçük etiket ("Zorunlu", "İsteğe bağlı") */
  tag?: { label: string; tone: "required" | "optional" };
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#E3E6EA] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[16px] font-semibold text-[#15181C]">{title}</h3>
          {tag && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
                tag.tone === "required" ? "bg-[#EAEFF7] text-[#003399]" : "bg-[#EEF0F3] text-[#5B616B]"
              }`}
            >
              {tag.label}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-[13.5px] leading-snug text-[#5B616B]">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function SellStepper({
  steps,
  current,
  reachable,
  onSelect,
  disabled,
}: {
  steps: readonly { id: string; title: string }[];
  current: number;
  /** Bu adıma gidilebilir mi (önceki adımlar geçerli ya da geri gidiliyor) */
  reachable: (index: number) => boolean;
  onSelect: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <nav aria-label="İlan verme adımları">
      <ol className="grid grid-cols-3 gap-2">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                disabled={disabled || active || !reachable(index)}
                aria-current={active ? "step" : undefined}
                className="group flex w-full flex-col items-start gap-2 rounded-lg text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/20"
              >
                <span
                  aria-hidden="true"
                  className={`h-1 w-full rounded-full transition-colors duration-300 ${
                    done || active ? "bg-[#003399]" : "bg-[#DDE1E6]"
                  }`}
                />
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      done
                        ? "bg-[#003399] text-white"
                        : active
                          ? "border-2 border-[#003399] text-[#003399]"
                          : "border-2 border-[#C9CED6] text-[#8A9099]"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" strokeWidth={3} /> : index + 1}
                  </span>
                  <span
                    className={`text-[12.5px] font-semibold leading-tight sm:text-[13.5px] ${
                      active ? "text-[#15181C]" : done ? "text-[#003399] group-enabled:group-hover:underline" : "text-[#8A9099]"
                    }`}
                  >
                    <span className="sr-only">
                      {index + 1}. adım{done ? " (tamamlandı)" : ""}:{" "}
                    </span>
                    {step.title}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const STATUS_BADGE: Record<SubmitStepStatus, { label: string; className: string }> = {
  pending: { label: "Bekliyor", className: "bg-[#EEF0F3] text-[#5B616B]" },
  active: { label: "Sürüyor", className: "bg-[#EAEFF7] text-[#003399]" },
  done: { label: "Tamamlandı", className: "bg-[#E6F6EC] text-[#1B7A3D]" },
  skipped: { label: "Yok", className: "bg-[#EEF0F3] text-[#8A9099]" },
};

function StatusIcon({ status }: { status: SubmitStepStatus }) {
  const common = "h-5 w-5 shrink-0";
  switch (status) {
    case "done":
      return <CircleCheck aria-hidden="true" className={`${common} text-[#1B7A3D]`} />;
    case "active":
      return <LoaderCircle aria-hidden="true" className={`${common} animate-spin text-[#003399]`} />;
    case "skipped":
      return <Minus aria-hidden="true" className={`${common} text-[#B9BFC8]`} />;
    default:
      return <Clock aria-hidden="true" className={`${common} text-[#B9BFC8]`} />;
  }
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 w-full overflow-hidden rounded-full bg-[#E3E6EA]"
    >
      <div
        className="h-full rounded-full bg-[#003399] transition-[width] duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Gönderim aşamaları: her adımın durum rozeti; video yüklemesinde yüzde çubuğu */
export function SubmitProgress({
  phase,
  uploadPercent,
  hasPhotos,
  processingConfirmed = false,
}: {
  phase: SubmitPhase;
  uploadPercent: number;
  hasPhotos: boolean;
  processingConfirmed?: boolean;
}) {
  const statuses = submitStepStatuses(phase, { hasPhotos, processingConfirmed });

  return (
    <ol className="flex flex-col divide-y divide-[#EEF0F3]">
      {SUBMIT_STEPS.map((step) => {
        const status = statuses[step.id];
        const badge = STATUS_BADGE[status];
        const showBar = step.id === "video-upload" && (phase === "uploading-video" || phase === "requesting-upload-url");
        return (
          <li key={step.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              <StatusIcon status={status} />
              <span className="flex-1 text-[14.5px] font-semibold text-[#15181C]">{step.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${badge.className}`}>
                {step.id === "video-processing" && status === "active" ? "İşleniyor" : badge.label}
              </span>
            </div>
            {showBar && (
              <div className="mt-2.5 pl-8">
                <ProgressBar percent={phase === "uploading-video" ? uploadPercent : 0} label="Video yükleme" />
                <p className="mt-1.5 text-[12.5px] tabular-nums text-[#5B616B]">
                  {phase === "uploading-video" ? `%${uploadPercent} yüklendi` : "Yükleme bağlantısı hazırlanıyor…"}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Alt aksiyon çubuğu: mobilde alt gezinme çubuğunun hemen üstünde sabit.
 * Adım durumu, ilerleme ve Geri / Devam et (son adımda İlanı oluştur).
 */
export function SellActionBar({
  stepIndex,
  stepCount,
  stepTitle,
  submitting,
  submitPercent,
  submitLabel,
  disabled,
  onBack,
}: {
  stepIndex: number;
  stepCount: number;
  stepTitle: string;
  submitting: boolean;
  submitPercent: number;
  submitLabel: string;
  disabled: boolean;
  onBack: () => void;
}) {
  const isLast = stepIndex === stepCount - 1;
  const percent = submitting ? submitPercent : Math.round(((stepIndex + 1) / stepCount) * 100);

  return (
    <div className="fixed inset-x-0 bottom-[var(--bottom-nav-height)] z-30 border-t border-[#E3E6EA] bg-white shadow-[0_-4px_16px_rgba(16,24,40,0.06)] md:pb-[env(safe-area-inset-bottom)]">
      <div
        aria-hidden="true"
        className="h-0.5 bg-[#003399] transition-[width] duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          {submitting ? (
            <>
              <p className="truncate text-[14px] font-semibold text-[#15181C]">{submitLabel}</p>
              <p className="text-[12.5px] tabular-nums text-[#5B616B]">%{submitPercent} tamamlandı</p>
            </>
          ) : (
            <>
              <p className="text-[12.5px] font-medium text-[#5B616B]">
                Adım {stepIndex + 1} / {stepCount}
              </p>
              <p className="truncate text-[14px] font-semibold text-[#15181C]">{stepTitle}</p>
            </>
          )}
        </div>

        {stepIndex > 0 && !submitting && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-12 items-center gap-1 rounded-xl px-3 text-[15px] font-semibold text-[#15181C] hover:bg-[#F2F3F5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/20"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            Geri
          </button>
        )}
        <button
          type="submit"
          disabled={disabled || submitting}
          aria-busy={submitting}
          className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#003399] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#002B82] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
        >
          {submitting ? (
            <>
              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
              Yayınlanıyor
            </>
          ) : isLast ? (
            "İlanı oluştur"
          ) : (
            <>
              Devam et
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function SellSuccess({
  hasPhotos,
  processingConfirmed,
  devNotice,
}: {
  hasPhotos: boolean;
  processingConfirmed: boolean;
  devNotice: string | null;
}) {
  return (
    <div className="mx-auto max-w-md px-4 pt-10 pb-[calc(3rem+var(--bottom-nav-height))]">
      <div className="rounded-2xl border border-[#E3E6EA] bg-white p-6 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#E6F6EC] text-[#1B7A3D]">
          <Check aria-hidden="true" className="h-7 w-7" strokeWidth={2.5} />
        </span>
        <h1 className="mt-4 text-[26px] font-semibold [font-family:var(--font-display)]">İlanın alındı!</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[#5B616B]">
          {processingConfirmed
            ? "Video işlendi; ilanın yayına alındı."
            : "Video işlenir işlenmez ilanın otomatik olarak yayına girecek. Bu genelde birkaç dakika sürer."}
        </p>

        <div className="mt-5 rounded-xl bg-[#FAFBFC] p-4 text-left">
          <SubmitProgress phase="done" uploadPercent={100} hasPhotos={hasPhotos} processingConfirmed={processingConfirmed} />
        </div>

        {devNotice && (
          <p className="mt-4 rounded-lg bg-[#FEF6E7] px-3 py-2 text-left text-[13px] text-[#8A6116]">{devNotice}</p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/my-listings"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-[#003399] text-[16px] font-semibold text-white hover:bg-[#002B82] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/30"
          >
            Vitrinimi gör
          </Link>
          <Link
            href="/"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-[#D5D9DF] bg-white text-[16px] font-semibold text-[#15181C] hover:border-[#B9BFC8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#003399]/20"
          >
            Akışa dön
          </Link>
        </div>
      </div>
    </div>
  );
}
