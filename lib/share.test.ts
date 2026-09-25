import { describe, expect, it, vi } from "vitest";
import { shareOrCopy, vehiclePath } from "./share";

const data = { url: "https://elan.test/vehicles/veh-1", title: "2021 Porsche 911", text: "Elan'da 2021 Porsche 911" };

describe("shareOrCopy", () => {
  it("Web Share API varsa sistem paylaşımını kullanır", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    await expect(shareOrCopy(data, { share, clipboard: { writeText } })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("kullanıcı paylaşım menüsünü kapatırsa kopyalamaz", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const writeText = vi.fn();
    await expect(shareOrCopy(data, { share, clipboard: { writeText } })).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("paylaşım başka bir hatayla başarısız olursa bağlantıyı kopyalar", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareOrCopy(data, { share, clipboard: { writeText } })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it("Web Share API yoksa bağlantıyı panoya kopyalar", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareOrCopy(data, { clipboard: { writeText } })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it("canShare veriyi reddederse kopyalamaya düşer", async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(
      shareOrCopy(data, { share, canShare: () => false, clipboard: { writeText } }),
    ).resolves.toBe("copied");
    expect(share).not.toHaveBeenCalled();
  });

  it("pano da çalışmazsa failed döner", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("no permission"));
    await expect(shareOrCopy(data, { clipboard: { writeText } })).resolves.toBe("failed");
    await expect(shareOrCopy(data, {})).resolves.toBe("failed");
  });
});

describe("vehiclePath", () => {
  it("paylaşılan kalıcı ilan adresi", () => {
    expect(vehiclePath("veh-1")).toBe("/vehicles/veh-1");
  });
});
