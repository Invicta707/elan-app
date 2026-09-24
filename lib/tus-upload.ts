import * as tus from "tus-js-client";

// Cloudflare'in tek kullanımlık tus bağlantısına (POST /api/upload/video'dan
// gelen uploadUrl) videoyu yükler. `uploadUrl` verildiği için tus-js-client
// yeni bir "create" isteği atmaz, doğrudan bu adrese devam eder (bkz.
// app/api/upload/video/route.ts üstündeki akış açıklaması).

export type UploadProgressHandler = (percent: number) => void;

export type VideoUploadHandle = {
  /** Yükleme tamamlanınca çözülür, hata olursa reddeder */
  done: Promise<void>;
  /** Kullanıcı vazgeçerse yüklemeyi durdurur (Cloudflare tarafındaki bağlantıyı sonlandırmaz) */
  abort: () => void;
};

export function uploadVideoToCloudflare(
  file: File,
  uploadUrl: string,
  onProgress?: UploadProgressHandler,
): VideoUploadHandle {
  let upload!: tus.Upload;

  const done = new Promise<void>((resolve, reject) => {
    upload = new tus.Upload(file, {
      uploadUrl,
      uploadSize: file.size,
      // Mobil bağlantıda tek büyük istek yerine 50 MB'lık parçalar: kesilen
      // yükleme kaldığı yerden devam eder, tamamı yeniden gönderilmez.
      chunkSize: 50 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      onError: (error) => reject(error),
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      onSuccess: () => resolve(),
    });

    upload.start();
  });

  return {
    done,
    abort: () => {
      // shouldTerminate=false: sadece istemciyi durdurur, Cloudflare'deki tek
      // kullanımlık bağlantıyı sonlandırmaya çalışmaz (destek dışı olabilir).
      void upload.abort(false);
    },
  };
}
