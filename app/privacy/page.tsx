import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../../components/LegalPage";
import { LEGAL_CONTACT_EMAIL } from "../../lib/legal";

export const metadata: Metadata = {
  title: "Gizlilik Politikası | gözüyle",
  description: "gözüyle'nin hangi kişisel verileri neden topladığı, nasıl sakladığı ve haklarını nasıl kullanabileceğin.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Gizlilik Politikası">
      <p>
        Bu politika, gözüyle web sitesi ve mobil uygulamasını (birlikte &quot;gözüyle&quot;) kullanırken hangi kişisel
        verilerinin işlendiğini, neden işlendiğini ve 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK)
        kapsamındaki haklarını açıklar.
      </p>

      <h2>Topladığımız veriler</h2>
      <ul>
        <li>
          <strong>Hesap bilgileri:</strong> giriş için e-posta adresin ve şifren. Şifren kimlik doğrulama
          sağlayıcımız tarafından şifrelenmiş olarak saklanır; biz göremeyiz.
        </li>
        <li>
          <strong>İlan bilgileri:</strong> ilan verirsen aracın bilgileri (marka, model, yıl, kilometre, fiyat,
          şehir, açıklama), fotoğraflar ve video. Yayındaki ilanlar herkese açıktır.
        </li>
        <li>
          <strong>İletişim numarası:</strong> ilan verirken girdiğin WhatsApp numarası. Alıcılar &quot;WhatsApp&apos;tan
          yaz&quot; butonuna dokunduğunda bu numaraya yönlendirilir.
        </li>
        <li>
          <strong>Favoriler ve etkileşimler:</strong> favoriye eklediğin ilanlar (giriş yapmadıysan yalnızca
          cihazında, giriş yaptıysan hesabında) ve satıcıyla iletişime geçme tıklamaları.
        </li>
        <li>
          <strong>Bildirimler:</strong> bir ilanı bildirdiğinde seçtiğin neden, yazdığın açıklama ve giriş
          yaptıysan hesap kimliğin. Kimliğin satıcıyla paylaşılmaz.
        </li>
        <li>
          <strong>Teknik kayıtlar:</strong> güvenlik ve hata tespiti için barındırma sağlayıcımızın tuttuğu IP
          adresi, tarayıcı bilgisi ve istek kayıtları.
        </li>
      </ul>
      <p>
        Reklam ya da izleme çerezi kullanmıyoruz. Tarayıcında yalnızca oturumunu açık tutmak ve favorilerini
        saklamak için gerekli bilgiler tutulur.
      </p>

      <h2>Verileri neden işliyoruz</h2>
      <ul>
        <li>Hesabını oluşturmak ve oturumunu açık tutmak,</li>
        <li>ilanlarını yayınlamak ve alıcıların sana ulaşmasını sağlamak,</li>
        <li>favorilerini cihazların arasında senkronize etmek,</li>
        <li>bildirilen ilanları incelemek, dolandırıcılığı ve kötüye kullanımı önlemek,</li>
        <li>hizmetin güvenliğini sağlamak ve hataları gidermek.</li>
      </ul>
      <p>
        Bu işlemler KVKK&apos;nın 5. maddesi kapsamında sözleşmenin kurulması ve ifası, meşru menfaat ve hukuki
        yükümlülüklerin yerine getirilmesi hukuki sebeplerine dayanır.
      </p>

      <h2>Hizmet sağlayıcılar ve yurt dışına aktarım</h2>
      <p>gözüyle&apos;yi çalıştırmak için aşağıdaki hizmet sağlayıcıları kullanıyoruz:</p>
      <ul>
        <li>Supabase: veritabanı, kimlik doğrulama ve fotoğraf depolama,</li>
        <li>Cloudflare Stream: videoların saklanması ve oynatılması,</li>
        <li>Vercel: web sitesinin barındırılması.</li>
      </ul>
      <p>
        Bu sağlayıcıların sunucuları yurt dışında bulunabilir; verilerin yalnızca hizmetin sunulması için ve
        KVKK&apos;nın yurt dışına aktarıma ilişkin hükümlerine uygun olarak aktarılır. Verilerini satmıyor ve
        reklam amacıyla paylaşmıyoruz.
      </p>

      <h2>Saklama süresi</h2>
      <p>
        Hesap bilgilerin hesabın açık olduğu sürece saklanır. İlanlarını yayından kaldırabilir ya da
        arşivleyebilirsin. Hesabını sildiğinde kişisel verilerin, yasal olarak saklamamız gerekenler dışında
        hemen silinir.
      </p>

      <h2 id="haklarin">Hakların</h2>
      <p>KVKK&apos;nın 11. maddesi uyarınca;</p>
      <ul>
        <li>verilerinin işlenip işlenmediğini öğrenme ve bilgi isteme,</li>
        <li>eksik ya da yanlış işlenmiş verilerin düzeltilmesini isteme,</li>
        <li>verilerinin silinmesini ya da yok edilmesini isteme,</li>
        <li>işlemeye itiraz etme ve zarara uğradıysan giderilmesini talep etme</li>
      </ul>
      <p>
        haklarına sahipsin. Taleplerini <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>{" "}
        adresine iletebilirsin; en geç 30 gün içinde yanıtlarız.
      </p>

      <h2 id="hesabini-silme">Hesabını silme</h2>
      <p>
        Hesabını ve tüm verilerini dilediğin zaman <Link href="/settings">Ayarlar</Link> sayfasındaki{" "}
        <strong>Hesabımı sil</strong> butonuyla kalıcı olarak silebilirsin. Hesabınla birlikte ilanların,
        videoların, fotoğrafların, favorilerin ve iletişim bilgilerin silinir. Başkalarının ilanları için yaptığın
        bildirimler, kimliğinden ayrılarak moderasyon amacıyla saklanabilir. Hesabına giriş yapamıyorsan silme
        talebini yukarıdaki adrese gönderebilirsin.
      </p>

      <h2>Çocuklar</h2>
      <p>gözüyle 18 yaşından küçükler için tasarlanmamıştır; bilerek 18 yaş altı kişilerden veri toplamayız.</p>

      <h2>Değişiklikler</h2>
      <p>
        Bu politikayı güncelleyebiliriz; güncel metin her zaman bu sayfada yer alır. Hizmeti kullanma kuralları
        için <Link href="/terms">Kullanım Koşulları</Link>&apos;na bakabilirsin.
      </p>
    </LegalPage>
  );
}
