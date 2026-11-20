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

### Sadece sen bakarken çalışır

Sekme arka plandayken, başka bir uygulamaya geçtiğinde ya da 8 dakika ekrana dokunmadığında kanka uyur ve
modele hiçbir istek gitmez (yalnızca senin yazdığın kelimenin çevirisi her zaman çalışır). Dokununca uyanır.

### Öğrenme hızı

Kelimeler gün içinde çok sık (aktifken kelime başına saatte onlarca kez) ama her seferinde yeni bir cümle ya da
soru türüyle gelir; az görülen ve düşük seviyeli kelimeler öne alınır. Seviye ise sadece tekrar zamanı gelmiş kelimeyi
bildiğinde artar (2 dk → 10 dk → 1 saat → 5 saat → 1 gün → 3 gün …); aradaki tüm tekrarlar "Extra-Übung"dur.
Aynı kelime üst üste gelmez (az kelimede 25 sn, çok kelimede 90 sn ara).

### Akıllı tekrar

SM-2 (Anki'nin yöntemi) benzeri: her kelimenin bir kolaylık puanı var. Cevap kalitesi doğruluk, cevap süresi
ve yazım/artikel hatalarından hesaplanır. Öğrenme adımları 2 dk → 10 dk → 1 sa → 5 sa → 1 gün; sonrasında aralık
kolaylık puanıyla büyür (hızlı bilinen kelimeler haftalar sonra, zorlar 1–2 günde bir). Aradaki pratiklerde yapılan
hata tekrarı öne çeker ve kelimeyi "zor" yapar; zor kelimeler gün içinde daha sık gelir (listede `!` ile işaretli).

### Senkron (iPad ⇄ telefon)

≡ → Senkron → **senkronu aç** bir kod üretir; diğer cihazda bu kod girilir ya da "bağlantıyı kopyala" ile gelen
bağlantı açılır. Kelimeler, ilerleme, ayarlar, profil ve maliyet cihazlar arasında eşitlenir (değişiklik varsa
45 sn'de bir, sekme değişince ve açılışta). Veriler Worker'daki bir Durable Object'te, kodun SHA-256 özetiyle
saklanır; her cihaz kendi kaydına yazar, diğerlerini birleştirir. Silinen kelimeler diğer cihazdan geri gelmez.

### Sadece Almanca

Karakter yalnızca basit Almanca konuşur. Türkçe sadece kelimenin karşılığında görünür; cümle çevirileri
balondaki **TR** düğmesine dokununca açılır.

### Seni tanıması

Uygulama yaptıklarını küçük bir günlükte tutar: sorduğun kelimeler (yazdığın hâliyle), quiz sonuçları,
Almanca cevapların, kabul ettiğin/geçtiğin öneriler. Birkaç yeni olayda bir model bu günlükten bir profil çıkarır:
seviyen, ilgi alanların, hayatından ipuçları, öğrenmek istediklerin, zayıf noktaların ve yazış tarzın.
Sonraki her çeviri, cümle, soru ve düzeltme bu profile göre yapılır; kanka fark ettiği şeyleri düşünce balonunda söyler.
Profil ≡ menüsünde "Kanka seni nasıl tanıyor" bölümünde görünür; **unut** ile silinir. Günlük ve profil yalnızca
tarayıcında saklanır, istekle birlikte modele gönderilir.

Worker'a ulaşılamazsa uygulama Google Translate + yerleşik sözlük + yerel tekrar ile çalışmaya devam eder.

Worker'ı güncellemek: Cloudflare panelinde `kelime-ai` → **Edit code** → `cloudflare/worker.js` içeriğini yapıştır → **Deploy**.
