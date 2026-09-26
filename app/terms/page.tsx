import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Kullanım Koşulları | Elan",
  description: "Elan'da ilan verme ve kullanma kuralları, yasak içerikler ve ilan bildirimi.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Kullanım Koşulları">
      <p>
        Elan&apos;ı kullanarak bu koşulları kabul etmiş olursun. Koşulları kabul etmiyorsan lütfen Elan&apos;ı
        kullanma.
      </p>

      <h2>Hizmet</h2>
      <p>
        Elan, araç satıcılarının kısa videolu ilan yayınladığı ve alıcıların satıcılarla doğrudan iletişime
        geçtiği bir ilan platformudur. Elan alım satımın tarafı değildir; araçların durumu, fiyatı ve satış
        süreci satıcı ile alıcı arasındadır.
      </p>

      <h2>Hesap</h2>
      <ul>
        <li>Elan&apos;ı kullanmak için 18 yaşından büyük olmalısın.</li>
        <li>Hesap bilgilerinin doğru olmasından ve şifrenin güvenliğinden sen sorumlusun.</li>
        <li>Hesabın üzerinden yapılan işlemlerden sen sorumlusun.</li>
      </ul>

      <h2>İlan kuralları</h2>
      <p>İlan verirken:</p>
      <ul>
        <li>yalnızca satma hakkına sahip olduğun, gerçekten var olan araçları ilan edebilirsin,</li>
        <li>aracın bilgilerini, hasar ve ekspertiz durumunu doğru ve eksiksiz yazmalısın,</li>
        <li>fotoğraf ve videolar ilan ettiğin araca ait olmalı ve kullanma hakkına sahip olmalısın.</li>
      </ul>
      <p>Aşağıdaki içerikler kesinlikle yasaktır:</p>
      <ul>
        <li>sahte, yanıltıcı ya da dolandırıcılık amaçlı ilanlar, çalıntı veya belgesiz araçlar,</li>
        <li>müstehcen, şiddet içeren, nefret söylemi barındıran ya da taciz edici içerik,</li>
        <li>başkalarına ait kişisel bilgiler veya telif hakkı ihlali içeren görseller,</li>
        <li>araç satışıyla ilgisi olmayan içerik, spam ve aynı aracın tekrarlanan ilanları,</li>
        <li>yürürlükteki mevzuata aykırı her türlü içerik.</li>
      </ul>

      <h2>Bildirim ve moderasyon</h2>
      <p>
        Kurallara aykırı olduğunu düşündüğün bir ilanı, ilanın üzerindeki <strong>Bildir</strong> ya da ilan
        sayfasındaki <strong>İlanı bildir</strong> butonuyla bize iletebilirsin. Bildirimler incelenir; kurallara
        aykırı içeriğe hoşgörü göstermiyoruz. Aykırı bulunan ilanlar önceden haber verilmeksizin yayından
        kaldırılır, kuralları tekrar tekrar ihlal eden hesaplar kapatılır.
      </p>

      <h2>Alıcılar için güvenlik</h2>
      <ul>
        <li>Aracı görmeden ve belgelerini kontrol etmeden kapora ya da ödeme gönderme.</li>
        <li>Ödemeyi resmi satış işlemi sırasında, güvenli yöntemlerle yap.</li>
        <li>Şüpheli bir durumla karşılaşırsan ilanı bildir.</li>
      </ul>

      <h2>İçerik hakları</h2>
      <p>
        Yüklediğin içeriklerin hakları sende kalır. İlanın yayında olduğu sürece bu içerikleri Elan&apos;da
        göstermemiz, paylaşılabilir bağlantılarda önizlemek ve teknik olarak işlemek (ör. videoyu farklı
        çözünürlüklere dönüştürmek) için bize ücretsiz ve sınırlı bir kullanım izni vermiş olursun.
      </p>

      <h2>Sorumluluğun sınırı</h2>
      <p>
        Elan&apos;ı olduğu gibi sunuyoruz; kesintisiz ya da hatasız çalışacağını garanti etmiyoruz. İlanların
        doğruluğundan ilanı veren satıcı sorumludur. Kullanıcılar arasındaki alım satımdan doğan
        anlaşmazlıklardan Elan sorumlu tutulamaz.
      </p>

      <h2>Hesabın kapatılması</h2>
      <p>
        Hesabını dilediğin zaman <Link href="/account">Hesabım</Link> sayfasından kalıcı olarak silebilirsin.
        Bu koşulları ihlal etmen durumunda hesabını askıya alabilir ya da kapatabiliriz.
      </p>

      <h2>Değişiklikler ve uygulanacak hukuk</h2>
      <p>
        Koşulları güncelleyebiliriz; güncel metin her zaman bu sayfada yer alır. Bu koşullar Türkiye
        Cumhuriyeti kanunlarına tabidir. Kişisel verilerinin nasıl işlendiği için{" "}
        <Link href="/privacy">Gizlilik Politikası</Link>&apos;na bakabilirsin.
      </p>
    </LegalPage>
  );
}
