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
