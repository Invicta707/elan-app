// @vitest-environment happy-dom
//
// "Uygulamayı yükle" (lib/install-prompt.ts, components/pwa/InstallAppButton.tsx):
// beforeinstallprompt yakalanır (tarayıcının kendi çubuğu çıkmaz), mobil akışta
// hap görünür; ✕ ya da tarayıcı penceresinde "İptal" 7 gün gizler (localStorage);
// uygulama olarak açıkken ve kurulunca hiç görünmez.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InstallAppButton from "../components/pwa/InstallAppButton";
import {
  INSTALL_DISMISS_KEY,
  INSTALL_DISMISS_MS,
  isInstallDismissed,
  promptInstall,
  resetInstallPrompt,
} from "./install-prompt";

type Choice = "accepted" | "dismissed";

/** Chromium'un beforeinstallprompt olayının taklidi */
function fireInstallPrompt(choice: Choice = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: Choice; platform: string }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome: choice, platform: "web" });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function setStandalone(standalone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const pill = () => screen.queryByRole("button", { name: "Uygulamayı yükle" });

beforeEach(() => {
  localStorage.clear();
  setStandalone(false);
  resetInstallPrompt();
});

afterEach(() => {
  cleanup();
});

describe("olay yakalama", () => {
  it("olay gelmeden hap yok; gelince tarayıcının çubuğu engellenir ve hap belirir", () => {
    render(<InstallAppButton />);
    expect(pill()).toBeNull();
    const event = fireInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    expect(pill()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Şimdi değil" })).toBeTruthy();
  });

  it("hap render'dan önce gelen olayı da gösterir (dinleyici modül yüklenince bağlı)", () => {
    fireInstallPrompt();
    render(<InstallAppButton />);
    expect(pill()).not.toBeNull();
  });

  it("uygulama olarak açıkken (standalone / TWA) görünmez", () => {
    setStandalone(true);
    resetInstallPrompt();
    render(<InstallAppButton />);
    fireInstallPrompt();
    expect(pill()).toBeNull();
  });
});

describe("kurulum", () => {
  it("Yükle: tarayıcının penceresi açılır; kabul edilirse hap kaybolur, bekleme yazılmaz", async () => {
    render(<InstallAppButton />);
    const event = fireInstallPrompt("accepted");
    await act(async () => {
      fireEvent.click(pill()!);
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(pill()).toBeNull();
    expect(localStorage.getItem(INSTALL_DISMISS_KEY)).toBeNull();
  });

  it("tarayıcı penceresinde İptal: 7 günlük bekleme başlar", async () => {
    render(<InstallAppButton />);
    fireInstallPrompt("dismissed");
    await act(async () => {
      fireEvent.click(pill()!);
    });
    expect(pill()).toBeNull();
    expect(isInstallDismissed()).toBe(true);
  });

  it("olay bir kez kullanılır; saklanan olay yoksa unavailable", async () => {
    const event = fireInstallPrompt();
    expect(await promptInstall()).toBe("accepted");
    expect(await promptInstall()).toBe("unavailable");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("uygulama kurulunca (appinstalled) hap gizlenir", () => {
    render(<InstallAppButton />);
    fireInstallPrompt();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(pill()).toBeNull();
  });
});

describe("7 gün gösterme", () => {
  it("✕: hap kaybolur, zaman damgası yazılır; aynı sayfada yeni olay gelse de görünmez", () => {
    render(<InstallAppButton />);
    fireInstallPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Şimdi değil" }));
    expect(pill()).toBeNull();
    expect(Number(localStorage.getItem(INSTALL_DISMISS_KEY))).toBeGreaterThan(0);
    fireInstallPrompt();
    expect(pill()).toBeNull();
  });

  it("sonraki ziyarette 7 gün dolmadıysa gizli, dolunca yeniden görünür", () => {
    const now = Date.now();
    localStorage.setItem(INSTALL_DISMISS_KEY, String(now - INSTALL_DISMISS_MS + 60_000));
    resetInstallPrompt();
    const first = render(<InstallAppButton />);
    fireInstallPrompt();
    expect(pill()).toBeNull();
    first.unmount();

    localStorage.setItem(INSTALL_DISMISS_KEY, String(now - INSTALL_DISMISS_MS - 1));
    resetInstallPrompt();
    render(<InstallAppButton />);
    fireInstallPrompt();
    expect(pill()).not.toBeNull();
  });

  it("isInstallDismissed: bozuk kayıt, gelecekteki zaman ve depolama hatası gizlemez", () => {
    const now = 1_800_000_000_000;
    const storage = (value: string | null) => ({ getItem: () => value }) as unknown as Storage;
    expect(isInstallDismissed(now, storage(String(now - 1000)))).toBe(true);
    expect(isInstallDismissed(now, storage(String(now - INSTALL_DISMISS_MS)))).toBe(false);
    expect(isInstallDismissed(now, storage("bozuk"))).toBe(false);
    expect(isInstallDismissed(now, storage(String(now + 60_000)))).toBe(false);
    expect(isInstallDismissed(now, storage(null))).toBe(false);
    expect(isInstallDismissed(now, null)).toBe(false);
    const throwing = { getItem: () => { throw new Error("SecurityError"); } } as unknown as Storage;
    expect(isInstallDismissed(now, throwing)).toBe(false);
  });
});

describe("yerleşim", () => {
  it("videoyu kapatmaz: küçük hap, Filtrele'nin altında, dokunuşları yalnızca kendisi alır", () => {
    const { container } = render(<InstallAppButton />);
    fireInstallPrompt();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("pointer-events-none");
    expect(wrapper.className).toContain("top-[calc(env(safe-area-inset-top)+6.25rem)]");
    const body = container.querySelector("[data-install-pill]") as HTMLElement;
    expect(body.className).toContain("pointer-events-auto");
    expect(pill()!.className).toContain("h-8");
    expect(pill()!.textContent).toBe("Uygulamayı yükle");
  });
});
