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

Karakterin beyni `supabase/functions/kelime-ai` içindeki Supabase Edge Function'dır. Fonksiyon
Meta Model API'deki `muse-ember-1.0` modelini çağırır; API anahtarını **`musebaba`** adlı Supabase
secret'ından okur (anahtar tarayıcıya hiç gitmez).

Model şunları yapar:
- yazdığın kelimenin çevirisi, artikeli ve çoğulu, kısa Türkçe anlamı, **en fazla 2 cümlelik basit Almanca açıklaması** ve örnek cümlesi,
- gün boyu yeni örnek cümleler, boşluk doldurma soruları, Almanca sorular (cevabını değerlendirir), küçük ipuçları ve sana yeni kelime önerileri,
- hepsini samimi bir "kanka" diliyle.

Fonksiyona ulaşılamazsa uygulama Google Translate + yerleşik sözlük + yerel tekrar ile çalışmaya devam eder.

Yükleme (Supabase CLI ile):

```sh
supabase functions deploy kelime-ai --project-ref jckoovsocynnxbrsalld --no-verify-jwt
```
