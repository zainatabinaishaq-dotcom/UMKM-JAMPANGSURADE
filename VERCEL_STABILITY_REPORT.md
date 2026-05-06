# Vercel Stability Report

Versi ini dibuat dari `UMKM-JAMPANGSURADE-final-hardened-production.zip`, yaitu versi yang sebelumnya terbukti berhasil di Vercel.

## Fokus perubahan
- Tidak mengubah UI/UX.
- Tidak mengubah fitur marketplace.
- Tidak mengubah Firebase, checkout, cart selection, filter lokasi, dashboard, atau search bar.
- Hanya menstabilkan dependency dan struktur deploy Vercel.

## Perubahan teknis
- Isi folder `work_play` dipindahkan menjadi root project, sehingga `package.json` langsung berada di root GitHub.
- `.env` tidak disertakan karena environment variable sudah harus diatur di Vercel.
- Dependency di `package.json` dibuat eksplisit mengikuti versi dari `package-lock.json` agar npm tidak mengambil versi `latest` secara acak.
- Ditambahkan `engines` untuk Node 20.x supaya environment Vercel lebih stabil.
- Ditambahkan `.npmrc` untuk mengurangi audit/fund install noise dan menjaga peer dependency lebih aman.
- Ditambahkan `vercel.json` untuk memastikan build command, output directory, framework, dan SPA rewrites benar.

## Setting Vercel yang disarankan
- Framework: Vite
- Install Command: npm install
- Build Command: npm run build
- Output Directory: dist
- Node.js: 20.x

## Catatan
File `.env` memang tidak ikut agar secret/config tidak bocor ke GitHub. Masukkan semua variable `VITE_...` di Vercel Project Settings > Environment Variables.
