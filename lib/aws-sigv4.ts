import "server-only";
import { createHash, createHmac } from "node:crypto";

// AWS Signature Version 4: AWS SDK'sı eklemeden tek bir JSON isteğini
// (Rekognition DetectModerationLabels) imzalamak için. Algoritma:
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
// lib/aws-sigv4.test.ts, AWS dokümanındaki örnek isteğin imzasını birebir üretir.

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  /** Geçici kimlik bilgilerinde (STS) */
  sessionToken?: string;
};

export type AwsSignInput = {
  method: string;
  url: string;
  /** İmzaya girecek başlıklar (host ve x-amz-date eklenir) */
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  now?: Date;
};

const sha256Hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986: encodeURIComponent'in kaçırmadığı !'()* da kodlanır */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 20150830T123600Z */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export type AwsSignature = {
  /** İsteğe eklenecek başlıklar (Authorization dahil) */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
};

export function signAwsRequest(input: AwsSignInput): AwsSignature {
  const url = new URL(input.url);
  const timestamp = amzDate(input.now ?? new Date());
  const dateStamp = timestamp.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers.host = url.host;
  headers["x-amz-date"] = timestamp;
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalQuery = [...url.searchParams.entries()]
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonicalUri = url.pathname
    .split("/")
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join("/") || "/";

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}
