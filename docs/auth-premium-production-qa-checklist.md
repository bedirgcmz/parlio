# Auth ve Premium Production QA Checklist

Bu liste release oncesi gercek cihazda auth, session, reinstall ve premium akisini dogrulamak icin kullanilir.

## Auth Session

- [ ] Ilk kurulum: uygulama temiz kurulumdan acilir, Welcome/Auth akisi gelir, "Tekrar hos geldin" full-screen gorunmez.
- [ ] E-posta ile giris: basarili giristen sonra ana uygulama acilir, gerekirse sadece ust toast gorunur.
- [ ] Cold start: uygulama tamamen kapatilir ve tekrar acilir; saglam session varsa login ekranina dusmez.
- [ ] Overnight reopen: cihaz bekledikten/ertesi gun acildiginda saglam session korunur.
- [ ] Offline reopen: kullanici daha once login ise internet kapaliyken app acilir; offline pill gorunur, kullanici logout olmaz.
- [ ] Token refresh: app arka planda bekletilip aktif hale getirilir; gecici auth event gürültüsü ana ekrandan cikarmamalidir.

## Logout

- [ ] Normal logout: "Bu cihazdan cikis" onayi gorunur, onay sonrasi auth akisi gelir.
- [ ] Offline logout: internet kapaliyken logout istenir; local cikis tamamlanir, kullanici iceride kilitli kalmaz.
- [ ] Bekleyen offline islem: queue veya pending game score varken logout istenir; veri kaybi uyarisi gorunur.
- [ ] Logout sonrasi reopen: app tekrar acildiginda eski session restore edilmez.

## Reinstall ve Install Integrity

- [ ] App sil-yukle: uygulama yeniden kuruldugunda local session kullanilmaz, kullanici yeniden giris yapar.
- [ ] Reinstall sonrasi giris: server ayarlari ve premium hakki geri gelir; "seni hatirladi" hissi veren full-screen gorunmez.
- [ ] Yeni cihaz girisi: kullanici giris yapar, ana uygulama acilir; eski cihazdan geliyormus gibi davranilmaz.

## OAuth ve Password Reset

- [ ] Google login: browser callback sonrasi session kurulur ve ana uygulama acilir.
- [ ] Apple login: iOS cihazda session kurulur ve ana uygulama acilir; session yoksa loading takili kalmaz.
- [ ] Password reset: reset linki app'i acip sifre degistirme ekranina goturur.
- [ ] Reset sonrasi: yeni sifre kaydedilir, kullanici gecerli authenticated state'te kalir.
- [ ] Log kontrolu: callback URL veya access/refresh token loglarda gorunmez.

## Premium ve Paywall

- [ ] Aktif premium online: profil ve premium gate'ler premium olarak acilir.
- [ ] Premium cold start: app acilir acilmaz Paywall'a gidilse bile RevenueCat user id ile hazirlanir.
- [ ] Restore purchase: aktif abonelik restore edilir ve premium state hemen guncellenir.
- [ ] Premium offline grace: son 72 saat icinde RevenueCat tarafindan aktif dogrulanan premium kullanici offline acilista premium deneyimini korur.
- [ ] Grace expiry: 72 saatten eski dogrulama offline durumda premium olarak kabul edilmez.
- [ ] Expired subscription online: RevenueCat inactive donerse premium kapatilir ve local grace temizlenir.

## Account Deletion

- [ ] Delete account: geri alinamaz veri silme uyarisi gorunur.
- [ ] Subscription copy: uyarida App Store / Google Play aboneliginin hesabi silmekle iptal olmayacagi belirtilir.
- [ ] Delete success: local session, user cache ve premium grace temizlenir; yeniden acilista eski hesap restore edilmez.
- [ ] Delete failure: hata mesajindan sonra kullanici mevcut session ile uygulamada kalir.

## Kabul Kriteri

- [ ] Kullanicilar saglam session ile beklenmedik logout yasamaz.
- [ ] Kullanici bilincli logout/delete yapmadikca local state silinmez.
- [ ] Reinstall/new-device akislari kullaniciyi "hatirlanmis" gibi hissettirmez.
- [ ] Premium kullanici gecici offline durumda gereksiz paywall gormez.
- [ ] Auth callback tokenlari loglara yazilmaz.
