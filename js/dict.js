/* Çevrimdışı da çalışsın diye küçük bir başlangıç sözlüğü.
   Biçim: türkçe | almanca | artikel | tür | almanca örnek | türkçe örnek
   tür: n = isim, v = fiil, a = sıfat, d = zarf/diğer */
(function () {
  const RAW = `
ev|Haus|das|n|Das Haus ist sehr alt.|Ev çok eski.
su|Wasser|das|n|Ich trinke jeden Tag viel Wasser.|Her gün çok su içerim.
ekmek|Brot|das|n|Das Brot ist noch warm.|Ekmek hâlâ sıcak.
kitap|Buch|das|n|Ich lese gerade ein spannendes Buch.|Şu anda heyecanlı bir kitap okuyorum.
araba|Auto|das|n|Unser Auto ist kaputt.|Arabamız bozuk.
okul|Schule|die|n|Die Schule beginnt um acht Uhr.|Okul saat sekizde başlıyor.
iş|Arbeit|die|n|Die Arbeit macht mir Spaß.|İş bana keyif veriyor.
zaman|Zeit|die|n|Ich habe heute keine Zeit.|Bugün hiç zamanım yok.
gün|Tag|der|n|Das war ein schöner Tag.|Güzel bir gündü.
gece|Nacht|die|n|Die Nacht war sehr kalt.|Gece çok soğuktu.
sabah|Morgen|der|n|Am Morgen trinke ich Kaffee.|Sabahları kahve içerim.
akşam|Abend|der|n|Der Abend war sehr ruhig.|Akşam çok sakindi.
hafta|Woche|die|n|Nächste Woche fahre ich nach Berlin.|Gelecek hafta Berlin'e gidiyorum.
yıl|Jahr|das|n|Das Jahr geht schnell vorbei.|Yıl hızla geçiyor.
arkadaş|Freund|der|n|Mein Freund wohnt in München.|Arkadaşım Münih'te oturuyor.
aile|Familie|die|n|Meine Familie ist sehr groß.|Ailem çok kalabalık.
anne|Mutter|die|n|Meine Mutter kocht sehr gut.|Annem çok iyi yemek yapar.
baba|Vater|der|n|Mein Vater arbeitet im Krankenhaus.|Babam hastanede çalışıyor.
çocuk|Kind|das|n|Das Kind spielt im Garten.|Çocuk bahçede oynuyor.
kadın|Frau|die|n|Die Frau liest eine Zeitung.|Kadın gazete okuyor.
adam|Mann|der|n|Der Mann wartet auf den Bus.|Adam otobüsü bekliyor.
şehir|Stadt|die|n|Die Stadt ist nachts sehr schön.|Şehir geceleri çok güzel.
yol|Weg|der|n|Der Weg zum Bahnhof ist kurz.|İstasyona giden yol kısa.
sokak|Straße|die|n|Die Straße ist heute ruhig.|Sokak bugün sakin.
kapı|Tür|die|n|Mach bitte die Tür zu.|Lütfen kapıyı kapat.
pencere|Fenster|das|n|Das Fenster ist offen.|Pencere açık.
masa|Tisch|der|n|Das Buch liegt auf dem Tisch.|Kitap masanın üzerinde duruyor.
sandalye|Stuhl|der|n|Der Stuhl ist sehr bequem.|Sandalye çok rahat.
oda|Zimmer|das|n|Mein Zimmer ist klein, aber gemütlich.|Odam küçük ama rahat.
mutfak|Küche|die|n|Wir essen heute in der Küche.|Bugün mutfakta yemek yiyoruz.
yemek|Essen|das|n|Das Essen schmeckt sehr gut.|Yemek çok lezzetli.
kahve|Kaffee|der|n|Der Kaffee ist zu heiß.|Kahve çok sıcak.
çay|Tee|der|n|Möchtest du einen Tee?|Bir çay ister misin?
süt|Milch|die|n|Die Milch ist im Kühlschrank.|Süt buzdolabında.
elma|Apfel|der|n|Ich esse jeden Morgen einen Apfel.|Her sabah bir elma yerim.
para|Geld|das|n|Ich habe kein Geld dabei.|Yanımda hiç para yok.
dil|Sprache|die|n|Deutsch ist eine schöne Sprache.|Almanca güzel bir dil.
kelime|Wort|das|n|Dieses Wort ist neu für mich.|Bu kelime benim için yeni.
soru|Frage|die|n|Ich habe eine Frage.|Bir sorum var.
cevap|Antwort|die|n|Die Antwort ist richtig.|Cevap doğru.
hava|Wetter|das|n|Das Wetter ist heute schön.|Bugün hava güzel.
güneş|Sonne|die|n|Die Sonne scheint.|Güneş parlıyor.
yağmur|Regen|der|n|Der Regen hört nicht auf.|Yağmur dinmiyor.
ağaç|Baum|der|n|Der Baum ist sehr hoch.|Ağaç çok yüksek.
köpek|Hund|der|n|Der Hund schläft unter dem Tisch.|Köpek masanın altında uyuyor.
kedi|Katze|die|n|Die Katze sitzt am Fenster.|Kedi pencerenin önünde oturuyor.
el|Hand|die|n|Gib mir deine Hand.|Bana elini ver.
göz|Auge|das|n|Mein linkes Auge tut weh.|Sol gözüm ağrıyor.
kalp|Herz|das|n|Mein Herz schlägt schnell.|Kalbim hızlı atıyor.
doktor|Arzt|der|n|Ich muss zum Arzt gehen.|Doktora gitmem gerekiyor.
tren|Zug|der|n|Der Zug kommt pünktlich.|Tren zamanında geliyor.
istasyon|Bahnhof|der|n|Wir treffen uns am Bahnhof.|İstasyonda buluşuyoruz.
mektup|Brief|der|n|Ich schreibe einen Brief.|Bir mektup yazıyorum.
müzik|Musik|die|n|Ich höre gern Musik.|Müzik dinlemeyi severim.
oyun|Spiel|das|n|Das Spiel war spannend.|Oyun heyecanlıydı.
deniz|Meer|das|n|Das Meer ist heute ruhig.|Deniz bugün sakin.
anahtar|Schlüssel|der|n|Wo ist mein Schlüssel?|Anahtarım nerede?
gitmek|gehen||v|Wir wollen morgen ins Kino gehen.|Yarın sinemaya gitmek istiyoruz.
gelmek|kommen||v|Kannst du morgen zu mir kommen?|Yarın bana gelebilir misin?
yapmak|machen||v|Was möchtest du heute machen?|Bugün ne yapmak istersin?
içmek|trinken||v|Ich möchte etwas trinken.|Bir şey içmek istiyorum.
okumak|lesen||v|Ich möchte dieses Buch lesen.|Bu kitabı okumak istiyorum.
yazmak|schreiben||v|Ich muss eine E-Mail schreiben.|Bir e-posta yazmam gerekiyor.
konuşmak|sprechen||v|Kannst du langsamer sprechen?|Daha yavaş konuşabilir misin?
anlamak|verstehen||v|Ich kann dich gut verstehen.|Seni iyi anlayabiliyorum.
öğrenmek|lernen||v|Ich will jeden Tag Deutsch lernen.|Her gün Almanca öğrenmek istiyorum.
çalışmak|arbeiten||v|Morgen muss ich nicht arbeiten.|Yarın çalışmak zorunda değilim.
uyumak|schlafen||v|Ich will heute früh schlafen.|Bugün erken uyumak istiyorum.
görmek|sehen||v|Ich möchte das Meer sehen.|Denizi görmek istiyorum.
bilmek|wissen||v|Ich möchte die Wahrheit wissen.|Gerçeği bilmek istiyorum.
sevmek|lieben||v|Kinder lieben Geschichten.|Çocuklar hikâyeleri sever.
satın almak|kaufen||v|Wir wollen ein neues Auto kaufen.|Yeni bir araba almak istiyoruz.
beklemek|warten||v|Ich kann nicht länger warten.|Daha fazla bekleyemem.
yardım etmek|helfen||v|Kannst du mir helfen?|Bana yardım edebilir misin?
oynamak|spielen||v|Die Kinder spielen im Park.|Çocuklar parkta oynuyor.
açmak|öffnen||v|Kannst du das Fenster öffnen?|Pencereyi açabilir misin?
sormak|fragen||v|Darf ich dich etwas fragen?|Sana bir şey sorabilir miyim?
bulmak|finden||v|Ich kann meinen Schlüssel nicht finden.|Anahtarımı bulamıyorum.
pişirmek|kochen||v|Heute will ich Suppe kochen.|Bugün çorba pişirmek istiyorum.
unutmak|vergessen||v|Ich darf das nicht vergessen.|Bunu unutmamalıyım.
güzel|schön||a|Der Garten ist wirklich schön.|Bahçe gerçekten güzel.
büyük|groß||a|Unser Haus ist sehr groß.|Evimiz çok büyük.
küçük|klein||a|Die Wohnung ist klein, aber hell.|Daire küçük ama aydınlık.
yeni|neu||a|Mein Handy ist neu.|Telefonum yeni.
eski|alt||a|Das Auto ist schon alt.|Araba artık eski.
sıcak|heiß||a|Der Tee ist noch heiß.|Çay hâlâ sıcak.
soğuk|kalt||a|Im Winter ist es hier sehr kalt.|Kışın burası çok soğuk.
hızlı|schnell||a|Der Zug fährt sehr schnell.|Tren çok hızlı gidiyor.
yavaş|langsam||a|Bitte sprich langsam.|Lütfen yavaş konuş.
kolay|einfach||a|Die Aufgabe ist einfach.|Görev kolay.
zor|schwierig||a|Deutsch ist manchmal schwierig.|Almanca bazen zor.
mutlu|glücklich||a|Heute bin ich sehr glücklich.|Bugün çok mutluyum.
yorgun|müde||a|Nach der Arbeit bin ich müde.|İşten sonra yorgunum.
pahalı|teuer||a|Das Restaurant ist zu teuer.|Restoran çok pahalı.
ucuz|billig||a|Das Obst ist hier billig.|Meyve burada ucuz.
önemli|wichtig||a|Das ist sehr wichtig für mich.|Bu benim için çok önemli.
doğru|richtig||a|Deine Antwort ist richtig.|Cevabın doğru.
yanlış|falsch||a|Die Adresse ist falsch.|Adres yanlış.
bugün|heute||d|Heute habe ich frei.|Bugün izinliyim.
dün|gestern||d|Gestern war ich im Kino.|Dün sinemadaydım.
şimdi|jetzt||d|Ich habe jetzt keine Zeit.|Şimdi vaktim yok.
her zaman|immer||d|Er ist immer pünktlich.|O her zaman dakiktir.
asla|nie||d|Ich vergesse dich nie.|Seni asla unutmam.
belki|vielleicht||d|Vielleicht regnet es morgen.|Belki yarın yağmur yağar.
burada|hier||d|Ich wohne hier seit zwei Jahren.|İki yıldır burada oturuyorum.
teşekkürler|danke||d|Danke für deine Hilfe!|Yardımın için teşekkürler!
lütfen|bitte||d|Einen Kaffee, bitte.|Bir kahve, lütfen.
merhaba|hallo||d|Hallo, wie geht es dir?|Merhaba, nasılsın?
`;

  const SEED = RAW.trim().split('\n').map((line) => {
    const [tr, de, art, pos, exDe, exTr] = line.split('|');
    return { tr, de, art, pos, ex: exDe ? { de: exDe, tr: exTr, src: 'sözlük' } : null };
  });

  window.SEED_DICT = SEED;
})();
