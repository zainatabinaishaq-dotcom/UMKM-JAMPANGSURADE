# UMKM Jampang Surade

A marketplace web application for local micro, small, and medium enterprises (UMKMs) in Jampang Surade.

## Overview

Multi-role marketplace supporting:
- **Buyers**: Browse products, add to cart, checkout with multiple shipping options
- **Sellers**: Upload products (admin approval required), manage orders, request balance withdrawals
- **Admins**: Manage user registrations, product approvals, payment settings, and withdrawal requests

## Tech Stack

- **Frontend**: React (latest) + Vite
- **Database/Auth**: Firebase (Firestore + Authentication)
- **Image Hosting**: Cloudinary
- **Shipping API**: RajaOngkir
- **Styling**: Inline CSS within React components
- **PWA**: Service Worker + Web App Manifest

## Project Structure

```
.
├── api/                    # Serverless API handlers (RajaOngkir)
│   ├── cities.js           # Fetch city data
│   └── ongkir.js           # Calculate shipping costs
├── public/                 # Static assets + PWA config
├── src/
│   ├── services/
│   │   ├── cloudinary.js   # Cloudinary upload logic
│   │   └── firebase.js     # Firebase initialization
│   ├── App.jsx             # Main app component
│   └── main.jsx            # React entry point
├── index.html
├── vite.config.js          # Vite config (port 5000, host 0.0.0.0, allowedHosts: true)
└── package.json
```

## Environment Variables

Stored in `.env`:
- `VITE_FIREBASE_*` - Firebase configuration
- `VITE_CLOUDINARY_CLOUD_NAME` - Cloudinary cloud name
- `VITE_CLOUDINARY_UPLOAD_PRESET` - Cloudinary upload preset
- `RAJAONGKIR_API_KEY` - RajaOngkir API key

## Development

```bash
npm install
npm run dev   # Starts on port 5000
```

## Deployment

Configured as a static site deployment:
- Build: `npm run build`
- Public dir: `dist`
