import { describe, expect, it } from "vitest";
import { overallSubmitPercent, submitPhaseLabel, submitStepStatuses, type SubmitPhase } from "./sell-progress";

describe("submitStepStatuses", () => {
  it("aşamaya göre önceki adımlar tamam, şimdiki sürüyor, sonrakiler bekliyor", () => {
    expect(submitStepStatuses("uploading-video", { hasPhotos: true, processingConfirmed: false })).toEqual({
      listing: "done",
      photos: "done",
      "video-upload": "active",
      "video-processing": "pending",
    });
    expect(submitStepStatuses("creating-listing", { hasPhotos: true, processingConfirmed: false })).toEqual({
      listing: "active",
      photos: "pending",
      "video-upload": "pending",
      "video-processing": "pending",
    });
  });

  it("fotoğraf yoksa fotoğraf adımı, ilan kaydından sonra atlandı sayılır", () => {
    expect(submitStepStatuses("creating-listing", { hasPhotos: false, processingConfirmed: false }).photos).toBe(
      "pending",
    );
    expect(submitStepStatuses("requesting-upload-url", { hasPhotos: false, processingConfirmed: false }).photos).toBe(
      "skipped",
    );
  });

  it("gönderim bitince video işleme canlıda sürüyor görünür; yerelde onaylandıysa tamam", () => {
    expect(submitStepStatuses("done", { hasPhotos: true, processingConfirmed: false })["video-processing"]).toBe(
      "active",
    );
    expect(submitStepStatuses("done", { hasPhotos: true, processingConfirmed: true })).toEqual({
      listing: "done",
      photos: "done",
      "video-upload": "done",
      "video-processing": "done",
    });
  });
});

describe("overallSubmitPercent", () => {
  it("aşamalar boyunca hiç geri gitmez ve 100'de biter", () => {
    const sequence: [SubmitPhase, number][] = [
      ["idle", 0],
      ["creating-listing", 0],
      ["uploading-photos", 0],
      ["requesting-upload-url", 0],
      ["uploading-video", 0],
      ["uploading-video", 50],
      ["uploading-video", 100],
      ["processing-video", 100],
      ["done", 100],
    ];
    const percents = sequence.map(([phase, upload]) => overallSubmitPercent(phase, upload));
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(100);
  });

  it("video yüzdesi sınır dışındaysa kırpılır", () => {
    expect(overallSubmitPercent("uploading-video", -10)).toBe(20);
    expect(overallSubmitPercent("uploading-video", 150)).toBe(95);
  });
});

describe("submitPhaseLabel", () => {
  it("video yüklemesinde yüzdeyi gösterir", () => {
    expect(submitPhaseLabel("uploading-video", 42)).toBe("Video yükleniyor… %42");
    expect(submitPhaseLabel("idle", 0)).toBe("");
  });
});
