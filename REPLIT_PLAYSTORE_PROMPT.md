# Prompt Replit untuk Finalisasi Play Store

Kamu adalah senior Android Capacitor engineer dan React marketplace engineer. Lanjutkan project UMKM Digital ini agar benar-benar siap dibuild menjadi Android App Bundle `.aab` untuk upload Google Play Store.

BATASAN WAJIB:
1. Jangan mengubah struktur React existing.
2. Jangan merusak Firebase/Auth/Firestore/Cloudinary.
3. Jangan mengubah UI search bar.
4. Jangan menghapus cart pilih item checkout.
5. Jangan menghapus filter lokasi desa/kecamatan/kabupaten.
6. Jangan menghapus dashboard buyer/seller/admin.
7. Jangan menghapus service worker dan push notification.

TUGAS:
1. Jalankan `npm install`.
2. Jalankan `npm run build`.
3. Jalankan `npm run android:init` jika folder android belum ada.
4. Jalankan `npm run android:sync`.
5. Pastikan icon aplikasi Android memakai icon UMKM Digital.
6. Pastikan nama aplikasi Android: UMKM Digital.
7. Pastikan package id: `com.umkmjampangsurade.marketplace`.
8. Buka project Android dan pastikan release build bisa dibuat.
9. Buat instruksi signing keystore untuk Google Play Store.
10. Jangan upload ke Play Store otomatis kecuali saya minta.

QUALITY CONTROL:
- Web build harus berhasil.
- Android sync harus berhasil.
- App harus portrait.
- Tidak boleh ada error blank screen.
- Firebase messaging tidak boleh dirusak.
- Checkout, cart, filter lokasi, login, dashboard, dan chat tetap aman.

OUTPUT:
- Daftar file yang diubah.
- Status build web.
- Status Android sync.
- Instruksi membuat `.aab` final.
