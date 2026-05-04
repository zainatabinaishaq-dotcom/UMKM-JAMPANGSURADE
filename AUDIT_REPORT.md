# UMKM Jampang Surade - Audit Final

Audit dilakukan pada project final dengan fokus menjaga sistem lama tetap aman sambil memperbaiki bug penting.

## Perbaikan yang dilakukan

1. Checkout ambil di tempat / tunai
   - Dipastikan selalu tersimpan sebagai `paymentMethod: "cash"`.
   - Tagihan komisi tunai otomatis dibuat untuk order pickup/tunai.

2. Komisi produk lama
   - Produk lama yang belum punya `commissionType` / `commissionValue` tetap memakai default 10%.
   - Komisi tetap dihitung dari total produk, tidak dari ongkir.

3. Saldo seller transfer/QRIS
   - Saldo seller = total produk - komisi admin + ongkir.
   - Saldo masuk hanya saat order selesai.
   - Tunai tidak menambah saldo seller.

4. Stok produk
   - Stok tetap berkurang saat checkout.
   - Jika pembayaran ditolak atau pembatalan disetujui, stok dikembalikan satu kali menggunakan penanda `stockRestored`.

5. Tagihan komisi tunai
   - Tagihan otomatis muncul untuk order tunai.
   - Seller upload bukti pembayaran.
   - Admin approve bukti.
   - Saat approve, seller otomatis dibuka blokirnya.
   - Blokir seller tetap manual dari admin/sub admin.

6. Cleanup aman
   - Menghapus update duplicate kecil pada soft delete produk.

## Hasil validasi

- `npm install` berhasil.
- `npm run build` berhasil.
- Warning bundle besar dari Vite masih ada, tapi bukan error dan tidak mengganggu build.

## Catatan operasional

- Untuk tahap ujicoba, pakai Firestore Rules longgar-aman yang sebelumnya diberikan agar semua fitur tidak kena permission error.
- Push notification saat website tertutup tetap membutuhkan deploy Firebase Functions.
