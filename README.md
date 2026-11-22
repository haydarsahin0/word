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

### İkinci çalışan: kullanım uzmanı

Odanın sağında ikinci bir çalışan var (yuvarlak gözlük, topuz, tüplü bilgisayar ve kelime kartı kutusu). Bir kelimenin
cevabı ortaya çıktığı anda (soru cevaplanınca, kelime aranınca, kitaptan ya da öneriden eklenince) kendi kartında
o kelimenin **nasıl kullanıldığını** gösterir: dil bilgisi kalıbı, en sık birlikte kullanıldığı fiil/sıfatlar, farklı
bağlamlarda 3 örnek cümle, eş/zıt anlamlılar ve ne zaman kullanıldığı (Türkçesi TR düğmesinde). Fiillerde
ayrıca çekim satırı: Präsens (gerekirse du-formu), Präteritum, Perfekt (hat/ist kalın) ve ayrılabiliyorsa nasıl ayrıldığı. Kart, sorulan
kelimeyi ele vermemek için hep cevabı verilmiş kelimeyi gösterir. Bilgiler kelime başına **bir kez** üretilir
(Worker `usage` eylemi, 8'erli paketler), kelimeyle saklanır ve senkronlanır; ilk açılışta mevcut kelimelerin hepsi
toplu hazırlanır. Dar ekranlarda kart küçük bir etiket olarak görünür, dokununca açılır.

### Kelime görselleri

Her kelime için önce dil modeli, anlamı **bir bakışta** anlatan somut bir sahne tasarlar (ör. *Geduld*: uzun bir
kuyrukta gülümseyerek bekleyen biri; *langsam*: koşucunun yanında salyangoz), sonra Meta'nın **Muse Image** modeli
(`muse-image-1.0`, aynı `musebaba` anahtarı) bunu uygulamanın 4 tonlu piksel tarzında, yazısız çizer. Görsel kelime başına **bir kez** üretilir,
Worker'daki bir Durable Object'te (`ImageStore`) saklanır ve `…/img/<anahtar>.png` adresinden sunulur; senkronla
diğer cihaza da gelir. Kelime kartında küçük, yeni **„Was ist das?"** sorusunda büyük gösterilir. Görseli olmayan
kelimeler için uygulama açıkken arka arkaya üretilir. Beklenmedik masrafa karşı günde en fazla 150 görsel; görsel başı ~0,02 $
sağ üstteki maliyete eklenir.

### Kitap okuma

İstatistiklerin yanındaki pencerede **Buch öffnen** ile bir EPUB ya da TXT dosyası açılır; kitap baştan, 5 satırlık
sayfalarla gösterilir. ‹ › düğmeleri, kaydırma ya da klavye oklarıyla sayfa çevrilir; kaldığın yer hatırlanır.
Bir kelimeye dokununca kanka onu **o cümledeki anlamıyla** açıklar (ör. *ging* → *gehen*), kitaptaki cümleyi örnek
olarak gösterir; **ins Heft** ile deftere eklenir. Okurken kanka araya soru sokmaz. Kitap yalnızca bu cihazda
(IndexedDB) saklanır; EPUB için ek kütüphane yok (küçük ZIP okuyucu + tarayıcının `DecompressionStream`'i).

### Soru türleri

Yalnızca iki tür soru var: **„Was ist das?"** (sadece kelimenin görseli gösterilir) ve **Türkçe → Almanca**
(Türkçesi gösterilir, Almancası artikeliyle yazılır; **Tipp** artikeli ve ilk harfleri gösterir, ipucu alınan
cevap "zor" sayılır). Görseli olmayan kelimeler Türkçe → Almanca sorulur. Arada kanka yeni kelime önerir ve
düşünce balonlarında konuşur; model bunun için 2 dakikada bir, kısa bir istekle çağrılır.

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

### Ses

Kelimeler ve cümleler **Piper** ile okunur: açık kaynaklı, nöral bir Almanca ses; tamamen tarayıcıda çalışır,
ücretsizdir. İlk kullanımda bir kez ~90 MB indirilir (ses modeli Hugging Face'ten, motor jsDelivr'dan) ve service
worker'ın kalıcı önbelleğinde saklanır; sonra internetsiz de çalışır. Ayarlarda **Thorsten** (varsayılan),
**Stimme 2** (MLS) ya da **cihaz** sesi seçilir; ▶ ile dinlenir. Piper hazır değilse cihazın en kaliteli Almanca sesi
kullanılır. "low" kalitedeki eski Piper modelleri (Kerstin, Ramona, Eva) bazı Almanca seslerde bozulduğu için yok.

### Sesli anlatım

Ayarlardaki **Sesli okuma: kapalı / kelime / anlatım** (varsayılan anlatım). Anlatımda kanka kelimeyi artikeliyle,
basit Almanca açıklamasını ve (yeni kelimede, yanlış cevapta, kitaptan bakılan kelimede) bir örnek cümleyi ve
fiillerde Perfekt'i okur; doğru cevapta kelime + açıklama. Ses cümle cümle hazırlanıp çalınır (ilk cümle hemen
başlar), konuşurken karakterin ağzı oynar ve anlatım bitmeden yeni soru gelmez. Kartlardaki 🔊 anlatımı okur.

### Seni tanıması

Uygulama yaptıklarını küçük bir günlükte tutar: sorduğun kelimeler (yazdığın hâliyle), quiz sonuçları,
Almanca cevapların, kabul ettiğin/geçtiğin öneriler. Birkaç yeni olayda bir model bu günlükten bir profil çıkarır:
seviyen, ilgi alanların, hayatından ipuçları, öğrenmek istediklerin, zayıf noktaların ve yazış tarzın.
Sonraki her çeviri, cümle, soru ve düzeltme bu profile göre yapılır; kanka fark ettiği şeyleri düşünce balonunda söyler.
Profil ≡ menüsünde "Kanka seni nasıl tanıyor" bölümünde görünür; **unut** ile silinir. Günlük ve profil yalnızca
tarayıcında saklanır, istekle birlikte modele gönderilir.

Worker'a ulaşılamazsa uygulama Google Translate + yerleşik sözlük + yerel tekrar ile çalışmaya devam eder.

Worker'ı güncellemek: Cloudflare panelinde `kelime-ai` → **Edit code** → `cloudflare/worker.js` içeriğini yapıştır → **Deploy**.
