# UMKM Digital - Marketplace Jampang Surade

Marketplace e-commerce profesional seperti Shopee untuk UMKM lokal Jampang Surade.

## Overview

Multi-role marketplace dengan UI modern Shopee-style:
- **Buyers**: Landing page, search, kategori, keranjang (cart drawer), checkout form, riwayat order, ulasan
- **Sellers**: Dashboard toko, manajemen produk, pesanan masuk, penarikan saldo, profil toko
- **Admins**: Statistik, kelola order/produk/penarikan, rekening pembayaran, saldo manual, tambah admin

## Tech Stack

- **Frontend**: React (latest) + Vite
- **Database/Auth**: Firebase (Firestore + Authentication)
- **Image Hosting**: Cloudinary
- **Shipping API**: RajaOngkir
- **Styling**: Custom CSS (index.css) dengan desain Shopee-style
- **Font**: Inter (Google Fonts)

## Design System

- **Primary Color**: #EE4D2D (Shopee Orange)
- **Background**: #F5F5F5
- **Layout**: Sticky navbar, sidebar dashboard, grid produk 5 kolom

## Key Features

- Sticky navbar dengan search bar, cart icon, notifikasi badge
- Hero banner gradient dengan CTA
- Filter kategori produk (Makanan, Fashion, dll)
- Sort produk (Terbaru, Termurah, Termahal, Terlaris)
- Cart drawer dari kanan dengan qty control
- Checkout form proper (tidak lagi pakai browser prompt)
- Product detail modal
- Sidebar dashboard untuk Buyer, Seller, Admin
- Tabel produk/order untuk admin
- Status badge berwarna (pending, aktif, selesai, dll)
- Sistem notifikasi terisolasi per peran (buyer/seller/admin):
  - Admin: menerima SEMUA notifikasi dari seluruh aktivitas platform
  - Seller: hanya menerima notif dari pesanan produk miliknya sendiri
  - Buyer: hanya menerima notif untuk pesanan miliknya sendiri
  - Notif pendaftaran user/seller hanya masuk ke admin (tanpa userId)
- NotificationPage: ikon per tipe, warna indikator, waktu relatif, desain mobile-friendly
- Mobile responsive: bottom navigation, 2-row navbar, cart bottom-sheet, safe area inset

## Project Structure

```
src/
├── App.jsx           # Main app + semua komponen
├── index.css         # Design system & semua styles
├── main.jsx          # React entry point
└── services/
    ├── firebase.js   # Firebase config
    └── cloudinary.js # Upload gambar
api/
├── cities.js         # RajaOngkir cities
└── ongkir.js         # Kalkulasi ongkir
```

## Development

```bash
npm install
npm run dev   # Port 5000
```

## Deployment

Static site: build → dist
