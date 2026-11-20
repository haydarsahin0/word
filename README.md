# Kelime Defteri

Masasında hep çalışan küçük bir piksel karakterle Türkçe ⇄ Almanca kelime öğrenme uygulaması.

- Alttaki kutuya **Türkçe** bir kelime yazarsan Almancasını (artikeliyle), **Almanca** yazarsan Türkçesini söyler ve hafızasına kaydeder.
- Kaydettiği kelimeleri **aralıklı tekrar** ile, kafasının üstündeki balonda bir örnek cümle içinde sorar:
  „hatırlıyor musun?“, **boşluk doldurma** ve „Almancası neydi?“ soruları.
- Üstte toplam kelime hedefi ve **günlük hedef** çubuğu, art arda gün serisi.
- Karakter yazıyor, düşünüyor, pencereden bakıyor; doğru cevapta seviniyor, duraklatınca uyuyor.
- ≡ menüsü: günlük/toplam hedef, soru sıklığı, sesli okuma, kelime listesi, dışa/içe aktarma.

Veriler tarayıcıda (`localStorage`) saklanır. Çeviri için Google Translate'in açık uç noktası,
yedek olarak MyMemory kullanılır; internet yoksa ~110 kelimelik yerleşik sözlük ve elle giriş devreye girer.

## Çalıştırma

Derleme yok. `index.html` dosyasını açmak yeterli; telefona/iPad'e kurmak için GitHub Pages gibi
bir yerde yayınlayıp Safari'de **Paylaş → Ana Ekrana Ekle** demek yeterli (çevrimdışı da açılır).

## Yapay zekâ (Meta Muse Ember)

Karakterin beyni bir Cloudflare Worker'dır: `cloudflare/worker.js`
(adres: `https://kelime-ai.haydar-sahin.workers.dev`). Worker, Meta Model API'deki `muse-ember-1.0`
modelini çağırır; API anahtarını Worker'ın **`musebaba`** adlı secret'ından okur (anahtar tarayıcıya hiç gitmez).
Yalnızca GitHub Pages adresinden (ve yerelden) gelen isteklere cevap verir, dakikalık istek sınırı vardır.

Model şunları yapar:
- yazdığın kelimenin çevirisi, artikeli ve çoğulu, kısa Türkçe anlamı, **en fazla 2 cümlelik basit Almanca açıklaması** ve örnek cümlesi,
- gün boyu hep yeni örnek cümleler, boşluk doldurma, Almanca sorular (cevabını değerlendirir), ipuçları ve yeni kelime önerileri,
- hepsini samimi bir "kanka" diliyle; daha önce gösterilen cümleler tekrar edilmez.

Worker'a ulaşılamazsa uygulama Google Translate + yerleşik sözlük + yerel tekrar ile çalışmaya devam eder.

Worker'ı güncellemek: Cloudflare panelinde `kelime-ai` → **Edit code** → `cloudflare/worker.js` içeriğini yapıştır → **Deploy**.
(`supabase/functions/kelime-ai` aynı kodun Supabase sürümüdür.)
