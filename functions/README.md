# Push Notification Cloud Function

Folder ini diperlukan agar notifikasi tetap masuk saat website ditutup.

Deploy sekali dari root project:

```bash
npm install -g firebase-tools
firebase login
firebase init functions
cd functions
npm install
cd ..
firebase deploy --only functions
```

Pastikan collection `users` menyimpan `fcmToken` dari tombol **Aktifkan Notifikasi** di dashboard.
