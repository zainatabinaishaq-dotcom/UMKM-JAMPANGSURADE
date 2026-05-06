# UMKM Digital — Paket Siap Bungkus Play Store

Paket ini sudah disiapkan agar website React/Vite bisa dibungkus menjadi aplikasi Android menggunakan Capacitor.

## Yang sudah ditambahkan

- `capacitor.config.json`
- Script Android di `package.json`
- Dependency Capacitor:
  - `@capacitor/core`
  - `@capacitor/cli`
  - `@capacitor/android`
- Manifest PWA yang lebih siap mobile/Play Store
- Icon aplikasi:
  - `public/icon-192.png`
  - `public/icon-512.png`
  - `public/icon-maskable-512.png`
  - `public/favicon-32.png`
  - `public/splash-2732.png`
- Meta mobile di `index.html`

## Cara build web

```bash
npm install
npm run build
```

## Cara membuat project Android

Jalankan sekali saja:

```bash
npm run android:init
```

Lalu setiap ada update web:

```bash
npm run android:sync
```

Buka Android Studio:

```bash
npm run android:open
```

## Cara membuat file AAB untuk Play Store

Di Android Studio:

1. Buka folder `android`.
2. Pilih menu `Build`.
3. Pilih `Generate Signed Bundle / APK`.
4. Pilih `Android App Bundle`.
5. Buat atau pilih keystore.
6. Pilih release.
7. Build file `.aab`.
8. Upload `.aab` ke Google Play Console.

Alternatif terminal setelah Android project dibuat dan signing sudah diatur:

```bash
npm run android:build:aab
```

## Data Play Store yang disarankan

Nama aplikasi:
UMKM Digital Jampang Surade

Short description:
Marketplace produk lokal UMKM Jampang Surade.

Full description:
UMKM Digital Jampang Surade adalah marketplace produk lokal yang membantu buyer menemukan produk UMKM berdasarkan kategori dan lokasi, melakukan checkout, chat, serta memantau pesanan. Seller dapat mengelola produk, pesanan, dan penjualan melalui dashboard khusus.

Kategori:
Shopping

Target utama:
Indonesia

Catatan penting:
Sebelum upload production, pastikan domain hosting HTTPS aktif, Firebase rules sudah aman, privacy policy tersedia, dan akun pembayaran/checkout sudah diuji.
