# Setup Push Notification UMKM Digital

Fitur di project ini sudah ditambahkan:

- Tombol **Aktifkan Notifikasi Real-time** setelah user login.
- Service worker `public/firebase-messaging-sw.js` untuk menerima Firebase Cloud Messaging.
- Cloud Function `functions/index.js` untuk mengirim push notification saat dokumen baru masuk ke collection `notifications`.
- Status notifikasi tersimpan sampai user logout.

## Penting

Agar notifikasi tetap masuk saat website ditutup, Cloud Function harus dideploy ke Firebase.

## Langkah deploy Cloud Function

```bash
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase deploy --only functions
```

## VAPID Key

Kalau token FCM gagal dibuat, buat Web Push certificate di Firebase Console:

Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair

Lalu tambahkan ke `.env`:

```bash
VITE_FIREBASE_VAPID_KEY=isi_key_dari_firebase
```

Setelah itu jalankan ulang:

```bash
npm run build
```

## Cara pakai user

1. User login.
2. Klik **Aktifkan Notifikasi**.
3. Pilih **Allow / Izinkan** di browser.
4. Setelah aktif, notifikasi tetap aktif sampai user logout.
