import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { amzDate, signAwsRequest } = await import("./aws-sigv4");

// AWS dokümanındaki örnek istek (IAM ListUsers, "Signature Version 4 signing
// process" örneği): bilinen kanonik istek özeti ve imza.
const EXAMPLE = {
  method: "GET",
  url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
  headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
  body: "",
  region: "us-east-1",
  service: "iam",
  credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
  now: new Date("2015-08-30T12:36:00Z"),
};

describe("signAwsRequest", () => {
  it("AWS dokümanındaki örneğin kanonik isteğini ve imzasını üretir", () => {
    const signed = signAwsRequest(EXAMPLE);
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/",
        "Action=ListUsers&Version=2010-05-08",
        "content-type:application/x-www-form-urlencoded; charset=utf-8",
        "host:iam.amazonaws.com",
        "x-amz-date:20150830T123600Z",
        "",
        "content-type;host;x-amz-date",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n"),
    );
    expect(createHash("sha256").update(signed.canonicalRequest).digest("hex")).toBe(
      "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59",
    );
    expect(signed.signature).toBe("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
    expect(signed.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });

  it("geçici kimlikte oturum anahtarı imzaya girer", () => {
    const signed = signAwsRequest({ ...EXAMPLE, credentials: { ...EXAMPLE.credentials, sessionToken: "tok" } });
    expect(signed.headers["x-amz-security-token"]).toBe("tok");
    expect(signed.headers.authorization).toContain("SignedHeaders=content-type;host;x-amz-date;x-amz-security-token");
  });

  it("gövde değişince imza değişir", () => {
    const a = signAwsRequest({ ...EXAMPLE, method: "POST", body: "{}" }).signature;
    const b = signAwsRequest({ ...EXAMPLE, method: "POST", body: '{"a":1}' }).signature;
    expect(a).not.toBe(b);
  });

  it("amzDate", () => {
    expect(amzDate(new Date("2026-09-28T07:05:09.123Z"))).toBe("20260928T070509Z");
  });
});
