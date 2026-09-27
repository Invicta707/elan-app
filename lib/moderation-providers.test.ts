import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  ModerationProviderError,
  SIGHTENGINE_MODELS,
  createOpenAiModerators,
  createRekognitionModerator,
  createSightengineModerator,
  fetchImageBytes,
  isRetryableProviderError,
  moderationProvidersFromEnv,
  parseOpenAiModeration,
  parseRekognitionResponse,
  parseSightengineResponse,
} = await import("./moderation-providers");
const { decide } = await import("./content-moderation");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Sightengine'in belgelenen yanıt biçimi (nudity-2.1, weapon, violence, gore-2.0)
const SIGHTENGINE_CLEAN = {
  status: "success",
  request: { id: "req_1" },
  nudity: {
    sexual_activity: 0.001,
    sexual_display: 0.001,
    erotica: 0.002,
    very_suggestive: 0.01,
    suggestive: 0.02,
    mildly_suggestive: 0.03,
    none: 0.97,
  },
  weapon: { classes: { firearm: 0.001, firearm_gesture: 0.002, firearm_toy: 0.3, knife: 0.004 } },
  violence: { prob: 0.01, classes: { physical_violence: 0.01, firearm_threat: 0.001, combat_sport: 0.001 } },
  gore: { prob: 0.02, classes: { very_bloody: 0.01 } },
};

describe("Sightengine", () => {
  it("temiz yanıt → düşük puanlar, karar safe", () => {
    const scores = parseSightengineResponse(SIGHTENGINE_CLEAN);
    expect(scores).toEqual({ sexual: 0.002, suggestive: 0.01, violence: 0.01, gore: 0.02, weapon: 0.004 });
    expect(decide(scores, "sightengine").decision).toBe("safe");
  });

  it("çıplaklık %60 üstü → rejected; oyuncak silah sayılmaz", () => {
    const scores = parseSightengineResponse({
      ...SIGHTENGINE_CLEAN,
      nudity: { ...SIGHTENGINE_CLEAN.nudity, sexual_display: 0.93 },
      weapon: { classes: { firearm: 0.01, firearm_toy: 0.99, knife: 0.01 } },
    });
    expect(decide(scores, "sightengine")).toMatchObject({ decision: "rejected", reasons: ["sexual"] });
  });

  it("gerçek silah ve kan → rejected", () => {
    expect(
      decide(parseSightengineResponse({ ...SIGHTENGINE_CLEAN, weapon: { classes: { firearm: 0.88 } } }), "s"),
    ).toMatchObject({ decision: "rejected", reasons: ["weapon"] });
    expect(decide(parseSightengineResponse({ ...SIGHTENGINE_CLEAN, gore: { prob: 0.75 } }), "s")).toMatchObject({
      decision: "rejected",
      reasons: ["gore"],
    });
  });

  it("başarısız ya da eksik yanıt hata verir (temiz sayılmaz)", () => {
    expect(() => parseSightengineResponse({ status: "failure", error: { message: "quota" } })).toThrow(/quota/);
    expect(() => parseSightengineResponse({ ...SIGHTENGINE_CLEAN, gore: undefined })).toThrow(ModerationProviderError);
    expect(() => parseSightengineResponse(null)).toThrow(ModerationProviderError);
  });

  it("adres modu: belgelenen GET isteği", async () => {
    const fetchImpl = vi.fn(async () => json(SIGHTENGINE_CLEAN));
    const moderator = createSightengineModerator({ apiUser: "u", apiSecret: "s", fetchImpl });
    await moderator.moderate({ url: "https://cdn.example/x.jpg?time=3s" });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.sightengine.com/1.0/check.json");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      url: "https://cdn.example/x.jpg?time=3s",
      models: SIGHTENGINE_MODELS,
      api_user: "u",
      api_secret: "s",
    });
  });

  it("bayt modu: multipart POST, dosya 'media' alanında", async () => {
    const fetchImpl = vi.fn(async () => json(SIGHTENGINE_CLEAN));
    const moderator = createSightengineModerator({ apiUser: "u", apiSecret: "s", fetchImpl });
    await moderator.moderate({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/webp" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sightengine.com/1.0/check.json");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect((form.get("media") as Blob).type).toBe("image/webp");
    expect(form.get("models")).toBe(SIGHTENGINE_MODELS);
  });

  it("HTTP hatası sağlayıcı hatasına döner", async () => {
    const fetchImpl = vi.fn(async () => json({ status: "failure", error: { message: "invalid api_user" } }, 401));
    const moderator = createSightengineModerator({ apiUser: "u", apiSecret: "s", fetchImpl });
    await expect(moderator.moderate({ url: "https://x/y.jpg" })).rejects.toThrow("sightengine 401: invalid api_user");
  });

  // 27 Eylül 2026'da canlıda alınan yanıtın birebiri (Cloudflare kapak adresi 404)
  const MEDIA_404 = {
    status: "failure",
    request: { id: "req_x", timestamp: 1790544000, operations: 0 },
    error: {
      type: "media_error",
      code: 11,
      message:
        "Could not download media. The media server returned an HTTP 404 Not Found Error. Please make sure the provided URL is correct.",
    },
  };

  it("görsel indirilemedi (media_error): yeniden denenebilir, mesajda tür ve neden", async () => {
    const moderator = createSightengineModerator({ apiUser: "u", apiSecret: "s", fetchImpl: vi.fn(async () => json(MEDIA_404, 400)) });
    const error = await moderator.moderate({ url: "https://x/kapak.jpg" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModerationProviderError);
    expect(error).toMatchObject({ retryable: true, status: 400 });
    expect((error as Error).message).toBe(`sightengine 400 media_error: ${MEDIA_404.error.message}`);
    expect(isRetryableProviderError(error)).toBe(true);
  });

  it.each([
    [401, "credentials_error", false],
    [400, "argument_error", false],
    [429, "usage_limit", true],
    [403, "usage_limit", false],
    [500, "api_error", true],
    [503, undefined, true],
  ] as const)("HTTP %i %s → yeniden denenebilir: %s", async (status, type, retryable) => {
    const body = { status: "failure", error: { ...(type ? { type } : {}), message: "x" } };
    const moderator = createSightengineModerator({ apiUser: "u", apiSecret: "s", fetchImpl: vi.fn(async () => json(body, status)) });
    await expect(moderator.moderate({ url: "https://x/y.jpg" })).rejects.toMatchObject({ retryable, status });
  });

  it("HTTP 200 ama başarısız yanıt da sınıflandırılır; JSON olmayan yanıt geçici", async () => {
    expect(() => parseSightengineResponse(MEDIA_404)).toThrow(expect.objectContaining({ retryable: true }));
    expect(() => parseSightengineResponse({ status: "failure", error: { type: "credentials_error", message: "x" } })).toThrow(
      expect.objectContaining({ retryable: false }),
    );
    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    const moderator = createSightengineModerator({ apiUser: "u", apiSecret: "s", fetchImpl: html });
    await expect(moderator.moderate({ url: "https://x/y.jpg" })).rejects.toMatchObject({ retryable: true });
  });

  it("ağ hatası ve zaman aşımı geçici sayılır; eksik model yanıtı kalıcı", () => {
    expect(isRetryableProviderError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableProviderError(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(true);
    const missing = (() => {
      try {
        parseSightengineResponse({ ...SIGHTENGINE_CLEAN, gore: undefined });
      } catch (error) {
        return error;
      }
    })();
    expect(isRetryableProviderError(missing)).toBe(false);
  });
});

describe("AWS Rekognition", () => {
  const label = (Name: string, Confidence: number, ParentName = "") => ({ Name, ParentName, Confidence, TaxonomyLevel: 2 });

  it("etiketler kategorilere; güven 0–100 → 0–1", () => {
    const scores = parseRekognitionResponse({
      ModerationLabels: [
        label("Explicit Nudity", 97.5),
        label("Exposed Female Genitalia", 91, "Explicit Nudity"),
        label("Weapons", 70, "Violence"),
        label("Swimwear or Underwear", 45),
      ],
      ModerationModelVersion: "7.0",
    });
    expect(scores).toEqual({ sexual: 0.975, weapon: 0.7, suggestive: 0.45 });
  });

  it("araç kazası (Crashes) ve üst etiketi sayılmaz; kan sayılır", () => {
    expect(
      parseRekognitionResponse({
        ModerationLabels: [label("Visually Disturbing", 96), label("Crashes", 96, "Visually Disturbing")],
      }),
    ).toEqual({});
    expect(
      parseRekognitionResponse({ ModerationLabels: [label("Blood & Gore", 88, "Graphic Violence")] }),
    ).toEqual({ gore: 0.88 });
  });

  it("bilinmeyen alt etiket, üst etiketin kategorisini alır", () => {
    expect(parseRekognitionResponse({ ModerationLabels: [label("Yeni Etiket", 80, "Explicit")] })).toEqual({
      sexual: 0.8,
    });
  });

  it("biçimsiz yanıt hata verir", () => {
    expect(() => parseRekognitionResponse({})).toThrow(ModerationProviderError);
  });

  it("imzalı DetectModerationLabels isteği; görsel bayt olarak", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith("https://rekognition.")
        ? json({ ModerationLabels: [] })
        : new Response(new Uint8Array([9, 9, 9]), { headers: { "content-length": "3" } }),
    );
    const moderator = createRekognitionModerator({
      region: "eu-central-1",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-09-28T10:00:00Z"),
    });
    expect(await moderator.moderate({ url: "https://cdn.example/frame.jpg" })).toEqual({});

    const [endpoint, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://rekognition.eu-central-1.amazonaws.com/");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-amz-target"]).toBe("RekognitionService.DetectModerationLabels");
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/20260928\/eu-central-1\/rekognition\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.parse(init.body as string)).toEqual({ Image: { Bytes: "CQkJ" }, MinConfidence: 40 });
  });
});

describe("fetchImageBytes", () => {
  it("yalnızca https ve boyut sınırı", async () => {
    await expect(fetchImageBytes("http://x/y.jpg")).rejects.toThrow(/https/);
    const big = vi.fn(async () => new Response("x", { headers: { "content-length": String(6 * 1024 * 1024) } }));
    await expect(fetchImageBytes("https://x/y.jpg", { fetchImpl: big })).rejects.toThrow(/büyük/);
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(fetchImageBytes("https://x/y.jpg", { fetchImpl: missing })).rejects.toThrow(/404/);
  });

  it("404 (kare henüz üretilmemiş olabilir) ve 5xx geçici; boyut ve https kalıcı", async () => {
    const status = (code: number) => vi.fn(async () => new Response("", { status: code }));
    await expect(fetchImageBytes("https://x/y.jpg", { fetchImpl: status(404) })).rejects.toMatchObject({ retryable: true });
    await expect(fetchImageBytes("https://x/y.jpg", { fetchImpl: status(502) })).rejects.toMatchObject({ retryable: true });
    await expect(fetchImageBytes("https://x/y.jpg", { fetchImpl: status(403) })).rejects.toMatchObject({ retryable: false });
    await expect(fetchImageBytes("http://x/y.jpg")).rejects.toMatchObject({ retryable: false });
  });
});

describe("OpenAI Moderation", () => {
  const scores = (overrides: Record<string, number>) => ({
    results: [
      {
        flagged: false,
        category_scores: {
          sexual: 0.001,
          "sexual/minors": 0.0001,
          harassment: 0.002,
          "harassment/threatening": 0.001,
          hate: 0.001,
          "hate/threatening": 0.0001,
          illicit: 0.001,
          "illicit/violent": 0.0001,
          "self-harm": 0.0001,
          "self-harm/intent": 0.0001,
          "self-harm/instructions": 0.0001,
          violence: 0.003,
          "violence/graphic": 0.001,
          ...overrides,
        },
      },
    ],
  });

  it("kategori eşleme", () => {
    expect(parseOpenAiModeration(scores({ "harassment/threatening": 0.91, "violence/graphic": 0.5 }))).toMatchObject({
      harassment: 0.91,
      gore: 0.5,
      sexual_minors: 0.0001,
    });
    expect(decide(parseOpenAiModeration(scores({ "harassment/threatening": 0.91 })), "openai")).toMatchObject({
      decision: "rejected",
      reasons: ["harassment"],
    });
    expect(decide(parseOpenAiModeration(scores({})), "openai").decision).toBe("safe");
    expect(() => parseOpenAiModeration({ results: [] })).toThrow(ModerationProviderError);
  });

  it("metin ve görsel isteği", async () => {
    const fetchImpl = vi.fn(async () => json(scores({})));
    const { text, image } = createOpenAiModerators({ apiKey: "sk-test", fetchImpl });
    await text.moderate("merhaba");
    await image.moderate({ bytes: new Uint8Array([1, 2]), mimeType: "image/jpeg" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/moderations");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toEqual({ model: "omni-moderation-latest", input: "merhaba" });
    expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).input).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQI=" } },
    ]);
  });
});

describe("moderationProvidersFromEnv", () => {
  it("anahtar yoksa sağlayıcı yok", () => {
    expect(moderationProvidersFromEnv({})).toEqual({ image: null, text: null });
  });

  it("seçim yoksa anahtarı tanımlı ilk sağlayıcı: Sightengine > Rekognition > OpenAI", () => {
    const all = {
      SIGHTENGINE_API_USER: "u",
      SIGHTENGINE_API_SECRET: "s",
      REKOGNITION_ACCESS_KEY_ID: "a",
      REKOGNITION_SECRET_ACCESS_KEY: "b",
      OPENAI_API_KEY: "k",
    };
    expect(moderationProvidersFromEnv(all).image?.name).toBe("sightengine");
    expect(moderationProvidersFromEnv({ ...all, SIGHTENGINE_API_SECRET: "" }).image?.name).toBe("rekognition");
    expect(moderationProvidersFromEnv({ OPENAI_API_KEY: "k" })).toMatchObject({
      image: { name: "openai" },
      text: { name: "openai" },
    });
  });

  it("açık seçim; anahtarı eksikse sağlayıcı yok (kapalı başarısızlık)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      moderationProvidersFromEnv({ MODERATION_IMAGE_PROVIDER: "openai", SIGHTENGINE_API_USER: "u", SIGHTENGINE_API_SECRET: "s", OPENAI_API_KEY: "k" })
        .image?.name,
    ).toBe("openai");
    expect(moderationProvidersFromEnv({ MODERATION_IMAGE_PROVIDER: "rekognition", OPENAI_API_KEY: "k" }).image).toBeNull();
    expect(moderationProvidersFromEnv({ MODERATION_IMAGE_PROVIDER: "none", OPENAI_API_KEY: "k" }).image).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("metin denetimi kapatılabilir", () => {
    expect(moderationProvidersFromEnv({ OPENAI_API_KEY: "k", MODERATION_TEXT_PROVIDER: "none" }).text).toBeNull();
  });
});
