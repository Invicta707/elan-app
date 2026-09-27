import { describe, expect, it } from "vitest";
import {
  EMPTY_LISTING_DRAFT,
  LISTING_STEPS,
  MAX_PHOTO_BYTES,
  PHOTO_MIME_TYPES,
  PHOTO_SIZE_ERROR,
  buildListingRecords,
  buildVehicleImageRow,
  caretAfterDigits,
  catalogIds,
  catalogRpcArgs,
  groupThousands,
  listingFieldErrors,
  photoStoragePath,
  photoUpload,
  stepFieldErrors,
  validateListingDraft,
  type ListingDraft,
  type ListingField,
} from "./listing";

const NOW = new Date("2026-09-25T12:00:00Z");

const validDraft: ListingDraft = {
  brandId: "brand-1",
  brandName: "",
  modelId: "model-1",
  modelName: "",
  year: "2019",
  mileageKm: "85000",
  price: "750000",
  city: "İstanbul",
  bodyType: "sedan",
  fuelType: "dizel",
  transmission: "otomatik",
  damageStatus: "none",
  description: "Bakımları yapıldı.",
  whatsapp: "5445673430",
};

describe("validateListingDraft", () => {
  it("geçerli taslakta hata yok", () => {
    expect(validateListingDraft(validDraft, NOW)).toBeNull();
  });

  it.each<[string, Partial<ListingDraft>, string]>([
    ["marka yok", { brandId: "" }, "Marka ve model seçmelisin."],
    ["model yok", { modelId: "" }, "Marka ve model seçmelisin."],
    ["yazılan marka geçersiz", { brandId: "", brandName: "<script>", modelId: "", modelName: "X" }, "Marka ve model seçmelisin."],
    ["yeni markanın modeli katalogdan olamaz", { brandId: "", brandName: "Togg" }, "Marka ve model seçmelisin."],
    ["yıl boş", { year: "" }, "Geçerli bir yıl gir."],
    ["yıl çok eski", { year: "1969" }, "Geçerli bir yıl gir."],
    ["yıl gelecekte", { year: "2028" }, "Geçerli bir yıl gir."],
    ["kilometre yok", { mileageKm: "" }, "Kilometreyi gir."],
    ["fiyat yok", { price: "" }, "Fiyatı gir."],
    ["şehir sadece boşluk", { city: "   " }, "Şehir seç ya da yaz."],
    ["kasa tipi yok", { bodyType: "" }, "Kasa tipi seç."],
    ["yakıt türü yok", { fuelType: "" }, "Yakıt türü seç."],
    ["vites yok", { transmission: "" }, "Vites tipi seç."],
    ["numara geçersiz", { whatsapp: "12345" }, "Geçerli bir WhatsApp numarası gir."],
    ["yazılan model küfür", { modelId: "", modelName: "Orospu" }, "Marka ve model seçmelisin."],
    ["şehir küfür", { city: "s1kt1r" }, "Bu şehir adı kullanılamaz."],
    ["açıklama yasa dışı teklif", { description: "Satılık tabanca da var" }, "Açıklama topluluk kurallarına aykırı ifadeler içeriyor."],
  ])("%s", (_name, change, message) => {
    expect(validateListingDraft({ ...validDraft, ...change }, NOW)).toBe(message);
  });

  it("listede olmayan marka ve model yazılabilir", () => {
    expect(validateListingDraft({ ...validDraft, modelId: "", modelName: "M340i" }, NOW)).toBeNull();
    expect(
      validateListingDraft({ ...validDraft, brandId: "", brandName: "Togg", modelId: "", modelName: "T10X" }, NOW),
    ).toBeNull();
  });

  it("metin filtresi masum ilan metnine takılmaz", () => {
    expect(
      validateListingDraft({ ...validDraft, description: "Sıkıntısız, sık sık bakımı yapıldı. Öldürecek fiyat!" }, NOW),
    ).toBeNull();
  });

  it("gelecek yılın modeli kabul edilir", () => {
    expect(validateListingDraft({ ...validDraft, year: "2027" }, NOW)).toBeNull();
  });
});

describe("buildListingRecords", () => {
  it("profil ve ilan kayıtlarını veritabanı kolonlarıyla hazırlar", () => {
    const records = buildListingRecords("user-1", {
      ...validDraft,
      whatsapp: "0544 567 34 30",
      mileageKm: "85.000",
      price: "1.250.000",
      city: "  İstanbul ",
      description: "  Bakımları yapıldı.  ",
      damageStatus: "heavy",
    });

    expect(records).toEqual({
      profile: { id: "user-1", whatsapp_number: "905445673430" },
      catalog: { brandId: "brand-1", brandName: null, modelId: "model-1", modelName: null },
      vehicle: {
        seller_id: "user-1",
        year: 2019,
        mileage_km: 85000,
        price: 1250000,
        currency: "TRY",
        city: "İstanbul",
        body_type: "sedan",
        fuel_type: "dizel",
        transmission: "otomatik",
        has_heavy_damage: true,
        description: "Bakımları yapıldı.",
        status: "pending_video",
      },
    });
  });

  it("katalog seçiminde id'ler doğrudan yazılır; yazılan adda RPC'ye ad gider", () => {
    const fromCatalog = buildListingRecords("user-1", validDraft).catalog;
    expect(catalogIds(fromCatalog)).toEqual({ brand_id: "brand-1", model_id: "model-1" });

    const newModel = buildListingRecords("user-1", { ...validDraft, modelId: "", modelName: "  M340i   xDrive " }).catalog;
    expect(newModel).toEqual({ brandId: "brand-1", brandName: null, modelId: null, modelName: "M340i xDrive" });
    expect(catalogIds(newModel)).toBeNull();
    expect(catalogRpcArgs(newModel)).toEqual({
      p_brand_id: "brand-1",
      p_brand_name: null,
      p_model_id: null,
      p_model_name: "M340i xDrive",
    });

    const newBrand = buildListingRecords("user-1", {
      ...validDraft,
      brandId: "",
      brandName: " Togg ",
      modelId: "",
      modelName: "T10X",
    }).catalog;
    expect(newBrand).toEqual({ brandId: null, brandName: "Togg", modelId: null, modelName: "T10X" });
  });

  it("boş açıklama null olarak yazılır", () => {
    expect(buildListingRecords("user-1", { ...validDraft, description: "   " }).vehicle.description).toBeNull();
  });

  it("zorunlu kolonların (fuel_type, transmission, body_type) hepsi dolu", () => {
    const { vehicle } = buildListingRecords("user-1", validDraft);
    for (const column of ["fuel_type", "transmission", "body_type", "city", "status"] as const) {
      expect(vehicle[column]).toBeTruthy();
    }
  });

  it("geçersiz taslakta doğrulama mesajıyla hata fırlatır", () => {
    expect(() => buildListingRecords("user-1", { ...validDraft, whatsapp: "" })).toThrow(
      "Geçerli bir WhatsApp numarası gir.",
    );
    expect(() => buildListingRecords("user-1", { ...validDraft, bodyType: "" })).toThrow("Kasa tipi seç.");
  });
});

describe("fotoğraf yükleme (tür denetimi: lib/image-decode.test.ts inspectImageFile)", () => {
  it("boyut sınırı ve metni", () => {
    expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
    expect(PHOTO_SIZE_ERROR).toBe("Fotoğraflar en fazla 10 MB olabilir.");
  });

  it("yol ve gövde, tarayıcının bildirdiği türden değil gerçek türden", () => {
    // image/x-png bildiren PNG: bucket "image/x-png"yi, yol kuralı ".x-png"yi reddederdi
    const xpng = new File([new Uint8Array([0x89, 0x50])], "foto.png", { type: "image/x-png" });
    const upload = photoUpload("veh-1", 0, xpng, "image/png");
    expect(upload.path).toBe("veh-1/0.png");
    expect(upload.body.type).toBe("image/png");
    expect(upload.body.size).toBe(xpng.size);

    // image/jpg ya da boş tür bildiren JPEG: yol kuralı yalnızca .jpeg kabul eder
    expect(photoUpload("veh-1", 2, new File(["x"], "a.jpg", { type: "image/jpg" }), "image/jpeg")).toMatchObject({
      path: "veh-1/2.jpeg",
      body: { type: "image/jpeg" },
    });
    expect(photoUpload("veh-1", 3, new File(["x"], "IMG_3", { type: "" }), "image/webp").path).toBe("veh-1/3.webp");
  });

  it("tür zaten doğruysa dosyanın kendisi yüklenir", () => {
    const file = new File(["x"], "a.webp", { type: "image/webp" });
    expect(photoUpload("veh-1", 1, file, "image/webp").body).toBe(file);
  });

  it("yükleme türleri bucket'ın izin verdiği türlerle aynı", () => {
    expect([...PHOTO_MIME_TYPES].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});

describe("fotoğraf kayıtları", () => {
  it("depolama anahtarı dosya adından bağımsız, sadece ASCII", () => {
    expect(photoStoragePath("veh-1", 0, "image/jpeg")).toBe("veh-1/0.jpeg");
    expect(photoStoragePath("veh-1", 3, "image/PNG")).toBe("veh-1/3.png");
    expect(photoStoragePath("veh-1", 1, "image/heic")).toBe("veh-1/1.heic");
    expect(photoStoragePath("veh-1", 2, "")).toBe("veh-1/2.jpg");
    expect(photoStoragePath("veh-1", 4, "image/svg+xml")).toMatch(/^[\w-]+\/\d+\.[a-z0-9]+$/);
  });

  it("ilk fotoğraf kapak, sıra korunur", () => {
    expect(buildVehicleImageRow("veh-1", "https://x/0.jpeg", 0)).toEqual({
      vehicle_id: "veh-1",
      image_url: "https://x/0.jpeg",
      display_order: 0,
      is_primary: true,
    });
    expect(buildVehicleImageRow("veh-1", "https://x/2.jpeg", 2)).toMatchObject({
      display_order: 2,
      is_primary: false,
    });
  });
});

describe("listingFieldErrors", () => {
  const cases: Partial<ListingDraft>[] = [
    {},
    { brandId: "" },
    { modelId: "" },
    { year: "" },
    { year: "1969" },
    { year: "2028" },
    { year: "2027" },
    { mileageKm: "" },
    { price: "" },
    { city: "   " },
    { bodyType: "" },
    { fuelType: "" },
    { transmission: "" },
    { whatsapp: "12345" },
    { brandId: "", price: "", whatsapp: "" },
    { modelId: "", modelName: "M340i" },
    { brandId: "", brandName: "Togg", modelId: "", modelName: "T10X" },
    { brandId: "", brandName: "Togg" },
    { brandId: "", brandName: "<b>", modelId: "", modelName: "X" },
    { modelId: "", modelName: "   " },
    { modelId: "", modelName: "Orospu" },
    { city: "s1kt1r" },
    { description: "Satılık tabanca da var" },
    { description: "Sıkıntısız, bakımlı" },
  ];

  it.each(cases)("validateListingDraft ile aynı kararı verir: %j", (change) => {
    const draft = { ...validDraft, ...change };
    const fieldErrors = listingFieldErrors(draft, NOW);
    expect(Object.keys(fieldErrors).length === 0).toBe(validateListingDraft(draft, NOW) === null);
  });

  it("her hatalı alan kendi mesajını alır", () => {
    expect(listingFieldErrors({ ...validDraft, brandId: "", modelId: "", year: "1969", city: " " }, NOW)).toEqual({
      brandId: "Marka seç ya da yaz.",
      modelId: "Önce marka seç.",
      year: "1970–2027 arasında bir yıl gir.",
      city: "Şehir seç ya da yaz.",
    });
    expect(listingFieldErrors({ ...validDraft, modelId: "" }, NOW)).toEqual({ modelId: "Model seç ya da yaz." });
    expect(listingFieldErrors({ ...validDraft, brandId: "", brandName: "Togg", modelId: "" }, NOW)).toEqual({
      modelId: "Model seç ya da yaz.",
    });
    expect(
      listingFieldErrors({ ...validDraft, modelId: "", modelName: "a".repeat(61) }, NOW),
    ).toEqual({ modelId: "En fazla 60 karakter olabilir." });
    expect(listingFieldErrors({ ...validDraft, brandId: "", brandName: "<b>", modelId: "", modelName: "X" }, NOW)).toEqual({
      brandId: "Yalnızca harf, rakam, boşluk ve - . / + & ' kullanılabilir.",
    });
  });

  it("filtreye takılan metnin hatası kendi alanında", () => {
    expect(listingFieldErrors({ ...validDraft, description: "aq", city: "amk" }, NOW)).toEqual({
      description: "Açıklama topluluk kurallarına aykırı ifadeler içeriyor.",
      city: "Bu şehir adı kullanılamaz.",
    });
    expect(listingFieldErrors({ ...validDraft, modelId: "", modelName: "Siktir" }, NOW)).toEqual({
      modelId: "Bu marka ya da model adı kullanılamaz.",
    });
  });

  it("boş taslakta açıklama ve hasar dışındaki bütün alanlar hatalı", () => {
    expect(Object.keys(listingFieldErrors(EMPTY_LISTING_DRAFT, NOW)).sort()).toEqual(
      ["brandId", "city", "fuelType", "mileageKm", "modelId", "price", "transmission", "whatsapp", "year", "bodyType"].sort(),
    );
  });
});

describe("LISTING_STEPS", () => {
  it("doğrulanan her alan tam olarak bir adımda", () => {
    // Açıklama isteğe bağlı: yalnızca metin filtresine takılınca hatalı
    const all = Object.keys(listingFieldErrors({ ...EMPTY_LISTING_DRAFT, description: "aq" }, NOW)) as ListingField[];
    const inSteps = LISTING_STEPS.flatMap((step) => step.fields);
    expect([...inSteps].sort()).toEqual([...all].sort());
    expect(new Set(inSteps).size).toBe(inSteps.length);
  });

  it("adım sırası: araç, medya, fiyat ve detaylar", () => {
    expect(LISTING_STEPS.map((s) => s.title)).toEqual(["Araç Bilgileri", "Medya & Video", "Fiyat & Detaylar"]);
  });

  it("stepFieldErrors yalnızca o adımın hatalarını döner", () => {
    const errors = listingFieldErrors({ ...validDraft, brandId: "", price: "" }, NOW);
    // Marka boşalınca katalog modeli de geçersiz: katalog modeli yalnızca katalogdaki markayla anlamlı
    expect(Object.keys(stepFieldErrors(0, errors))).toEqual(["brandId", "modelId"]);
    expect(stepFieldErrors(1, errors)).toEqual({});
    expect(Object.keys(stepFieldErrors(2, errors))).toEqual(["price"]);
    expect(stepFieldErrors(9, errors)).toEqual({});
  });
});

describe("groupThousands / caretAfterDigits", () => {
  it.each([
    ["", ""],
    ["5", "5"],
    ["850", "850"],
    ["8500", "8.500"],
    ["750000", "750.000"],
    ["1250000", "1.250.000"],
    ["999999999999", "999.999.999.999"],
  ])("%s → %s", (digits, formatted) => {
    expect(groupThousands(digits)).toBe(formatted);
  });

  it("imleç, sayılan rakamın hemen sonrasına gelir; ayraçlar atlanır", () => {
    expect(caretAfterDigits("1.250.000", 0)).toBe(0);
    expect(caretAfterDigits("1.250.000", 1)).toBe(1);
    expect(caretAfterDigits("1.250.000", 2)).toBe(3);
    expect(caretAfterDigits("1.250.000", 4)).toBe(5);
    expect(caretAfterDigits("1.250.000", 7)).toBe(9);
    expect(caretAfterDigits("1.250.000", 99)).toBe(9);
  });
});
