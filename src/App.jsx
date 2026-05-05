import { useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  runTransaction,
} from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";
import { auth, db, firebaseConfig, getFirebaseMessaging } from "./services/firebase";
import { uploadImageToCloudinary } from "./services/cloudinary";
import "./index.css";

const complaintEmail = "umkmdigitalecommerce@gmail.com";
const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;
const formatNumberInput = (value) => String(value || "").replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const parseNumberInput = (value) => Number(String(value || "").replace(/\D/g, ""));
const getStock = (product) => Number(product?.stock ?? product?.stok ?? 0);
const isOutOfStock = (product) => getStock(product) <= 0;
const normalizeStatus = (status) => String(status || "").trim().toLowerCase();
const isOrderStatus = (order, status) => normalizeStatus(order?.statusPesanan) === normalizeStatus(status);



function getMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getOrderMillis(item) {
  return Math.max(
    getMillis(item?.createdAt),
    getMillis(item?.updatedAt),
    getMillis(item?.paymentProofUploadedAt),
    getMillis(item?.processedAt),
    getMillis(item?.shippingQuotedAt),
    getMillis(item?.verifiedAt),
    getMillis(item?.cancelRequestedAt),
    getMillis(item?.cancelApprovedAt),
    getMillis(item?.cancelRejectedAt),
    getMillis(item?.shippedAt),
    getMillis(item?.receivedAt)
  );
}

function sortNewest(items) {
  return [...items].sort((a, b) => {
    const diff = getOrderMillis(b) - getOrderMillis(a);
    if (diff !== 0) return diff;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}


function getOrderStatusRank(order) {
  const status = order?.statusPesanan || order?.statusPembayaran || "";
  const rank = {
    pembatalan_diajukan: 0,
    menunggu_ongkir: 1,
    menunggu_pembayaran: 2,
    menunggu_verifikasi: 3,
    sudah_dibayar: 4,
    pesanan_masuk: 5,
    diproses: 6,
    dikirim: 7,
    selesai: 8,
    dibatalkan: 9,
    ditolak: 10,
  };
  return rank[status] ?? 99;
}

function sortOrdersByStage(items = []) {
  return [...items].sort((a, b) => {
    const stageDiff = getOrderStatusRank(a) - getOrderStatusRank(b);
    if (stageDiff !== 0) return stageDiff;
    const timeDiff = getOrderMillis(b) - getOrderMillis(a);
    if (timeDiff !== 0) return timeDiff;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

const NOTIFICATION_SOUND_PATH = "/mixkit-happy-bells-notification-937.wav";
let notificationAudio = null;
let notificationAudioUnlocked = false;
let lastNotificationSoundAt = 0;

function getNotificationAudio() {
  if (typeof window === "undefined") return null;
  if (!notificationAudio) {
    notificationAudio = new Audio(NOTIFICATION_SOUND_PATH);
    notificationAudio.preload = "auto";
    notificationAudio.volume = 0.75;
  }
  return notificationAudio;
}

function unlockNotificationSound() {
  try {
    const audio = getNotificationAudio();
    if (!audio) return;
    audio.muted = true;
    audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        notificationAudioUnlocked = true;
      })
      .catch(() => {
        audio.muted = false;
        notificationAudioUnlocked = true;
      });
  } catch (error) {
    notificationAudioUnlocked = true;
  }
}

function playOrderSound() {
  try {
    if (!notificationAudioUnlocked) return;
    const now = Date.now();
    if (now - lastNotificationSoundAt < 1500) return;
    lastNotificationSoundAt = now;
    const audio = getNotificationAudio();
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch (error) {
    // Browser can block autoplay before user interaction. Ignore safely.
  }
}


const PUSH_SESSION_KEY = "umkm_push_notification_enabled";
const PUSH_TOKEN_KEY = "umkm_fcm_token";

function getNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function isPushSessionEnabled() {
  try {
    return localStorage.getItem(PUSH_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function lockNotificationSession() {
  try { localStorage.setItem(PUSH_SESSION_KEY, "1"); } catch {}
  notificationAudioUnlocked = true;
}

function clearNotificationSession() {
  try {
    localStorage.removeItem(PUSH_SESSION_KEY);
    localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {}
  notificationAudioUnlocked = false;
}

function getNotificationUrl(payloadData = {}) {
  const page = payloadData.page || (payloadData.chatId ? "chat" : "notif");
  return `${self?.location?.origin || window.location.origin}/?page=${encodeURIComponent(page)}`;
}

async function showLocalBrowserNotification(notif) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!isPushSessionEnabled()) return;
    if (document.visibilityState === "visible") return;

    const registration = await navigator.serviceWorker?.ready;
    if (!registration?.showNotification) return;

    await registration.showNotification(notif?.title || "Notifikasi Baru", {
      body: notif?.message || "Ada aktivitas baru di UMKM Digital.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: notif?.id || `umkm-${Date.now()}`,
      renotify: true,
      data: { page: notif?.type === "chat_message" ? "chat" : "notif", chatId: notif?.chatId || null },
    });
  } catch (error) {
    console.warn("Gagal menampilkan browser notification:", error);
  }
}

async function registerPushNotification(user, profile) {
  if (!user?.uid) throw new Error("User belum login.");
  if (typeof window === "undefined" || !("Notification" in window)) throw new Error("Browser ini belum mendukung notifikasi web.");
  if (!navigator.serviceWorker) throw new Error("Service worker belum didukung di browser ini.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi belum diberikan.");

  unlockNotificationSound();
  lockNotificationSession();

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;

  try {
    registration.active?.postMessage({ type: "UMKM_FIREBASE_CONFIG", firebaseConfig });
  } catch {}

  const messaging = await getFirebaseMessaging();
  if (!messaging) throw new Error("Firebase Messaging tidak didukung di browser ini.");

  const tokenOptions = { serviceWorkerRegistration: registration };
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (vapidKey) tokenOptions.vapidKey = vapidKey;

  const token = await getToken(messaging, tokenOptions);
  if (!token) throw new Error("Token notifikasi belum berhasil dibuat.");

  try { localStorage.setItem(PUSH_TOKEN_KEY, token); } catch {}

  await setDoc(doc(db, "users", user.uid), {
    notificationEnabled: true,
    notificationPermission: "granted",
    fcmToken: token,
    fcmTokenUpdatedAt: serverTimestamp(),
    notificationDevice: {
      userAgent: navigator.userAgent,
      platform: navigator.platform || "web",
      role: profile?.role || null,
    },
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return token;
}

function calcCommission(total, type, value) {
  const normalizedType = type || "percent";
  const normalizedValue = value === undefined || value === null || value === "" ? 10 : value;
  if (normalizedType === "percent") return Math.round(Number(total || 0) * (Number(normalizedValue || 0) / 100));
  if (normalizedType === "fixed") return Number(normalizedValue || 0);
  return Math.round(Number(total || 0) * 0.1);
}


const OPEN_COMMISSION_STATUSES = ["pending", "partial", "cancelled", "menunggu_approval"];
const PAYABLE_COMMISSION_STATUSES = ["pending", "partial", "cancelled"];
const COMMISSION_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
function isOpenCommissionBill(bill) {
  return OPEN_COMMISSION_STATUSES.includes(bill?.status) && Number(bill?.remaining || bill?.amount || 0) > 0;
}
function shouldRemindCommissionBill(bill) {
  if (!PAYABLE_COMMISSION_STATUSES.includes(bill?.status)) return false;
  if (Number(bill?.remaining || bill?.amount || 0) <= 0) return false;
  return Date.now() - getMillis(bill?.lastReminderAt) >= COMMISSION_REMINDER_INTERVAL_MS;
}
function shouldRemindAdminCommissionApproval(bill) {
  if (bill?.status !== "menunggu_approval") return false;
  if (Number(bill?.remaining || bill?.amount || 0) <= 0) return false;
  return Date.now() - getMillis(bill?.lastAdminApprovalReminderAt) >= COMMISSION_REMINDER_INTERVAL_MS;
}
function sumCommissionDebt(bills = []) {
  return bills.filter(isOpenCommissionBill).reduce((sum, bill) => sum + Number(bill.remaining || bill.amount || 0), 0);
}

async function autoDeductCommissionBills() {
  // Legacy helper disimpan agar kompatibel dengan kode lama.
  // Alur final sekarang diproses per order tunai melalui settleCashCommissionOnCompletion().
  return;
}

async function createCashCommissionBill(orderId, orderData, createNotif) {
  const existingSnap = await getDocs(query(collection(db, "komisi_tagihan"), where("orderId", "==", orderId)));
  if (!existingSnap.empty) return;

  const amount = Number(orderData.adminFee || 0);
  if (!amount || amount <= 0 || !orderData.sellerId) return;

  const billRef = doc(collection(db, "komisi_tagihan"));
  await setDoc(billRef, {
    sellerId: orderData.sellerId,
    sellerName: orderData.sellerName || "",
    orderId,
    productName: orderData.productName || "",
    amount,
    remaining: amount,
    paidFromBalance: 0,
    autoDeductedFromBalance: 0,
    manualPaidAmount: 0,
    status: "pending",
    source: "cash_order",
    note: "Tagihan komisi tunai dibuat otomatis. Saat pesanan selesai, saldo seller akan dipotong otomatis jika tersedia; sisanya tetap menjadi tagihan.",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "orders", orderId), {
    cashCommissionAmount: amount,
    cashCommissionPaidFromBalance: 0,
    cashCommissionRemaining: amount,
    cashCommissionStatus: "pending",
    commissionBillId: billRef.id,
    updatedAt: serverTimestamp(),
  });

  if (createNotif) {
    await createNotif({
      role: "seller",
      userId: orderData.sellerId,
      type: "commission_bill",
      title: "Tagihan Komisi Tunai Dibuat",
      message: `Tagihan komisi tunai ${rupiah(amount)} untuk ${orderData.productName} sudah dibuat. Saat pesanan selesai, saldo seller akan dipotong otomatis jika tersedia; sisanya akan tetap tampil sebagai tagihan.`,
      orderId,
    });
  }
}

async function settleCashCommissionOnCompletion(orderId, orderData, createNotif) {
  if (!orderId || !orderData?.sellerId || !isCashPayment(orderData)) return;

  const amount = Number(orderData.adminFee || orderData.cashCommissionAmount || 0);
  if (!amount || amount <= 0) return;

  const existingSnap = await getDocs(query(collection(db, "komisi_tagihan"), where("orderId", "==", orderId)));
  const billRef = existingSnap.empty ? doc(collection(db, "komisi_tagihan")) : doc(db, "komisi_tagihan", existingSnap.docs[0].id);
  const walletRef = doc(db, "seller_wallets", orderData.sellerId);
  const orderRef = doc(db, "orders", orderId);
  const txRef = doc(db, "wallet_transactions", `cash_commission_auto_deduct_${orderId}`);

  const result = await runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const freshOrder = orderSnap.data() || {};
    if (freshOrder.cashCommissionSettlementDone === true) {
      return { skipped: true };
    }

    const walletSnap = await transaction.get(walletRef);
    const billSnap = await transaction.get(billRef);
    const currentBalance = walletSnap.exists() ? Number(walletSnap.data()?.saldoTersedia || 0) : 0;
    const deduct = Math.min(currentBalance, amount);
    const remaining = Math.max(0, amount - deduct);
    const status = remaining <= 0 ? "auto_paid" : deduct > 0 ? "partial" : "pending";
    const sellerName = orderData.sellerName || freshOrder.sellerName || "";
    const productName = orderData.productName || freshOrder.productName || "";

    if (!walletSnap.exists()) {
      transaction.set(walletRef, {
        sellerId: orderData.sellerId,
        sellerName,
        saldoTersedia: 0,
        saldoTertahan: 0,
        totalPenjualan: 0,
        totalDitarik: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    if (deduct > 0) {
      transaction.set(walletRef, {
        saldoTersedia: increment(-deduct),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.set(txRef, {
        sellerId: orderData.sellerId,
        billId: billRef.id,
        orderId,
        type: "cash_commission_auto_deduct",
        amount: deduct,
        totalCommission: amount,
        remaining,
        note: `Komisi tunai dipotong otomatis dari saldo seller ${rupiah(deduct)}. Sisa tagihan ${rupiah(remaining)}.`,
        createdAt: serverTimestamp(),
      });
    }

    const billPayload = {
      sellerId: orderData.sellerId,
      sellerName,
      orderId,
      productName,
      amount,
      remaining,
      paidFromBalance: deduct,
      autoDeductedFromBalance: deduct,
      manualPaidAmount: 0,
      status,
      source: "cash_order",
      settledAtOrderComplete: true,
      autoDeductedAt: deduct > 0 ? serverTimestamp() : null,
      note: remaining <= 0
        ? `Komisi tunai ${rupiah(amount)} sudah lunas otomatis dipotong dari saldo seller.`
        : `Komisi tunai ${rupiah(amount)}: dipotong otomatis ${rupiah(deduct)} dari saldo seller, sisa tagihan ${rupiah(remaining)}.`,
      createdAt: billSnap.exists() ? billSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (billSnap.exists()) transaction.update(billRef, billPayload);
    else transaction.set(billRef, billPayload);

    transaction.update(orderRef, {
      cashCommissionAmount: amount,
      cashCommissionPaidFromBalance: deduct,
      cashCommissionRemaining: remaining,
      cashCommissionStatus: status,
      commissionBillId: billRef.id,
      cashCommissionSettlementDone: true,
      cashCommissionSettledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { skipped: false, amount, deduct, remaining, status, billId: billRef.id, sellerId: orderData.sellerId, productName };
  });

  if (!result || result.skipped) return;

  if (createNotif) {
    if (result.remaining <= 0) {
      await createNotif({
        role: "seller",
        userId: result.sellerId,
        type: "commission_auto_paid",
        title: "Komisi Tunai Lunas Otomatis",
        message: `Komisi tunai ${rupiah(result.amount)} untuk ${result.productName || "pesanan"} sudah otomatis dipotong dari saldo seller. Tidak ada sisa tagihan.`,
        billId: result.billId,
        orderId,
      });
    } else {
      await createNotif({
        role: "seller",
        userId: result.sellerId,
        type: "commission_bill",
        title: "Sisa Tagihan Komisi Tunai",
        message: `Komisi tunai ${rupiah(result.amount)}: saldo dipotong otomatis ${rupiah(result.deduct)}, sisa tagihan ${rupiah(result.remaining)}. Silakan bayar sisa tagihan dan upload bukti.`,
        billId: result.billId,
        orderId,
      });
    }
  }
}
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((Number(lat2) - Number(lat1)) * Math.PI) / 180;
  const dLon = ((Number(lon2) - Number(lon1)) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((Number(lat1) * Math.PI) / 180) *
      Math.cos((Number(lat2) * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function calculateSameDayShipping(distanceKm) {
  if (distanceKm <= 30) return 10000;
  return 10000 + Math.ceil(distanceKm - 30) * 2000;
}
const CATEGORY_GROUPS = {
  "Makanan": ["Makanan Ringan", "Makanan Berat", "Kue Basah", "Kue Kering", "Frozen Food", "Sambal", "Makanan Tradisional", "Makanan Khas Daerah"],
  "Minuman": ["Minuman Dingin", "Minuman Panas", "Kopi", "Teh", "Jus", "Minuman Herbal", "Minuman Kemasan"],
  "Fashion": ["Baju Pria", "Baju Wanita", "Baju Anak", "Daster", "Kaos", "Celana", "Jaket", "Hijab", "Sandal", "Sepatu", "Tas", "Aksesoris"],
  "Kecantikan & Perawatan": ["Skincare", "Makeup", "Body Care", "Hair Care", "Parfum", "Alat Kecantikan"],
  "Kesehatan": ["Vitamin", "Obat Herbal", "Alat Kesehatan", "Suplemen"],
  "Elektronik": ["HP", "Aksesoris HP", "Charger", "Headset", "Speaker", "Lampu", "Peralatan Elektronik Rumah"],
  "Rumah Tangga": ["Peralatan Dapur", "Peralatan Rumah", "Dekorasi Rumah", "Furniture", "Peralatan Kebersihan"],
  "Kebutuhan Harian": ["Sembako", "Air Galon", "Gas LPG", "Sabun & Deterjen", "Perawatan Diri"],
  "Bayi & Anak": ["Baju Bayi", "Perlengkapan Bayi", "Mainan Anak", "Susu & Makanan Bayi"],
  "Hobi & Olahraga": ["Alat Olahraga", "Sepeda", "Fitness", "Outdoor", "Memancing"],
  "Otomotif": ["Sparepart Motor", "Sparepart Mobil", "Aksesoris Kendaraan", "Oli & Cairan"],
  "Pertanian & Peternakan": ["Bibit Tanaman", "Pupuk", "Alat Pertanian", "Pakan Ternak"],
  "Hasil Laut": ["Ikan Segar", "Udang", "Cumi", "Kepiting", "Ikan Asin"],
  "Olahan Seafood": ["Kerupuk Ikan", "Abon Ikan", "Bakso Ikan", "Nugget Seafood", "Sambal Seafood"],
  "Peralatan Nelayan": ["Jaring", "Alat Pancing", "Umpan", "Cool Box", "Peralatan Laut"],
  "Kerajinan & UMKM": ["Handmade", "Kerajinan Kayu", "Kerajinan Bambu", "Kerajinan Kerang", "Souvenir"],
  "Oleh-Oleh": ["Oleh-Oleh Makanan", "Souvenir", "Produk Khas Daerah", "Hampers"],
  "Wisata & Jasa": ["Paket Wisata", "Sewa Perahu", "Guide Lokal", "Foto & Video", "Homestay"],
  "Jasa Lokal": ["Service Elektronik", "Tukang Bangunan", "Jasa Antar", "Laundry", "Bersih-Bersih", "Jasa Pijat"],
  "Lainnya": ["Produk Lainnya"],
};

const CATEGORY_ICONS = {
  all: "🏪",
  "Makanan": "🍱",
  "Minuman": "🥤",
  "Fashion": "👗",
  "Kecantikan & Perawatan": "💄",
  "Kesehatan": "💊",
  "Elektronik": "📱",
  "Rumah Tangga": "🏠",
  "Kebutuhan Harian": "🛒",
  "Bayi & Anak": "🧸",
  "Hobi & Olahraga": "⚽",
  "Otomotif": "🏍️",
  "Pertanian & Peternakan": "🌾",
  "Hasil Laut": "🐟",
  "Olahan Seafood": "🍤",
  "Peralatan Nelayan": "🎣",
  "Kerajinan & UMKM": "🧶",
  "Oleh-Oleh": "🎁",
  "Wisata & Jasa": "🏝️",
  "Jasa Lokal": "🛠️",
  "Lainnya": "📦",
};

const CATEGORIES = [
  { id: "all", label: "Semua", icon: CATEGORY_ICONS.all },
  ...Object.keys(CATEGORY_GROUPS).map((name) => ({ id: name, label: name, icon: CATEGORY_ICONS[name] || "📦" })),
];

function statusLabel(s) {
  const map = {
    menunggu_pembayaran: { label: "Menunggu Bayar", cls: "badge-yellow" },
    menunggu_verifikasi: { label: "Verifikasi", cls: "badge-yellow" },
    sudah_dibayar: { label: "Sudah Dibayar", cls: "badge-green" },
    pesanan_masuk: { label: "Pesanan Masuk", cls: "badge-green" },
    diproses: { label: "Diproses", cls: "badge-orange" },
    dikirim: { label: "Dikirim", cls: "badge-orange" },
    selesai: { label: "Selesai", cls: "badge-green" },
    dibatalkan: { label: "Dibatalkan", cls: "badge-red" },
    pembatalan_diajukan: { label: "Menunggu Approval Admin", cls: "badge-yellow" },
    ditolak: { label: "Ditolak", cls: "badge-red" },
    pending: { label: "Pending", cls: "badge-yellow" },
    active: { label: "Aktif", cls: "badge-green" },
    rejected: { label: "Ditolak", cls: "badge-red" },
    approved: { label: "Disetujui", cls: "badge-green" },
    paid: { label: "Dibayar", cls: "badge-green" },
    menunggu_ongkir: { label: "Menunggu Ongkir", cls: "badge-yellow" },
    tunai: { label: "Tunai", cls: "badge-green" },
  };
  return map[s] || { label: s, cls: "badge-gray" };
}

function productSoldCount(product) {
  return Number(product?.soldCount || product?.totalSold || product?.sold || product?.totalReviews || 0);
}

async function copyToClipboard(text, successMessage = "Berhasil disalin") {
  try {
    if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(String(text || ""));
    else {
      const textarea = document.createElement("textarea");
      textarea.value = String(text || "");
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    alert(successMessage);
  } catch (error) {
    alert("Gagal menyalin. Coba salin manual.");
  }
}

async function recomputeProductRating(productId) {
  if (!productId) return;
  const snap = await getDocs(query(collection(db, "reviews"), where("productId", "==", productId)));
  const list = snap.docs.map((d) => d.data());
  const total = list.length;
  const avg = total ? list.reduce((sum, r) => sum + Number(r.rating || 0), 0) / total : 0;
  await setDoc(doc(db, "products", productId), {
    averageRating: Number(avg.toFixed(1)),
    ratingCount: total,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}



async function resolveCheckoutProduct(item) {
  const itemId = String(item?.id || item?.productId || "");
  let merged = { ...(item || {}) };

  if (itemId && (!merged.sellerId || !merged.price || !merged.productName)) {
    try {
      const productSnap = await getDoc(doc(db, "products", itemId));
      if (productSnap.exists()) {
        merged = { id: productSnap.id, ...productSnap.data(), ...merged };
        // Keep fresh product fields when cart contains empty/invalid values.
        const fresh = productSnap.data();
        if (!merged.sellerId && fresh.sellerId) merged.sellerId = fresh.sellerId;
        if (!merged.productName && fresh.productName) merged.productName = fresh.productName;
        if (!merged.imageUrl && fresh.imageUrl) merged.imageUrl = fresh.imageUrl;
        if (!Number(merged.price || 0) && Number(fresh.price || 0)) merged.price = fresh.price;
        if (!merged.sellerName && fresh.sellerName) merged.sellerName = fresh.sellerName;
        if (!merged.sellerMapLink && fresh.sellerMapLink) merged.sellerMapLink = fresh.sellerMapLink;
        if (!merged.sellerAddress && fresh.sellerAddress) merged.sellerAddress = fresh.sellerAddress;
        if (!merged.commissionType && fresh.commissionType) merged.commissionType = fresh.commissionType;
        if (!merged.commissionValue && fresh.commissionValue) merged.commissionValue = fresh.commissionValue;
      }
    } catch (error) {
      console.error("Gagal mengambil ulang data produk checkout:", error);
    }
  }

  return merged;
}


function paymentMethodLabel(method) {
  const m = String(method || "").toLowerCase();
  if (m === "cash" || m === "tunai") return "Tunai / Cash";
  if (m === "qris") return "QRIS";
  if (m === "transfer") return "Transfer";
  return method || "Belum dipilih";
}

function isCashPayment(orderOrMethod) {
  const method = typeof orderOrMethod === "string" ? orderOrMethod : orderOrMethod?.paymentMethod;
  const paymentStatus = typeof orderOrMethod === "string" ? "" : orderOrMethod?.statusPembayaran;
  return String(method || "").toLowerCase() === "cash" || String(paymentStatus || "").toLowerCase() === "tunai";
}

function isTransferPayment(orderOrMethod) {
  const method = typeof orderOrMethod === "string" ? orderOrMethod : orderOrMethod?.paymentMethod;
  const m = String(method || "").toLowerCase();
  return m === "transfer" || m === "qris";
}

function getProductCommissionTotal(order) {
  // Komisi admin dihitung hanya dari total produk (harga x qty), tidak termasuk ongkir.
  const fee = Number(order?.adminFee || 0);
  if (fee > 0) return Math.max(0, fee);
  return Math.max(0, Number(order?.productTotal || 0) - Number(order?.sellerProductAmount || 0));
}

function getSellerTransferReceivableAmount(order) {
  // Alur final transfer/QRIS:
  // saldo seller = (total produk - komisi admin per item) + ongkir.
  // Ongkir adalah hak seller karena seller yang mengurus/menanggung pengiriman.
  const productTotal = Number(order?.productTotal || 0);
  const adminFee = getProductCommissionTotal(order);
  const shippingCost = Number(order?.shippingCost || 0);
  const computed = productTotal - adminFee + shippingCost;
  return Math.max(0, computed);
}

function getSellerReceivableAmount(order) {
  // Tunai tidak masuk saldo seller karena uang diterima langsung oleh seller.
  if (isCashPayment(order)) return 0;
  if (!isTransferPayment(order)) return 0;
  return getSellerTransferReceivableAmount(order);
}

function getAdminCommissionIncome(order) {
  const fee = getProductCommissionTotal(order);
  if (fee <= 0 || order?.statusPesanan !== "selesai") return 0;
  if (isTransferPayment(order)) return fee;
  if (isCashPayment(order)) {
    if (["approved", "auto_paid", "paid"].includes(order?.cashCommissionStatus)) return fee;
    const paid = Number(order?.cashCommissionPaidFromBalance || 0);
    const remaining = Number(order?.cashCommissionRemaining || 0);
    return Math.min(fee, Math.max(paid, fee - remaining));
  }
  return 0;
}

function canBuyerCancelOrder(order) {
  const statusPesanan = normalizeStatus(order?.statusPesanan);
  const statusPembayaran = normalizeStatus(order?.statusPembayaran);
  const shippingType = order?.shippingType || "";
  const paymentMethod = order?.paymentMethod || "";

  if (!order?.id) return false;
  if (["dikirim", "selesai", "dibatalkan", "ditolak", "pembatalan_diajukan"].includes(statusPesanan)) return false;
  if (["sudah_dibayar", "approved", "paid"].includes(statusPembayaran)) return false;
  if (shippingType === "same_day" && paymentMethod === "transfer" && statusPesanan === "dikirim") return false;
  if (["jne", "pos", "tiki", "jnt", "sicepat"].includes(shippingType) && paymentMethod === "transfer" && ["sudah_dibayar", "approved", "paid"].includes(statusPembayaran)) return false;
  return true;
}

async function creditSellerBalanceOnce(orderId, orderData, createNotif) {
  if (!orderId || !orderData?.sellerId) return;
  if (orderData.balanceCredited === true) return;

  // Pembayaran tunai tidak masuk saldo seller karena uang produk diterima langsung oleh seller.
  // Saldo seller hanya diisi untuk order transfer/QRIS saat order sudah selesai.
  if (!isTransferPayment(orderData) || isCashPayment(orderData)) return;

  const sellerAmount = getSellerReceivableAmount(orderData);
  const productTotal = Number(orderData.productTotal || 0);
  if (sellerAmount <= 0) return;

  const walletRef = doc(db, "seller_wallets", orderData.sellerId);
  const walletSnap = await getDoc(walletRef);

  if (!walletSnap.exists()) {
    await setDoc(walletRef, {
      sellerId: orderData.sellerId,
      sellerName: orderData.sellerName || "",
      saldoTersedia: 0,
      saldoTertahan: 0,
      totalPenjualan: 0,
      totalDitarik: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  const batch = writeBatch(db);
  batch.set(walletRef, {
    sellerId: orderData.sellerId,
    sellerName: orderData.sellerName || "",
    saldoTersedia: increment(sellerAmount),
    totalPenjualan: increment(productTotal),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(doc(collection(db, "wallet_transactions")), {
    sellerId: orderData.sellerId,
    orderId,
    type: "transfer_order_completed_credit",
    amount: sellerAmount,
    productTotal,
    adminFee: getProductCommissionTotal(orderData),
    shippingCost: Number(orderData.shippingCost || 0),
    note: "Saldo seller transfer/QRIS = total produk - komisi + ongkir, masuk setelah pesanan selesai",
    createdAt: serverTimestamp(),
  });

  batch.update(doc(db, "orders", orderId), {
    balanceCredited: true,
    balanceCreditedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

async function completeOrderAndCreditSeller(order, extra = {}, createNotif) {
  if (!order?.id) return;
  await updateDoc(doc(db, "orders", order.id), {
    statusPesanan: "selesai",
    receivedAt: serverTimestamp(),
    soldCounted: true,
    updatedAt: serverTimestamp(),
    ...extra,
  });

  const completedOrderData = { ...order, statusPesanan: "selesai", ...extra };
  await creditSellerBalanceOnce(order.id, completedOrderData, createNotif);
  await settleCashCommissionOnCompletion(order.id, completedOrderData, createNotif);

  if (order.productId && !order.soldCounted) {
    try {
      await setDoc(doc(db, "products", order.productId), {
        soldCount: increment(Number(order.quantity || 1)),
        totalSold: increment(Number(order.quantity || 1)),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error("Gagal update jumlah terjual:", error);
    }
  }
}

async function restoreProductStockOnce(order) {
  if (!order?.id || !order?.productId || order.stockRestored === true) return;
  const qty = Number(order.quantity || 0);
  if (qty <= 0) return;
  const batch = writeBatch(db);
  batch.set(doc(db, "products", order.productId), { stock: increment(qty), updatedAt: serverTimestamp() }, { merge: true });
  batch.update(doc(db, "orders", order.id), { stockRestored: true, stockRestoredAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();
}

async function cancelCashCommissionBillForOrder(orderId) {
  if (!orderId) return;
  try {
    const snap = await getDocs(query(collection(db, "komisi_tagihan"), where("orderId", "==", orderId)));
    await Promise.all(snap.docs.map((billDoc) => updateDoc(doc(db, "komisi_tagihan", billDoc.id), {
      status: "cancelled",
      remaining: 0,
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })));
  } catch (error) {
    console.error("Gagal membatalkan tagihan komisi order:", error);
  }
}

function scrollToTopSmooth() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState(() => {
    try {
      const urlPage = new URLSearchParams(window.location.search).get("page");
      if (urlPage) return urlPage;
      const pendingPage = sessionStorage.getItem("umkm_pending_page");
      if (pendingPage) {
        sessionStorage.removeItem("umkm_pending_page");
        return pendingPage;
      }
    } catch {}
    return "home";
  });
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [paymentSetting, setPaymentSetting] = useState(null);
  const [manualBalance, setManualBalance] = useState(null);
  const [commissionSetting, setCommissionSetting] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [commissionBills, setCommissionBills] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [pushStatus, setPushStatus] = useState(() => getNotificationPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const seenOrderIdsRef = useRef(new Set());
  const orderSoundReadyRef = useRef(false);
  const seenNotificationIdsRef = useRef(new Set());
  const notificationSoundReadyRef = useRef(false);

  async function createNotif(data) {
    try {
      await addDoc(collection(db, "notifications"), { ...data, isRead: false, createdAt: serverTimestamp() });
    } catch (error) {
      console.error("Gagal membuat notifikasi:", error);
    }
  }

  useEffect(() => {
    const unlock = () => unlockNotificationSound();
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);


  useEffect(() => {
    if (isPushSessionEnabled() && getNotificationPermission() === "granted") {
      notificationAudioUnlocked = true;
      setPushStatus("granted");
    }
  }, []);


  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const handleMessage = (event) => {
      if (event?.data?.type === "UMKM_OPEN_PAGE" && event.data.page) {
        setPage(event.data.page);
        setShowCart(false);
        setSelectedProduct(null);
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!user) return;
    let unsubMessage = null;
    let active = true;
    getFirebaseMessaging().then((messaging) => {
      if (!active || !messaging) return;
      unsubMessage = onMessage(messaging, (payload) => {
        playOrderSound();
        showLocalBrowserNotification({
          id: payload?.messageId,
          title: payload?.notification?.title || payload?.data?.title || "Notifikasi Baru",
          message: payload?.notification?.body || payload?.data?.body || payload?.data?.message || "Ada aktivitas baru di UMKM Digital.",
          type: payload?.data?.type,
          chatId: payload?.data?.chatId,
        });
      });
    }).catch(() => {});
    return () => {
      active = false;
      if (typeof unsubMessage === "function") unsubMessage();
    };
  }, [user]);

  async function enablePushNotifications() {
    if (!user) return;
    setPushBusy(true);
    setPushError("");
    try {
      await registerPushNotification(user, profile);
      setPushStatus("granted");
      alert("Notifikasi berhasil diaktifkan. Suara akan tetap aktif setelah refresh, dan push notification siap menerima pesan dari sistem.");
    } catch (error) {
      console.error("Gagal mengaktifkan notifikasi:", error);
      setPushStatus(getNotificationPermission());
      setPushError(error?.message || "Gagal mengaktifkan notifikasi.");
    } finally {
      setPushBusy(false);
    }
  }

  async function logoutAndClearSession() {
    clearNotificationSession();
    try {
      if (user?.uid) {
        await setDoc(doc(db, "users", user.uid), {
          notificationEnabled: false,
          notificationLoggedOutAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
    } catch {}
    await signOut(auth);
    navGoTo("home");
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      try {
        if (u) {
          const snap = await getDoc(doc(db, "users", u.uid));
          setProfile(snap.exists() ? snap.data() : null);
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error("Gagal memuat profil user:", error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    }, (error) => {
      console.error("Auth listener error:", error);
      setLoading(false);
    });

    const safetyTimer = setTimeout(() => setLoading(false), 6000);
    return () => {
      clearTimeout(safetyTimer);
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "products"), (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Products realtime error:", error);
      setProducts([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "orders"), (snap) => {
      setOrders(sortOrdersByStage(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Orders realtime error:", error);
      setOrders([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "reviews"), (snap) => {
      setReviews(sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Reviews realtime error:", error);
      setReviews([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "withdrawals"), (snap) => {
      setWithdrawals(sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Withdrawals realtime error:", error);
      setWithdrawals([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "seller_wallets"), (snap) => {
      setWallets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Wallets realtime error:", error);
      setWallets([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "komisi_tagihan"), (snap) => {
      setCommissionBills(sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, (error) => {
      console.error("Commission bills realtime error:", error);
      setCommissionBills([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setAllUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Users realtime error:", error);
      setAllUsers([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "payment"), (snap) => {
      setPaymentSetting(snap.exists() ? snap.data() : null);
    }, (error) => {
      console.error("Payment settings realtime error:", error);
      setPaymentSetting(null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "manualBalance"), (snap) => {
      setManualBalance(snap.exists() ? snap.data() : null);
    }, (error) => {
      console.error("Manual balance realtime error:", error);
      setManualBalance(null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "commission"), (snap) => {
      setCommissionSetting(snap.exists() ? snap.data() : { globalCommissionPercent: 10 });
    }, (error) => {
      console.error("Commission settings realtime error:", error);
      setCommissionSetting({ globalCommissionPercent: 10 });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!profile || !user) return;
    const qNotif =
      profile.role === "admin" || profile.role === "sub_admin"
        ? query(collection(db, "notifications"), where("role", "==", "admin"))
        : query(collection(db, "notifications"), where("userId", "==", user.uid));
    const unsub = onSnapshot(qNotif, (snap) => {
      const data = sortNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const currentIds = new Set(data.map((n) => n.id));
      if (!notificationSoundReadyRef.current) {
        seenNotificationIdsRef.current = currentIds;
        notificationSoundReadyRef.current = true;
      } else {
        const newNotifications = data.filter((n) => !seenNotificationIdsRef.current.has(n.id));
        const hasNewNotification = newNotifications.length > 0;
        if (hasNewNotification) {
          playOrderSound();
          newNotifications.slice(0, 3).forEach((n) => showLocalBrowserNotification(n));
        }
        seenNotificationIdsRef.current = currentIds;
      }
      setNotifications(data);
    }, (error) => {
      console.error("Notifications realtime error:", error);
      setNotifications([]);
    });
    return () => unsub();
  }, [profile, user]);

  useEffect(() => {
    if (!profile || !user) return;

    const relevantOrders =
      profile.role === "admin" || profile.role === "sub_admin"
        ? orders
        : profile.role === "seller"
          ? orders.filter((order) => order.sellerId === user.uid)
          : [];

    const currentIds = new Set(relevantOrders.map((order) => order.id));

    if (!orderSoundReadyRef.current) {
      seenOrderIdsRef.current = currentIds;
      orderSoundReadyRef.current = true;
      return;
    }

    const hasNewOrder = relevantOrders.some((order) => !seenOrderIdsRef.current.has(order.id));
    if (hasNewOrder) playOrderSound();

    seenOrderIdsRef.current = currentIds;
  }, [orders, profile, user]);

  function addToCart(product) {
    setCart((prev) => {
      const exists = prev.find((i) => i.id === product.id);
      if (exists) return prev.map((i) => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...product, quantity: 1 }];
    });
    setShowCart(true);
  }
  function removeFromCart(id) { setCart((prev) => prev.filter((i) => i.id !== id)); }
  function updateQty(id, qty) {
    if (qty < 1) { removeFromCart(id); return; }
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: qty } : i));
  }
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const unreadNotif = notifications.filter((n) => !n.isRead).length;
  const unreadChat = notifications.filter(n => !n.isRead && n.type === "chat_message").length;
  const activeProducts = products.filter((p) => p.status === "active" && !p.isDeleted);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: "#999", fontSize: 14 }}>Memuat aplikasi...</p>
      </div>
    );
  }

  function navGoTo(p) {
    if (["chat", "notif", "sellerStore"].includes(p)) {
      setPage(p);
      setShowCart(false);
      setSelectedProduct(null);
      scrollToTopSmooth();
      return;
    }
    try {
      sessionStorage.setItem("umkm_pending_page", p);
      window.location.reload();
      return;
    } catch (error) {
      setPage(p);
      setShowCart(false);
      setSelectedProduct(null);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {user && (
        <PushNotificationBanner
          status={pushStatus}
          busy={pushBusy}
          error={pushError}
          enabled={isPushSessionEnabled() && pushStatus === "granted"}
          onEnable={enablePushNotifications}
        />
      )}
      {/* ── DESKTOP NAVBAR ── */}
      <div className="nav-sticky nav-desktop">
        <div style={{ background: "var(--orange)" }}>
          <div className="nav-inner">
            <div className="nav-logo" onClick={() => navGoTo("home")}>UMKM<span>Digital</span></div>
            <div className="nav-search">
              <input placeholder="Cari produk, toko..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") navGoTo("home"); }} />
              <button onClick={() => navGoTo("home")}>🔍</button>
            </div>
            <div className="nav-actions">
              {user && (
                <button className="nav-icon-btn" onClick={() => setShowCart(!showCart)}>
                  🛒{cartCount > 0 && <span className="badge-count">{cartCount}</span>}
                </button>
              )}
              {user && (
                <button className="nav-icon-btn" onClick={() => navGoTo("notif")}>
                  🔔{unreadNotif > 0 && <span className="badge-count">{unreadNotif}</span>}
                </button>
              )}
              {user && (
                <button className="nav-icon-btn" onClick={() => navGoTo("chat")} title="Chat">
                  💬{unreadChat > 0 && <span className="badge-count">{unreadChat}</span>}
                </button>
              )}
              {!user ? (
                <>
                  <button className="nav-btn" onClick={() => navGoTo("login")}>Masuk</button>
                  <button className="nav-btn" style={{ background: "rgba(255,255,255,0.2)" }} onClick={() => navGoTo("register")}>Daftar</button>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {profile?.role === "buyer" && <button className="nav-btn" onClick={() => navGoTo("buyer")}>Dashboard</button>}
                  {profile?.role === "seller" && <button className="nav-btn" onClick={() => navGoTo("seller")}>Toko Saya</button>}
                  {(profile?.role === "admin" || profile?.role === "sub_admin") && <button className="nav-btn" onClick={() => navGoTo("admin")}>Admin Panel</button>}
                  <button className="nav-user-btn" onClick={logoutAndClearSession}>
                    <div className="nav-avatar">{profile?.name?.[0]?.toUpperCase() || "U"}</div>
                    <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile?.name || "User"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── MOBILE NAVBAR ── */}
      <div className="nav-sticky nav-mobile">
        <div className="nav-mobile-top">
          <span className="nav-mobile-logo" onClick={() => navGoTo("home")}>UMKM<span style={{ opacity: 0.8 }}>Digital</span></span>
          <div className="nav-mobile-icons">
            {user && (
              <button className="nav-icon-btn" onClick={() => setShowCart(!showCart)} style={{ fontSize: 20, padding: "4px 6px" }}>
                🛒{cartCount > 0 && <span className="badge-count">{cartCount}</span>}
              </button>
            )}
            {user && (
              <button className="nav-icon-btn" onClick={() => navGoTo("notif")} style={{ fontSize: 20, padding: "4px 6px" }}>
                🔔{unreadNotif > 0 && <span className="badge-count">{unreadNotif}</span>}
              </button>
            )}
            {!user && (
              <button onClick={() => navGoTo("login")} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", padding: "7px 14px", borderRadius: 6, fontWeight: 600, fontSize: 13 }}>Masuk</button>
            )}
          </div>
        </div>
        <div className="nav-mobile-bottom">
          <div className="nav-search" style={{ flex: 1 }}>
            <input placeholder="Cari produk, toko..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") navGoTo("home"); }} />
            <button onClick={() => navGoTo("home")}>🔍</button>
          </div>
        </div>
      </div>

      {/* CART DRAWER */}
      {showCart && (
        <>
          <div className="overlay-backdrop" onClick={() => setShowCart(false)} />
          <div className="cart-drawer">
            <div className="cart-drawer-header">
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>🛒 Keranjang ({cartCount})</h3>
              <button onClick={() => setShowCart(false)} style={{ background: "none", border: "none", fontSize: 20, color: "#999", cursor: "pointer" }}>✕</button>
            </div>
            <div className="cart-drawer-body">
              {cart.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🛒</div>
                  <p>Keranjang masih kosong</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="cart-item">
                    <img src={item.imageUrl} alt={item.productName} style={{ width: 72, height: 72, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.productName}</div>
                      <div style={{ color: "var(--orange)", fontWeight: 700, fontSize: 14 }}>{rupiah(item.price)}</div>
                      <div className="qty-control">
                        <button onClick={() => updateQty(item.id, item.quantity - 1)}>−</button>
                        <span style={{ minWidth: 24, textAlign: "center", fontSize: 14, fontWeight: 600 }}>{item.quantity}</span>
                        <button onClick={() => updateQty(item.id, item.quantity + 1)}>+</button>
                        <button onClick={() => removeFromCart(item.id)} style={{ marginLeft: 8, background: "none", border: "none", color: "#EF4444", fontSize: 13, cursor: "pointer" }}>Hapus</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {cart.length > 0 && (
              <div className="cart-drawer-footer">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 14, color: "var(--text2)" }}>Total</span>
                  <span style={{ fontWeight: 700, color: "var(--orange)", fontSize: 16 }}>{rupiah(cartTotal)}</span>
                </div>
                <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: 12 }}
                  onClick={() => { setShowCart(false); setShowCheckout(true); }}>
                  Checkout Sekarang
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* CHECKOUT MODAL */}
      {showCheckout && (
        <CheckoutModal
          cart={cart}
          user={user}
          profile={profile}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => { setCart([]); setShowCheckout(false); scrollToTopSmooth(); navGoTo("buyer"); }}
          createNotif={createNotif}
        />
      )}

      {/* PRODUCT DETAIL MODAL */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          reviews={reviews.filter((r) => r.productId === selectedProduct.id)}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={(p) => { addToCart(p); setSelectedProduct(null); }}
          user={user}
          profile={profile}
          onSellerClick={(sellerId) => { setSelectedSellerId(sellerId); setSelectedProduct(null); navGoTo("sellerStore"); }}
        />
      )}

      {/* PAGES */}
      {page === "home" && (
        <HomePage
          products={activeProducts}
          search={search}
          onProductClick={setSelectedProduct}
          onAddToCart={addToCart}
          user={user}
          profile={profile}
          setPage={navGoTo}
        />
      )}
      {page === "sellerStore" && (
        <SellerStorePage
          sellerId={selectedSellerId}
          products={activeProducts}
          onProductClick={setSelectedProduct}
          onAddToCart={addToCart}
          user={user}
          setPage={navGoTo}
        />
      )}
      {page === "login" && <LoginPage setPage={navGoTo} />}
      {page === "register" && <RegisterPage setPage={navGoTo} createNotif={createNotif} />}
      {page === "buyer" && profile?.role === "buyer" && (
        <BuyerDashboard user={user} profile={profile} orders={sortOrdersByStage(orders.filter((o) => o.buyerId === user.uid))}
          products={activeProducts} paymentSetting={paymentSetting} createNotif={createNotif}
          onAddToCart={addToCart} onProductClick={setSelectedProduct} setPage={navGoTo}
          onLogout={logoutAndClearSession} />
      )}
      {page === "seller" && profile?.role === "seller" && (
        <SellerDashboard user={user} profile={profile}
          products={products.filter((p) => p.sellerId === user.uid)}
          orders={sortOrdersByStage(orders.filter((o) => {
            const sellerProductIds = new Set(products.filter((p) => p.sellerId === user.uid).map((p) => p.id));
            return o.sellerId === user.uid || sellerProductIds.has(o.productId);
          }))}
          wallets={wallets} commissionBills={commissionBills} paymentSetting={paymentSetting} commissionSetting={commissionSetting} chatUnread={unreadChat} createNotif={createNotif}
          onLogout={logoutAndClearSession} />
      )}
      {page === "admin" && (profile?.role === "admin" || profile?.role === "sub_admin") && (
        <AdminDashboard user={user} profile={profile} products={products} orders={sortOrdersByStage(orders)} withdrawals={withdrawals}
          paymentSetting={paymentSetting} manualBalance={manualBalance} commissionSetting={commissionSetting} wallets={wallets} commissionBills={commissionBills} users={allUsers} createNotif={createNotif}
          onLogout={logoutAndClearSession} />
      )}
      {page === "notif" && user && (
        <NotificationPage notifications={notifications} />
      )}
      {page === "chat" && user && (
        <ChatCenter user={user} profile={profile} createNotif={createNotif} />
      )}

      {/* FOOTER — hidden on mobile */}
      <footer style={{ background: "#222", color: "#aaa", padding: "32px 16px", marginTop: 40 }} className="footer-desktop">
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 32, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", marginBottom: 12 }}>UMKM<span style={{ color: "var(--orange)" }}>Digital</span></div>
              <p style={{ fontSize: 13, lineHeight: 1.7 }}>Marketplace digital untuk UMKM lokal di sekitar anda. Produk lokal berkualitas, pembayaran aman.</p>
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, marginBottom: 12 }}>Layanan Pelanggan</div>
              <p style={{ fontSize: 13, marginBottom: 6 }}>📧 {complaintEmail}</p>
              <p style={{ fontSize: 13 }}>Senin – Sabtu, 08.00 – 17.00 WIB</p>
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, marginBottom: 12 }}>Tentang</div>
              <p style={{ fontSize: 13, marginBottom: 6, cursor: "pointer" }}>Tentang Kami</p>
              <p style={{ fontSize: 13, marginBottom: 6, cursor: "pointer" }}>Kebijakan Privasi</p>
              <p style={{ fontSize: 13, cursor: "pointer" }}>Syarat & Ketentuan</p>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #333", paddingTop: 20, textAlign: "center", fontSize: 12 }}>
            © 2025 UMKM Digital di sekitar anda. Hak cipta dilindungi.
          </div>
        </div>
      </footer>

      {/* ── BOTTOM NAVIGATION (mobile only) ── */}
      <nav className="bottom-nav">
        <button className={`bottom-nav-item ${page === "home" ? "active" : ""}`} onClick={() => navGoTo("home")}>
          <span className="nav-icon">🏠</span>
          <span>Beranda</span>
        </button>
        <button className={`bottom-nav-item ${page === "home" && false ? "active" : ""}`}
          onClick={() => { navGoTo("home"); }}>
          <span className="nav-icon">🏪</span>
          <span>Kategori</span>
        </button>
        {user ? (
          <button className="bottom-nav-item" onClick={() => setShowCart(true)} style={{ position: "relative" }}>
            <span className="nav-icon">🛒</span>
            {cartCount > 0 && <span className="nav-badge">{cartCount}</span>}
            <span>Keranjang</span>
          </button>
        ) : (
          <button className={`bottom-nav-item ${page === "register" ? "active" : ""}`} onClick={() => navGoTo("register")}>
            <span className="nav-icon">📝</span>
            <span>Daftar</span>
          </button>
        )}
        {user ? (
          <button className={`bottom-nav-item ${page === "chat" ? "active" : ""}`} onClick={() => navGoTo("chat")} style={{ position: "relative" }}>
            <span className="nav-icon">💬</span>
            {unreadChat > 0 && <span className="nav-badge">{unreadChat}</span>}
            <span>Chat</span>
          </button>
        ) : (
          <button className={`bottom-nav-item ${page === "login" ? "active" : ""}`} onClick={() => navGoTo("login")}>
            <span className="nav-icon">🔔</span>
            <span>Notifikasi</span>
          </button>
        )}
        <button className={`bottom-nav-item ${["buyer","seller","admin","login"].includes(page) ? "active" : ""}`}
          onClick={() => {
            if (!user) navGoTo("login");
            else if (profile?.role === "buyer") navGoTo("buyer");
            else if (profile?.role === "seller") navGoTo("seller");
            else navGoTo("admin");
          }}>
          <span className="nav-icon">👤</span>
          <span>{user ? "Akun" : "Masuk"}</span>
        </button>
      </nav>
    </div>
  );
}

function PushNotificationBanner({ status, busy, error, enabled, onEnable }) {
  if (enabled) return null;
  const blocked = status === "denied";
  const unsupported = status === "unsupported";

  return (
    <div className="push-notification-banner">
      <div className="push-notification-inner">
        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
          <div className="push-notification-icon">🔔</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Aktifkan Notifikasi Real-time</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.82)", lineHeight: 1.45 }}>
              {unsupported
                ? "Browser ini belum mendukung notifikasi web."
                : blocked
                  ? "Izin notifikasi sedang diblokir. Aktifkan dari pengaturan browser."
                  : "Klik sekali agar suara dan push notification tetap aktif setelah refresh sampai logout."}
            </div>
            {error && <div style={{ fontSize: 11, color: "#FDE68A", marginTop: 4 }}>{error}</div>}
          </div>
        </div>
        {!unsupported && !blocked && (
          <button className="push-notification-btn" onClick={onEnable} disabled={busy}>
            {busy ? "Mengaktifkan..." : "Aktifkan"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── HOME PAGE ─────────────────────────────── */
function HomePage({ products, search, onProductClick, onAddToCart, user, profile, setPage }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeSubCategory, setActiveSubCategory] = useState("all");
  const [sortBy, setSortBy] = useState("terbaru");

  let filtered = products;
  if (search) filtered = filtered.filter((p) => p.productName?.toLowerCase().includes(search.toLowerCase()) || p.category?.toLowerCase().includes(search.toLowerCase()));
  if (activeCategory !== "all") filtered = filtered.filter((p) => p.category === activeCategory);
  if (activeSubCategory !== "all") filtered = filtered.filter((p) => p.subCategory === activeSubCategory);
  if (sortBy === "termurah") filtered = [...filtered].sort((a, b) => a.price - b.price);
  if (sortBy === "termahal") filtered = [...filtered].sort((a, b) => b.price - a.price);
  if (sortBy === "terlaris") filtered = [...filtered].sort((a, b) => productSoldCount(b) - productSoldCount(a));

  return (
    <div className="page-container">
      {/* HERO */}
      <div className="hero-banner">
        <div className="hero-pattern" />
        <div className="hero-pattern2">🛍️</div>
        <h1>Belanja Produk UMKM<br />Lokal Berkualitas</h1>
        <p>Temukan ribuan produk UMKM terbaik di sekitar anda. Dukung pengusaha lokal, belanja lebih hemat!</p>
        <div className="hero-cta" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {!user ? (
            <>
              <button className="btn-primary" style={{ background: "#fff", color: "var(--orange)", padding: "12px 24px", fontSize: 15 }} onClick={() => setPage("register")}>Mulai Belanja</button>
              <button className="btn-outline" style={{ border: "2px solid rgba(255,255,255,0.8)", color: "#fff", padding: "12px 24px", fontSize: 15 }} onClick={() => setPage("login")}>Masuk</button>
            </>
          ) : (
            <button className="btn-primary" style={{ background: "#fff", color: "var(--orange)", padding: "12px 24px", fontSize: 15 }} onClick={() => setPage(profile?.role === "buyer" ? "buyer" : profile?.role === "seller" ? "seller" : "admin")}>
              Dashboard Saya →
            </button>
          )}
        </div>
      </div>

      {/* CATEGORIES */}
      <div style={{ marginBottom: 24 }}>
        <div className="section-title">Kategori</div>
        <div className="category-grid">
          {CATEGORIES.map((c) => (
            <div key={c.id} className={`cat-item ${activeCategory === c.id ? "active" : ""}`} onClick={() => { setActiveCategory(c.id); setActiveSubCategory("all"); }}>
              <span className="cat-icon">{c.icon}</span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
        {activeCategory !== "all" && CATEGORY_GROUPS[activeCategory] && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button
              onClick={() => setActiveSubCategory("all")}
              style={{ padding: "7px 14px", borderRadius: 100, border: "1.5px solid", cursor: "pointer", fontWeight: 600, fontSize: 12,
                borderColor: activeSubCategory === "all" ? "var(--orange)" : "var(--border)",
                background: activeSubCategory === "all" ? "var(--orange-light)" : "#fff",
                color: activeSubCategory === "all" ? "var(--orange)" : "var(--text2)" }}
            >
              Semua {activeCategory}
            </button>
            {CATEGORY_GROUPS[activeCategory].map((sub) => (
              <button
                key={sub}
                onClick={() => setActiveSubCategory(sub)}
                style={{ padding: "7px 14px", borderRadius: 100, border: "1.5px solid", cursor: "pointer", fontWeight: 600, fontSize: 12,
                  borderColor: activeSubCategory === sub ? "var(--orange)" : "var(--border)",
                  background: activeSubCategory === sub ? "var(--orange-light)" : "#fff",
                  color: activeSubCategory === sub ? "var(--orange)" : "var(--text2)" }}
              >
                {sub}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PRODUCTS */}
      <div>
        <div className="sort-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {activeCategory === "all" ? "Semua Produk" : activeSubCategory !== "all" ? activeSubCategory : activeCategory}
            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text3)", marginLeft: 8 }}>({filtered.length} produk)</span>
          </div>
          <div className="sort-buttons" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text3)", flexShrink: 0 }}>Urutkan:</span>
            {["terbaru","termurah","termahal","terlaris"].map((s) => (
              <button key={s} onClick={() => setSortBy(s)}
                style={{ padding: "5px 12px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer", fontWeight: 500, flexShrink: 0,
                  borderColor: sortBy === s ? "var(--orange)" : "var(--border)",
                  background: sortBy === s ? "var(--orange-light)" : "#fff",
                  color: sortBy === s ? "var(--orange)" : "var(--text2)" }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <p>Tidak ada produk ditemukan</p>
          </div>
        ) : (
          <div className="grid-5">
            {filtered.map((p) => (
              <ProductCard key={p.id} product={p} onClick={() => onProductClick(p)} onAddToCart={() => onAddToCart(p)} user={user} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function SellerStorePage({ sellerId, products, onProductClick, onAddToCart, user, setPage }) {
  const sellerProducts = products.filter((p) => p.sellerId === sellerId && !p.isDeleted);
  const sellerName = sellerProducts[0]?.sellerName || "Toko Seller";
  const totalSold = sellerProducts.reduce((sum, p) => sum + productSoldCount(p), 0);
  const totalStock = sellerProducts.reduce((sum, p) => sum + getStock(p), 0);

  return (
    <div className="page-container">
      <button className="btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={() => setPage("home")}>← Kembali ke Beranda</button>
      <div className="card" style={{ marginBottom: 20, background: "linear-gradient(135deg, #fff, #FFF7ED)" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: "var(--orange-light)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🏪</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{sellerName}</div>
            <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 4 }}>{sellerProducts.length} produk aktif · {totalSold} terjual · stok tersedia {totalStock}</div>
          </div>
        </div>
      </div>
      <div className="section-title">Produk dari {sellerName}</div>
      {sellerProducts.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🏪</div><p>Produk seller belum tersedia</p></div>
      ) : (
        <div className="grid-5">
          {sellerProducts.map((p) => <ProductCard key={p.id} product={p} onClick={() => onProductClick(p)} onAddToCart={() => onAddToCart(p)} user={user} />)}
        </div>
      )}
    </div>
  );
}

function ProductCard({ product, onClick, onAddToCart, user }) {
  return (
    <div className="product-card" onClick={onClick}>
      <img src={product.imageUrl || "https://via.placeholder.com/200x200?text=No+Image"} alt={product.productName} className="product-img" />
      <div className="product-info">
        <div className="product-name">{product.productName}</div>
        <div className="product-price">{rupiah(product.price)}</div>
        <div className="product-meta">
          <span>⭐ {(product.averageRating || 0).toFixed(1)}</span>
          <span>·</span>
          <span>{productSoldCount(product)} terjual</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: isOutOfStock(product) ? "#EF4444" : "#10B981", marginTop: 4 }}>
          {isOutOfStock(product) ? "Stok habis" : `Stok ${getStock(product)}`}
        </div>
        {user && (
          <button className="add-cart-btn" disabled={isOutOfStock(product)} onClick={(e) => { e.stopPropagation(); if (isOutOfStock(product)) return; onAddToCart(); }}>
            {isOutOfStock(product) ? "Stok Habis" : "+ Keranjang"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProductDetailModal({ product, reviews = [], onClose, onAddToCart, user, profile, onSellerClick }) {
  const [qty, setQty] = useState(1);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontWeight: 700 }}>Detail Produk</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <img src={product.imageUrl || "https://via.placeholder.com/240x240?text=No+Image"} alt={product.productName}
              style={{ width: 240, height: 240, objectFit: "cover", borderRadius: 12, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{product.productName}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--orange)", marginBottom: 12 }}>{rupiah(product.price)}</div>
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>⭐ {(product.averageRating || 0).toFixed(1)}</span>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>| {productSoldCount(product)} terjual</span>
                <span className={`badge ${statusLabel(product.status).cls}`}>{statusLabel(product.status).label}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}><b>Kategori:</b> {product.category}{product.subCategory ? ` / ${product.subCategory}` : ""}</div>
              <div style={{ fontSize: 13, color: getStock(product) > 0 ? "var(--text2)" : "#EF4444", marginBottom: 4 }}><b>Stok:</b> {getStock(product)} {getStock(product) <= 0 ? "(Habis)" : "tersedia"}</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}><b>Penjual:</b> <button type="button" className="link-button" onClick={() => product.sellerId && onSellerClick?.(product.sellerId)}>{product.sellerName || "Toko Seller"}</button></div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}><b>Berat:</b> {product.weightGram}g</div>
              {product.description && <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>{product.description}</div>}
              {reviews.length > 0 && (
                <div style={{ marginBottom: 16, padding: 12, background: "var(--bg)", borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Ulasan Pembeli</div>
                  {reviews.slice(0, 3).map((r) => (
                    <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>⭐ {Number(r.rating || 0).toFixed(1)} · {r.buyerName || "Pembeli"}</div>
                      {r.comment && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4, lineHeight: 1.5 }}>{r.comment}</div>}
                    </div>
                  ))}
                </div>
              )}
              {user && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="qty-control">
                    <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
                    <span style={{ minWidth: 32, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                    <button onClick={() => setQty(qty + 1)}>+</button>
                  </div>
                  <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={isOutOfStock(product) || qty > getStock(product)}
                    onClick={() => { if (isOutOfStock(product) || qty > getStock(product)) return alert("Stok produk tidak mencukupi."); for (let i = 0; i < qty; i++) onAddToCart(product); }}>
                    {isOutOfStock(product) ? "Stok Habis" : "🛒 Tambah ke Keranjang"}
                  </button>
                  {profile?.role === "buyer" && product.sellerId && product.sellerId !== user?.uid && (
                    <button className="btn-outline" style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => startChatWithSeller(product, user, profile)}>
                      💬 Chat Seller
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── AUTH PAGES ────────────────────────────── */
function LoginPage({ setPage }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setPage("home");
    } catch (err) {
      setError("Email atau password salah. Silakan coba lagi.");
    }
    setLoading(false);
  }

  async function resetPassword() {
    if (!email) { setError("Masukkan email terlebih dahulu"); return; }
    await sendPasswordResetEmail(auth, email);
    alert("Link reset password telah dikirim ke email Anda");
  }

  return (
    <div className="auth-container" style={{ minHeight: "calc(100vh - 110px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="card form-card-mobile" style={{ padding: 36 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--orange)", marginBottom: 6 }}>UMKM Digital</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Masuk ke Akun Anda</div>
            <p style={{ fontSize: 13, color: "var(--text3)" }}>Masuk untuk mulai berbelanja</p>
          </div>
          {error && <div style={{ background: "#FEE8E8", color: "#EF4444", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <form onSubmit={login} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" type="email" placeholder="contoh@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-input" type="password" placeholder="Masukkan password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: 13, fontSize: 15 }} disabled={loading}>
              {loading ? "Memproses..." : "Masuk"}
            </button>
          </form>
          <button onClick={resetPassword} style={{ background: "none", border: "none", color: "var(--orange)", fontSize: 13, cursor: "pointer", marginTop: 12, display: "block", textAlign: "center", width: "100%" }}>
            Lupa password?
          </button>
          <div className="divider" />
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text2)" }}>
            Belum punya akun?{" "}
            <span style={{ color: "var(--orange)", fontWeight: 600, cursor: "pointer" }} onClick={() => setPage("register")}>Daftar sekarang</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function RegisterPage({ setPage, createNotif }) {
  const [form, setForm] = useState({
    name: "",
    whatsapp: "",
    village: "",
    district: "",
    regency: "",
    detailAddress: "",
    email: "",
    password: "",
    role: "buyer",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function register(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const fullAddress = [form.detailAddress, form.village, form.district, form.regency].filter(Boolean).join(", ");
      const savedShippingAddress = {
        buyerAddress: form.detailAddress || "",
        buyerVillage: form.village || "",
        buyerDistrict: form.district || "",
        buyerRegency: form.regency || "",
        buyerFullAddress: fullAddress,
        updatedAt: new Date().toISOString(),
      };
      const res = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, "users", res.user.uid), {
        uid: res.user.uid,
        name: form.name,
        email: form.email,
        role: form.role,
        whatsapp: form.whatsapp,
        village: form.village,
        district: form.district,
        regency: form.regency,
        detailAddress: form.detailAddress,
        fullAddress,
        savedShippingAddress,
        status: form.role === "seller" ? "pending" : "active",
        createdAt: serverTimestamp(),
      });
      try { localStorage.setItem(`umkm_last_shipping_address_${res.user.uid}`, JSON.stringify(savedShippingAddress)); } catch {}
      if (form.role === "seller") {
        await setDoc(doc(db, "seller_wallets", res.user.uid), {
          sellerId: res.user.uid, sellerName: form.name, saldoTersedia: 0, saldoTertahan: 0, totalPenjualan: 0, totalDitarik: 0,
        });
        await createNotif({ role: "admin", type: "seller_register", title: "Pendaftaran Seller Baru", message: `${form.name} mendaftar sebagai seller baru. Menunggu persetujuan.` });
      } else {
        await createNotif({ role: "admin", type: "user_register", title: "Pengguna Baru Mendaftar", message: `${form.name} baru saja membuat akun sebagai pembeli.` });
      }
      setPage("home");
    } catch (err) {
      setError(err.message || "Gagal membuat akun. Coba lagi.");
    }
    setLoading(false);
  }

  return (
    <div className="auth-container" style={{ minHeight: "calc(100vh - 110px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div className="card form-card-mobile" style={{ padding: 36 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--orange)", marginBottom: 6 }}>UMKM Digital</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Buat Akun Baru</div>
            <p style={{ fontSize: 13, color: "var(--text3)" }}>Bergabung dan mulai berbelanja atau berjualan</p>
          </div>
          {error && <div style={{ background: "#FEE8E8", color: "#EF4444", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <form onSubmit={register} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="form-group"><label>Nama Lengkap</label><input className="form-input" placeholder="Nama lengkap Anda" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="form-group"><label>Nomor WhatsApp</label><input className="form-input" placeholder="08xxxxxxxxxx" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} required /></div>
            <div className="form-group"><label>Desa</label><input className="form-input" placeholder="Nama desa/kelurahan" value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} required /></div>
            <div className="form-group"><label>Kecamatan</label><input className="form-input" placeholder="Nama kecamatan" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} required /></div>
            <div className="form-group"><label>Kabupaten</label><input className="form-input" placeholder="Nama kabupaten/kota" value={form.regency} onChange={(e) => setForm({ ...form, regency: e.target.value })} required /></div>
            <div className="form-group"><label>Detail Alamat</label><textarea className="form-input" rows={2} placeholder="Kampung/Jalan/RT/RW/patokan" value={form.detailAddress} onChange={(e) => setForm({ ...form, detailAddress: e.target.value })} required /></div>
            <div className="form-group"><label>Email</label><input className="form-input" type="email" placeholder="contoh@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            <div className="form-group"><label>Password</label><div style={{ position: "relative" }}><input className="form-input" type={showPassword ? "text" : "password"} placeholder="Minimal 6 karakter" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required style={{ paddingRight: 44 }} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Sembunyikan kata sandi" : "Lihat kata sandi"} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 18 }}>{showPassword ? "🙈" : "👁️"}</button></div></div>
            <div className="form-group">
              <label>Daftar sebagai</label>
              <select className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="buyer">Pembeli</option>
                <option value="seller">Penjual (Seller)</option>
              </select>
            </div>
            {form.role === "seller" && <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E" }}>⏳ Akun seller harus disetujui admin dulu sebelum bisa upload produk.</div>}
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: 13, fontSize: 15 }} disabled={loading}>{loading ? "Memproses..." : "Daftar Sekarang"}</button>
          </form>
          <div className="divider" />
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text2)" }}>Sudah punya akun? <span style={{ color: "var(--orange)", fontWeight: 600, cursor: "pointer" }} onClick={() => setPage("login")}>Masuk</span></p>
        </div>
      </div>
    </div>
  );
}

function CheckoutModal({ cart, user, profile, onClose, onSuccess, createNotif }) {
  const savedAddress = (() => {
    try {
      const local = localStorage.getItem(`umkm_last_shipping_address_${user?.uid}`);
      return local ? JSON.parse(local) : (profile?.savedShippingAddress || {});
    } catch {
      return profile?.savedShippingAddress || {};
    }
  })();
  const [form, setForm] = useState({
    buyerName: profile?.name || "",
    buyerWhatsapp: profile?.whatsapp || "",
    buyerAddress: savedAddress.buyerAddress || savedAddress.buyerFullAddress || profile?.detailAddress || profile?.fullAddress || "",
    shippingType: "pickup",
    paymentMethod: "transfer",
    buyerMapsLink: savedAddress.buyerMapsLink || "",
    buyerVillage: savedAddress.buyerVillage || profile?.village || "",
    buyerDistrict: savedAddress.buyerDistrict || profile?.district || "",
    buyerRegency: savedAddress.buyerRegency || profile?.regency || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shippingCheckRequested, setShippingCheckRequested] = useState(false);
  const cartTotal = cart.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0);
  const needsSellerQuote = ["same_day", "jne", "pos", "tiki", "jnt", "sicepat"].includes(form.shippingType);
  const needsAddress = ["jne", "pos", "tiki", "jnt", "sicepat"].includes(form.shippingType);

  async function handleCheckout(e) {
    e.preventDefault(); setLoading(true); setError("");
    try {
      if (form.shippingType === "same_day" && !form.buyerMapsLink.trim()) throw new Error("Kirimkan link Google Maps Anda untuk Same Day.");
      if (needsAddress && (!form.buyerVillage || !form.buyerDistrict || !form.buyerRegency)) throw new Error("Desa, kecamatan, dan kabupaten wajib diisi untuk ekspedisi.");
      if (needsSellerQuote && !shippingCheckRequested) throw new Error("Klik tombol Cek Ongkir dulu agar seller menerima perintah cek ongkir.");

      const addressToSave = {
        buyerAddress: form.buyerAddress || "",
        buyerMapsLink: form.buyerMapsLink || "",
        buyerVillage: form.buyerVillage || "",
        buyerDistrict: form.buyerDistrict || "",
        buyerRegency: form.buyerRegency || "",
        updatedAt: new Date().toISOString(),
      };
      if (needsAddress || form.shippingType === "same_day") {
        try {
          localStorage.setItem(`umkm_last_shipping_address_${user.uid}`, JSON.stringify(addressToSave));
        } catch (error) {
          console.error("Gagal menyimpan alamat ke localStorage:", error);
        }
        try {
          await setDoc(doc(db, "users", user.uid), { savedShippingAddress: addressToSave }, { merge: true });
        } catch (error) {
          console.error("Gagal menyimpan alamat otomatis:", error);
        }
      }

      let createdCount = 0;
      const createdOrders = [];

      for (const rawItem of cart) {
        const item = await resolveCheckoutProduct(rawItem);
        const safeSellerId = String(item.sellerId || item.uid || item.ownerId || "");
        const safeProductId = String(item.id || item.productId || "");
        const safeProductName = String(item.productName || item.name || "Produk");
        const safeProductImage = String(item.imageUrl || item.productImage || "");
        const safeQuantity = Math.max(1, Number(rawItem.quantity || item.quantity || 1));
        const safePrice = Number(item.price || 0);

        if (!user?.uid) throw new Error("Sesi login tidak valid. Silakan login ulang.");
        if (!safeProductId) throw new Error("Data produk tidak lengkap. Hapus produk dari keranjang lalu masukkan produk lagi.");
        if (!safeSellerId) throw new Error("Data seller produk tidak lengkap. Coba hapus dari keranjang lalu tambah ulang produk. Kalau masih gagal, seller harus upload ulang produk.");
        if (!safePrice || safePrice <= 0) throw new Error("Harga produk tidak valid. Hubungi seller.");
        const productRef = doc(db, "products", safeProductId);
        const latestProductSnap = await getDoc(productRef);
        const latestStock = latestProductSnap.exists() ? getStock(latestProductSnap.data()) : getStock(item);
        if (latestStock <= 0) throw new Error(`${safeProductName} sedang habis.`);
        if (safeQuantity > latestStock) throw new Error(`Stok ${safeProductName} hanya tersisa ${latestStock}. Kurangi jumlah di keranjang.`);

        const productTotal = safePrice * safeQuantity;
        const adminFee = calcCommission(productTotal, item.commissionType, item.commissionValue);
        const effectivePaymentMethod = form.shippingType === "pickup" ? "cash" : String(form.paymentMethod || "transfer");
        let shippingCost = 0, distanceKm = 0, courierName = "Ambil di Tempat", courierService = "Gratis", statusPembayaran = "menunggu_pembayaran", statusPesanan = "menunggu_pembayaran";
        if (form.shippingType === "pickup") { statusPembayaran = "tunai"; statusPesanan = "pesanan_masuk"; }
        if (form.shippingType === "same_day") { courierName = "Same Day Lokal"; courierService = "Penjual sedang menghitung ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        if (needsAddress) { courierName = form.shippingType.toUpperCase(); courierService = "Penjual sedang cek ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        const totalAmount = productTotal + shippingCost;
        const sellerAmount = productTotal - adminFee + shippingCost;

        const orderPayload = {
          buyerId: user.uid,
          sellerId: safeSellerId,
          sellerName: String(item.sellerName || ""),
          productId: safeProductId,
          productName: safeProductName,
          productImage: safeProductImage,
          buyerName: String(form.buyerName || profile?.name || ""),
          buyerWhatsapp: String(form.buyerWhatsapp || profile?.whatsapp || ""),
          buyerAddress: String(form.buyerAddress || ""),
          buyerMapsLink: String(form.buyerMapsLink || ""),
          buyerVillage: String(form.buyerVillage || ""),
          buyerDistrict: String(form.buyerDistrict || ""),
          buyerRegency: String(form.buyerRegency || ""),
          sellerMapLink: String(item.sellerMapLink || ""),
          sellerAddress: String(item.sellerAddress || ""),
          quantity: safeQuantity,
          productTotal,
          shippingType: String(form.shippingType || "pickup"),
          paymentMethod: effectivePaymentMethod,
          shippingCost,
          distanceKm,
          courierName,
          courierService,
          totalAmount,
          adminFee,
          sellerAmount,
          sellerReceivableAmount: isTransferPayment(effectivePaymentMethod) ? sellerAmount : 0,
          sellerProductAmount: Math.max(0, productTotal - adminFee),
          sellerShippingAmount: shippingCost,
          cashReceivedBySeller: isCashPayment(effectivePaymentMethod) ? totalAmount : 0,
          statusPembayaran,
          statusPesanan,
          proofSubmitted: false,
          reviewSubmitted: false,
          pendingShippingQuote: needsSellerQuote,
          showToSeller: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const ref = await addDoc(collection(db, "orders"), orderPayload);
        await updateDoc(productRef, { stock: increment(-safeQuantity), updatedAt: serverTimestamp() });
        createdCount += 1;
        createdOrders.push({ id: ref.id, ...orderPayload });

        // Komisi tunai diproses saat order selesai agar saldo seller bisa dipotong otomatis dulu.

        await createNotif({ role: "admin", type: "order_new", title: "Order Baru Masuk", message: `${form.buyerName} memesan ${safeProductName} senilai ${rupiah(totalAmount)}`, orderId: ref.id });
        await createNotif({ role: "seller", userId: safeSellerId, type: needsSellerQuote ? "shipping_quote_needed" : "order_new", title: needsSellerQuote ? "Cek Ongkir Pesanan" : "Ada Pesanan Baru! 🎉", message: needsSellerQuote ? `Pembeli memilih ${courierName}. Input ongkir untuk ${safeProductName}.` : `Pesanan baru: ${safeProductName} (${safeQuantity} pcs).`, orderId: ref.id });
        await createNotif({ role: "buyer", userId: user.uid, type: "order_placed", title: "Pesanan Berhasil Dibuat", message: needsSellerQuote ? `Pesanan ${safeProductName} dibuat. Penjual sedang menghitung ongkir.` : `Pesanan ${safeProductName} berhasil dibuat.`, orderId: ref.id });
      }

      if (createdCount <= 0) throw new Error("Pesanan belum berhasil dibuat. Coba lagi.");
      onSuccess();
    } catch (err) {
      console.error("Checkout gagal:", err);
      setError(err.message || "Checkout gagal. Coba lagi.");
      alert(err.message || "Checkout gagal. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}><div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal-header"><h3 style={{ fontWeight: 700 }}>Checkout ({cart.length} produk)</h3><button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>✕</button></div>
      <form onSubmit={handleCheckout}><div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div style={{ background: "#FEE8E8", color: "#EF4444", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
        <div style={{ background: "var(--bg)", borderRadius: 8, padding: 14 }}>{cart.map((item) => <div key={item.id} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}><img src={item.imageUrl} alt={item.productName} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover" }} /><div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{item.productName}</div><div style={{ fontSize: 12, color: "var(--text3)" }}>{rupiah(item.price)} × {item.quantity}</div></div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--orange)" }}>{rupiah(item.price * item.quantity)}</div></div>)}<div className="divider" /><div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>Total Produk</span><span style={{ color: "var(--orange)" }}>{rupiah(cartTotal)}</span></div></div>
        <div className="form-group"><label>Nama Penerima</label><input className="form-input" value={form.buyerName} onChange={(e) => setForm({ ...form, buyerName: e.target.value })} required /></div>
        <div className="form-group"><label>WhatsApp</label><input className="form-input" value={form.buyerWhatsapp} onChange={(e) => setForm({ ...form, buyerWhatsapp: e.target.value })} required /></div>
        <div className="form-group"><label>Alamat Lengkap</label><textarea className="form-input" rows={2} value={form.buyerAddress} onChange={(e) => setForm({ ...form, buyerAddress: e.target.value })} required /></div>
        <div className="form-group"><label>Metode Pengiriman</label><select className="form-input" value={form.shippingType} onChange={(e) => { const nextShipping = e.target.value; setForm({ ...form, shippingType: nextShipping, paymentMethod: nextShipping === "pickup" ? "cash" : (["transfer","qris","cash"].includes(form.paymentMethod) ? (nextShipping === "same_day" ? form.paymentMethod : (form.paymentMethod === "cash" ? "transfer" : form.paymentMethod)) : "transfer") }); setShippingCheckRequested(false); }}><option value="pickup">Ambil di Tempat (Gratis)</option><option value="same_day">Same Day Lokal</option><option value="jne">JNE</option><option value="pos">POS</option><option value="tiki">TIKI</option><option value="jnt">J&T</option><option value="sicepat">SiCepat</option></select></div>
        {form.shippingType === "pickup" && <div className="form-group"><label>Metode Pembayaran</label><div className="form-input" style={{ background: "#f8fafc", color: "var(--text2)" }}>Tunai saat ambil barang</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Tidak perlu upload bukti pembayaran. Setelah order, pembeli melihat link lokasi toko dan instruksi segera ambil pesanan.</div></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Metode Pembayaran Same Day</label><select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="transfer">Transfer Bank setelah ongkir keluar</option><option value="qris">Scan QRIS setelah ongkir keluar</option><option value="cash">Tunai saat barang diterima</option></select></div>}
        {form.shippingType !== "pickup" && form.shippingType !== "same_day" && <div className="form-group"><label>Metode Pembayaran</label><select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="transfer">Transfer Bank setelah ongkir keluar</option><option value="qris">Scan QRIS setelah ongkir keluar</option></select></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Link Google Maps Lokasi Anda</label><input className="form-input" placeholder="Tempel link Google Maps alamat pengiriman" value={form.buyerMapsLink} onChange={(e) => { setForm({ ...form, buyerMapsLink: e.target.value }); setShippingCheckRequested(false); }} required /><button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerMapsLink.trim()) { setError("Tempel link Google Maps Anda dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Penjual sedang menghitung ongkir. Klik Buat Pesanan untuk mengirim permintaan ke seller." : "Klik Cek Ongkir dulu. Setelah itu tombol Buat Pesanan aktif."}</div></div>}
        {needsAddress && <div style={{ background: "#FFF8E1", padding: 12, borderRadius: 8 }}><div style={{ fontWeight: 700, marginBottom: 8 }}>Alamat untuk cek ongkir</div><div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>Alamat ekspedisi akan otomatis disimpan ke profil dan terisi saat belanja berikutnya.</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}><input className="form-input" placeholder="Desa" value={form.buyerVillage} onChange={(e) => { setForm({ ...form, buyerVillage: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kecamatan" value={form.buyerDistrict} onChange={(e) => { setForm({ ...form, buyerDistrict: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kabupaten" value={form.buyerRegency} onChange={(e) => { setForm({ ...form, buyerRegency: e.target.value }); setShippingCheckRequested(false); }} required /></div><button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerVillage || !form.buyerDistrict || !form.buyerRegency) { setError("Isi desa, kecamatan, dan kabupaten dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Permintaan cek ongkir siap dikirim ke seller. Klik Buat Pesanan." : "Klik Cek Ongkir dulu agar seller mendapat perintah cek ongkir."}</div></div>}
      </div><div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Batal</button><button type="submit" className="btn-primary" disabled={loading || (needsSellerQuote && !shippingCheckRequested)}>{loading ? "Memproses..." : "Buat Pesanan"}</button></div></form>
    </div></div>
  );
}


/* ─── BUYER DASHBOARD ────────────────────────── */
function BuyerDashboard({ user, profile, orders, products, paymentSetting, createNotif, onAddToCart, onProductClick, setPage, onLogout }) {
  const [tab, setTab] = useState("beranda");
  const buyerActiveOrderCount = orders.filter((o) => !["selesai", "dibatalkan"].includes(o.statusPesanan)).length;
  const tabs = [
    { id: "beranda", label: "Beranda", icon: "🏠" },
    { id: "pesanan", label: "Pesanan Saya", icon: "📦" },
    { id: "profil", label: "Profil Saya", icon: "👤" },
  ];
  return (
    <div className="dash-layout">
      <div className="dash-sidebar">
        <div className="dash-sidebar-profile">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--orange-light)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>{profile?.name?.[0]?.toUpperCase()}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{profile?.name}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>Pembeli</div>
            </div>
          </div>
        </div>
        {tabs.map((t) => (
          <div key={t.id} className={`dash-sidebar-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span> {t.label}{t.id === "pesanan" && buyerActiveOrderCount > 0 && <span className="badge-count" style={{ position: "static", marginLeft: 6 }}>{buyerActiveOrderCount}</span>}
          </div>
        ))}
        <div className="dash-sidebar-item" onClick={() => setPage("home")}>
          <span>🛍️</span> Lanjut Belanja
        </div>
        <div className="dash-logout-btn-wrap" style={{ padding: "8px 12px", marginTop: "auto" }}>
          <button onClick={onLogout} style={{ width: "100%", padding: "10px 14px", background: "#FEF2F2", color: "#EF4444", border: "1px solid #FECACA", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            🚪 Keluar
          </button>
        </div>
      </div>
      <div className="dash-content">
        {tab === "beranda" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Selamat datang, {profile?.name}! 👋</div>
              <p style={{ color: "var(--text2)", fontSize: 13 }}>Temukan produk terbaik dari UMKM lokal.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 28 }}>
              {[
                { label: "Total Pesanan", value: orders.length, icon: "📦", color: "#EE4D2D" },
                { label: "Pesanan Aktif", value: orders.filter((o) => !["selesai","dibatalkan"].includes(o.statusPesanan)).length, icon: "🔄", color: "#26AA99" },
                { label: "Selesai", value: orders.filter((o) => o.statusPesanan === "selesai").length, icon: "✅", color: "#10B981" },
              ].map((s) => (
                <div key={s.label} className="stat-card">
                  <div className="stat-icon" style={{ background: s.color + "15" }}><span style={{ color: s.color }}>{s.icon}</span></div>
                  <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="section-title">Produk Pilihan</div>
              <div className="grid-5">
                {products.slice(0, 10).map((p) => (
                  <ProductCard key={p.id} product={p} onClick={() => onProductClick(p)} onAddToCart={() => onAddToCart(p)} user={true} />
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === "pesanan" && <BuyerOrders orders={orders} createNotif={createNotif} paymentSetting={paymentSetting} />}
        {tab === "profil" && <BuyerProfile profile={profile} />}
      </div>
    </div>
  );
}

function BuyerOrders({ orders, createNotif, paymentSetting }) {
  const [activeStatus, setActiveStatus] = useState("semua");
  const statusFilters = ["semua","menunggu_pembayaran","menunggu_verifikasi","pesanan_masuk","diproses","dikirim","selesai","dibatalkan"];
  const sortedOrders = sortNewest(orders);
  const filtered = activeStatus === "semua" ? sortedOrders : sortedOrders.filter((o) => o.statusPesanan === activeStatus);
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Pesanan Saya</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {statusFilters.map((s) => {
          const info = s === "semua" ? { label: "Semua", cls: "badge-gray" } : statusLabel(s);
          return (
            <button key={s} onClick={() => setActiveStatus(s)}
              style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer", fontWeight: 500,
                borderColor: activeStatus === s ? "var(--orange)" : "var(--border)",
                background: activeStatus === s ? "var(--orange-light)" : "#fff",
                color: activeStatus === s ? "var(--orange)" : "var(--text2)" }}>
              {info.label}{(s === "semua" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPesanan === s).length) > 0 ? ` (${s === "semua" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPesanan === s).length})` : ""}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📦</div><p>Tidak ada pesanan</p></div>
      ) : (
        filtered.map((o) => <BuyerOrderCard key={o.id} order={o} createNotif={createNotif} paymentSetting={paymentSetting} />)
      )}
    </div>
  );
}

function BuyerOrderCard({ order, createNotif, paymentSetting }) {
  const [file, setFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const s = statusLabel(order.statusPesanan);
  async function uploadProof() {
    if (uploadLoading) return;
    if (order.proofSubmitted || order.paymentProofUrl || order.statusPembayaran === "menunggu_verifikasi" || order.statusPembayaran === "sudah_dibayar") { alert("Bukti pembayaran sudah pernah dikirim"); return; }
    if (!file) { alert("Pilih bukti pembayaran dulu"); return; }
    setUploadLoading(true);
    try {
      const url = await uploadImageToCloudinary(file);
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, "orders", order.id);
        const freshOrder = await transaction.get(orderRef);
        const data = freshOrder.data() || {};
        if (data.proofSubmitted || data.paymentProofUrl || data.statusPembayaran === "menunggu_verifikasi" || data.statusPembayaran === "sudah_dibayar") {
          throw new Error("Bukti pembayaran sudah pernah dikirim");
        }
        transaction.update(orderRef, {
          paymentProofUrl: url,
          proofSubmitted: true,
          paymentProofUploadedAt: serverTimestamp(),
          statusPembayaran: "menunggu_verifikasi",
          updatedAt: serverTimestamp(),
        });
      });
      await createNotif({ role: "admin", type: "payment_proof", title: "Bukti Pembayaran Dikirim", message: `${order.buyerName} mengupload bukti pembayaran untuk ${order.productName}`, orderId: order.id });
      await createNotif({ role: "seller", userId: order.sellerId, type: "payment_proof", title: "Buyer Upload Bukti Bayar", message: `Pembeli sudah mengupload bukti pembayaran untuk ${order.productName}.`, orderId: order.id });
      alert("Bukti pembayaran berhasil dikirim");
    } catch (error) {
      alert(error?.message || "Gagal mengirim bukti pembayaran. Coba lagi.");
    } finally {
      setUploadLoading(false);
    }
  }
  async function received() {
    if (order.receivedAt) return;
    const qty = Number(order.quantity || 1);
    await completeOrderAndCreditSeller(order, {}, createNotif);
    await createNotif({ role: "seller", userId: order.sellerId, type: "order_done", title: "Pesanan Selesai ✅", message: `${order.buyerName} telah mengkonfirmasi penerimaan ${order.productName}.`, orderId: order.id });
    setShowReview(true);
  }
  async function sendReview() {
    if (order.reviewSubmitted || reviewBusy) { alert("Ulasan sudah dikirim"); return; }
    setReviewBusy(true);
    try {
      await addDoc(collection(db, "reviews"), { orderId: order.id, productId: order.productId, sellerId: order.sellerId, buyerId: order.buyerId, buyerName: order.buyerName, rating: Number(rating), comment, createdAt: serverTimestamp() });
      await recomputeProductRating(order.productId);
      await updateDoc(doc(db, "orders", order.id), { reviewSubmitted: true, updatedAt: serverTimestamp() });
      await createNotif({ role: "seller", userId: order.sellerId, type: "review_new", title: "Ulasan Baru ⭐", message: `${order.buyerName} memberi rating ${rating} bintang untuk ${order.productName}.`, orderId: order.id });
      alert("Ulasan telah dikirim");
      setShowReview(false);
    } catch (error) {
      alert("Gagal mengirim ulasan. Coba lagi.");
    } finally {
      setReviewBusy(false);
    }
  }
  async function requestCancelOrder() {
    if (cancelBusy || order.cancelRequest || ["dikirim", "selesai", "dibatalkan", "pembatalan_diajukan"].includes(normalizeStatus(order.statusPesanan))) return;
    if (!confirm("Ajukan pembatalan pesanan ke admin?")) return;
    setCancelBusy(true);
    try {
      await updateDoc(doc(db, "orders", order.id), { cancelRequest: true, cancelStatus: "pending", statusPesanan: "pembatalan_diajukan", cancelRequestedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await createNotif({ role: "admin", type: "order_cancel_request", title: "Pengajuan Pembatalan Pesanan", message: `${order.buyerName} mengajukan pembatalan untuk ${order.productName}.`, orderId: order.id });
      alert("Pengajuan pembatalan dikirim ke admin");
    } catch (error) {
      alert("Gagal mengajukan pembatalan. Coba lagi.");
    } finally {
      setCancelBusy(false);
    }
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <img src={order.productImage || "https://via.placeholder.com/80?text=No"} alt={order.productName} style={{ width: 80, height: 80, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}><span style={{ fontWeight: 700, fontSize: 15 }}>{order.productName}</span><span className={`badge ${s.cls}`}>{s.label}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}><span>Qty: {order.quantity}</span><span>Subtotal: {rupiah(order.productTotal)}</span><span>Ongkir: {rupiah(order.shippingCost)}</span><span>Total: <b style={{ color: "var(--orange)" }}>{rupiah(order.totalAmount)}</b></span><span>Kurir: {order.courierName}</span>{order.trackingNumber && <span>Resi: <b>{order.trackingNumber}</b></span>}</div>
          {order.sellerMapLink && order.shippingType === "pickup" && <div style={{ marginTop: 8, fontSize: 13 }}><b>Link lokasi toko:</b> <button type="button" className="btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={() => window.open(order.sellerMapLink, "_blank")}>Buka Maps Toko</button><div style={{ color: order.statusPesanan === "selesai" ? "#10B981" : "var(--orange)", fontWeight: 700, marginTop: 6 }}>{order.statusPesanan === "selesai" ? "Pesanan sudah diambil" : "Segera ambil pesanan anda"}</div></div>}
          
          {order.statusPembayaran === "menunggu_ongkir" && <div style={{ marginTop: 8, padding: 10, background: "#FFF8E1", borderRadius: 8, color: "#92400E", fontSize: 13 }}>Penjual sedang menghitung ongkir. Tombol pembayaran aktif setelah ongkir dikirim.</div>}
          {order.trackingNumber && <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn-ghost btn-sm" onClick={() => copyToClipboard(order.trackingNumber, "Resi berhasil disalin")}>Salin Resi</button><a className="btn-primary btn-sm" href="https://parcelsapp.com/id" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Lacak Paket</a></div>}
        </div>
      </div>
      {order.paymentProofUrl && <div style={{ marginTop: 10 }}><img src={order.paymentProofUrl} alt="Bukti" style={{ width: 180, height: 120, objectFit: "cover", borderRadius: 8 }} /></div>}
      {canBuyerCancelOrder(order) &&
        order.statusPembayaran !== "menunggu_ongkir" &&
        !order.proofSubmitted &&
        !order.paymentProofUrl &&
        ["transfer", "qris"].includes(order.paymentMethod) &&
        order.shippingType !== "pickup" && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          {/* WAJIB URUT: INFO REKENING ADMIN → UPLOAD BUKTI → TOMBOL KIRIM BUKTI */}
          {order.paymentMethod === "qris" ? (
            <div style={{ background: "#FFF8E1", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 13, border: "1px solid #FDE68A" }}>
              <div style={{ fontWeight: 800, marginBottom: 8, color: "#92400E" }}>📱 SCAN QRIS ADMIN</div>
              {paymentSetting?.qrisUrl ? (
                <img src={paymentSetting.qrisUrl} alt="QRIS Admin" style={{ width: 220, maxWidth: "100%", borderRadius: 12, border: "1px solid var(--border)", background: "#fff" }} />
              ) : (
                <div style={{ color: "#B91C1C", fontWeight: 700 }}>QRIS belum diatur admin</div>
              )}
              <div style={{ color: "var(--orange)", fontWeight: 800, marginTop: 8 }}>Jika sudah bayar kirimkan bukti pembayaran</div>
            </div>
          ) : (
            <div style={{ background: "#FFF8E1", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 13, border: "1px solid #FDE68A" }}>
              <div style={{ fontWeight: 800, marginBottom: 8, color: "#92400E" }}>💳 INFO REKENING ADMIN</div>
              <div>Bank: <b>{paymentSetting?.bankName || "Belum diatur admin"}</b></div>
              <div>No Rekening: <b>{paymentSetting?.accountNumber || "-"}</b></div>
              <div>Atas Nama: <b>{paymentSetting?.accountHolder || "-"}</b></div>
              <div style={{ color: "var(--orange)", fontWeight: 800, marginTop: 8 }}>Jika sudah bayar kirimkan bukti pembayaran</div>
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Upload Bukti Pembayaran</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                if (e.target.files[0]?.size > 1024 * 1024) {
                  alert("Maks 1MB");
                  return;
                }
                setFile(e.target.files[0]);
              }}
              style={{ fontSize: 13, flex: 1 }}
            />
            <button className="btn-primary btn-sm" onClick={uploadProof} disabled={uploadLoading}>
              {uploadLoading ? "Mengirim..." : "Kirim Bukti"}
            </button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>{isOrderStatus(order, "dikirim") && !order.receivedAt && <button className="btn-primary btn-sm" onClick={received}>✅ Sudah Diterima</button>}{canBuyerCancelOrder(order) && !order.cancelRequest && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={requestCancelOrder} disabled={cancelBusy}>{cancelBusy ? "Memproses..." : "Batalkan Pesanan"}</button>}{order.statusPesanan === "pembatalan_diajukan" && <span className="badge badge-yellow">Menunggu Approval Admin</span>}{order.statusPesanan === "selesai" && !order.reviewSubmitted && <button className="btn-outline btn-sm" onClick={() => setShowReview(!showReview)}>⭐ Beri Ulasan</button>}{order.statusPesanan === "selesai" && order.reviewSubmitted && <button className="btn-primary btn-sm" disabled style={{ background: "#111", borderColor: "#111" }}>Ulasan Terkirim</button>}</div>
      {showReview && !order.reviewSubmitted && <div style={{ marginTop: 14, padding: 14, background: "var(--bg)", borderRadius: 8 }}><div style={{ fontWeight: 600, marginBottom: 8 }}>Beri Ulasan</div><div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{[1,2,3,4,5].map((r) => <button key={r} onClick={() => setRating(r)} style={{ background: rating >= r ? "#F59E0B" : "#fff", border: "1.5px solid", borderColor: rating >= r ? "#F59E0B" : "var(--border)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>⭐</button>)}</div><textarea className="form-input" rows={2} placeholder="Tulis komentar Anda..." value={comment} onChange={(e) => setComment(e.target.value)} style={{ marginBottom: 8 }} /><button className="btn-primary btn-sm" onClick={sendReview} disabled={reviewBusy || order.reviewSubmitted} style={(reviewBusy || order.reviewSubmitted) ? { background: "#111", borderColor: "#111" } : {}}>{reviewBusy || order.reviewSubmitted ? "Ulasan Terkirim" : "Kirim Ulasan"}</button></div>}
    </div>
  );
}


function BuyerProfile({ profile }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>👤 Profil Saya</div>
      <div className="card" style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--orange-light)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700 }}>{profile?.name?.[0]?.toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{profile?.name}</div>
            <span className="badge badge-green">Pembeli Aktif</span>
          </div>
        </div>
        <div className="divider" />
        {[["Email", profile?.email],["WhatsApp", profile?.whatsapp || "-"],["Status Akun", profile?.status === "active" ? "✅ Aktif" : profile?.status]].map(([l,v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
            <span style={{ color: "var(--text2)" }}>{l}</span>
            <span style={{ fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── SELLER DASHBOARD ───────────────────────── */
function SellerDashboard({ user, profile, products, orders, wallets, commissionBills = [], paymentSetting, commissionSetting, chatUnread = 0, createNotif, onLogout }) {
  const [tab, setTab] = useState("beranda");
  const wallet = wallets.find((w) => w.sellerId === user.uid);
  const sellerCommissionBills = commissionBills.filter((b) => b.sellerId === user.uid);
  const sellerIncomingOrderCount = orders.filter((o) => ["pesanan_masuk", "menunggu_ongkir", "menunggu_verifikasi", "pembatalan_diajukan"].includes(o.statusPesanan) || o.pendingShippingQuote).length;
  const commissionDebt = sumCommissionDebt(sellerCommissionBills);
  const remindedCommissionBillsRef = useRef(new Set());
  const isCommissionBlocked = profile?.commissionBlocked === true;
  const isSellerBlockedByAdmin = isCommissionBlocked;
  const hasOpenCommissionDebt = commissionDebt > 0;
  useEffect(() => {
    if (!user?.uid || profile?.role !== "seller" || !createNotif) return;

    sellerCommissionBills
      .filter(shouldRemindCommissionBill)
      .forEach(async (bill) => {
        if (!bill?.id || remindedCommissionBillsRef.current.has(bill.id)) return;
        remindedCommissionBillsRef.current.add(bill.id);
        const amount = Number(bill.remaining || bill.amount || 0);
        try {
          await createNotif({
            role: "seller",
            userId: user.uid,
            type: "commission_bill_reminder",
            title: "Pengingat Tagihan Komisi",
            message: `Kamu masih punya tagihan komisi tunai ${rupiah(amount)}${bill.productName ? ` untuk ${bill.productName}` : ""}. Silakan bayar ke rekening admin dan upload bukti pembayaran.`,
            billId: bill.id,
            orderId: bill.orderId || null,
          });
          await updateDoc(doc(db, "komisi_tagihan", bill.id), {
            lastReminderAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          remindedCommissionBillsRef.current.delete(bill.id);
          console.error("Gagal membuat pengingat tagihan komisi:", error);
        }
      });
  }, [sellerCommissionBills, user, profile, createNotif]);

  const tabs = [
    { id: "beranda", label: "Beranda", icon: "🏠" },
    { id: "produk", label: "Produk Saya", icon: "📦" },
    { id: "tagihan", label: "Tagihan Komisi", icon: "💸" },
    { id: "order", label: "Pesanan Masuk", icon: "🛒" },
    { id: "chat", label: "Chat Buyer & Admin", icon: "💬" },
    { id: "withdraw", label: "Penarikan Saldo", icon: "💰" },
    { id: "profil", label: "Profil Toko", icon: "🏪" },
  ];
  return (
    <div className="dash-layout">
      <div className="dash-sidebar">
        <div className="dash-sidebar-profile">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--orange-light)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>🏪</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{profile?.name}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>Seller</div>
            </div>
          </div>
        </div>
        {tabs.map((t) => (
          <div key={t.id} className={`dash-sidebar-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span> {t.label}{t.id === "order" && sellerIncomingOrderCount > 0 && <span className="badge-count" style={{ position: "static", marginLeft: 6 }}>{sellerIncomingOrderCount}</span>}{t.id === "chat" && chatUnread > 0 && <span className="badge-count" style={{ position: "static", marginLeft: 6 }}>{chatUnread}</span>}
          </div>
        ))}
        <div className="dash-logout-btn-wrap" style={{ padding: "8px 12px", marginTop: "auto" }}>
          <button onClick={onLogout} style={{ width: "100%", padding: "10px 14px", background: "#FEF2F2", color: "#EF4444", border: "1px solid #FECACA", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            🚪 Keluar
          </button>
        </div>
      </div>
      <div className="dash-content">
        {tab === "beranda" && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Dashboard Toko 🏪</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 28 }}>
              {[
                { label: "Total Produk", value: products.length, icon: "📦", color: "#EE4D2D" },
                { label: "Produk Aktif", value: products.filter((p) => p.status === "active").length, icon: "✅", color: "#10B981" },
                { label: "Total Stok", value: products.filter((p) => !p.isDeleted).reduce((sum, p) => sum + getStock(p), 0), icon: "📦", color: "#14B8A6" },
                { label: "Total Order", value: orders.length, icon: "🛒", color: "#3B82F6" },
                { label: "Saldo Tersedia", value: rupiah(wallet?.saldoTersedia || 0), icon: "💰", color: "#F59E0B" },
                { label: "Tagihan Komisi", value: rupiah(commissionDebt), icon: "💸", color: commissionDebt > 0 ? "#EF4444" : "#10B981" },
                { label: "Total Penjualan", value: rupiah(wallet?.totalPenjualan || 0), icon: "📈", color: "#8B5CF6" },
              ].map((s) => (
                <div key={s.label} className="stat-card">
                  <div className="stat-icon" style={{ background: s.color + "15" }}><span>{s.icon}</span></div>
                  <div style={{ fontSize: s.label.startsWith("Saldo") || s.label.startsWith("Total P") ? 15 : 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              ))}
            </div>
            {profile?.status === "pending" && (
              <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 700, color: "#92400E", marginBottom: 4 }}>⏳ Akun Menunggu Verifikasi</div>
                <p style={{ fontSize: 13, color: "#78350F" }}>Akun seller Anda sedang dalam proses verifikasi oleh admin. Setelah admin menyetujui akun, fitur upload produk akan aktif.</p>
              </div>
            )}
            {hasOpenCommissionDebt && (
              <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 800, color: "#92400E", marginBottom: 4 }}>💸 Tagihan Komisi Tunai</div>
                <p style={{ fontSize: 13, color: "#78350F" }}>Total tagihan komisi: <b>{rupiah(commissionDebt)}</b>. Sistem akan mengingatkan otomatis maksimal 1x per hari sampai tagihan dibayar/upload bukti. Tagihan ini belum otomatis memblokir akun; pemblokiran hanya dilakukan manual oleh admin/sub admin.</p>
              </div>
            )}
            {isCommissionBlocked && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 800, color: "#B91C1C", marginBottom: 4 }}>🚫 Akun Seller Diblokir Admin</div>
                <p style={{ fontSize: 13, color: "#7F1D1D" }}>Admin/sub admin sedang memblokir fitur upload produk, proses order, dan penarikan. Hubungi admin setelah pembayaran komisi selesai.</p>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: 12 }}>📊 Order Terbaru</div>
                {sortNewest(orders).slice(0, 4).map((o) => (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <span style={{ color: "var(--text2)" }}>{o.productName}</span>
                    <span className={`badge ${statusLabel(o.statusPesanan).cls}`}>{statusLabel(o.statusPesanan).label}</span>
                  </div>
                ))}
                {orders.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>Belum ada order</p>}
              </div>
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: 12 }}>📦 Produk Terbaru</div>
                {products.slice(0, 4).map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <span style={{ color: "var(--text2)" }}>{p.productName}</span>
                    <span className={`badge ${statusLabel(p.status).cls}`}>{statusLabel(p.status).label}</span>
                  </div>
                ))}
                {products.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>Belum ada produk</p>}
              </div>
            </div>
          </div>
        )}
        {tab === "produk" && <AddProduct user={user} profile={profile} products={products} hasCommissionDebt={isSellerBlockedByAdmin} commissionDebt={commissionDebt} commissionSetting={commissionSetting} createNotif={createNotif} />}
        {tab === "tagihan" && <SellerCommissionBills bills={sellerCommissionBills} paymentSetting={paymentSetting} createNotif={createNotif} />}
        {tab === "order" && <SellerOrders orders={orders} createNotif={createNotif} hasCommissionDebt={isSellerBlockedByAdmin} commissionDebt={commissionDebt} />}
        {tab === "chat" && <ChatCenter user={user} profile={profile} createNotif={createNotif} mode="seller" />}
        {tab === "withdraw" && <Withdraw user={user} profile={profile} wallet={wallet} hasCommissionDebt={isSellerBlockedByAdmin} commissionDebt={commissionDebt} createNotif={createNotif} />}
        {tab === "profil" && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🏪 Profil Toko</div>
            <div className="card" style={{ maxWidth: 480 }}>
              {[["Nama Toko", profile?.name],["Email", profile?.email],["WhatsApp", profile?.whatsapp || "-"],["Status", profile?.status === "active" ? "✅ Aktif" : "⏳ Pending"],["Saldo Tersedia", rupiah(wallet?.saldoTersedia || 0)],["Total Penjualan", rupiah(wallet?.totalPenjualan || 0)]].map(([l,v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                  <span style={{ color: "var(--text2)" }}>{l}</span>
                  <span style={{ fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddProduct({ user, profile, products, hasCommissionDebt = false, commissionDebt = 0, commissionSetting, createNotif }) {
  const [form, setForm] = useState({ productName: "", category: "", subCategory: "", price: "", stock: "", description: "", weightGram: "", sellerAddress: "", sellerMapLink: "" });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const sellerApproved = profile?.status === "active" || profile?.status === "approved";

  if (!sellerApproved) {
    return (
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Produk Saya</div>
        <div className="card" style={{ border: "1px solid #F59E0B", background: "#FFF8E1" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#92400E", marginBottom: 8 }}>⏳ Akun Seller Belum Disetujui</div>
          <p style={{ fontSize: 14, color: "#78350F", lineHeight: 1.6 }}>
            Akun seller kamu masih menunggu approval admin. Setelah admin menyetujui akun kamu, tombol upload produk akan aktif otomatis.
          </p>
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "#fff", fontSize: 13, color: "var(--text2)" }}>
            Status akun: <b>{profile?.status || "pending"}</b>
          </div>
        </div>
      </div>
    );
  }

  if (hasCommissionDebt) {
    return (
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Produk Saya</div>
        <div className="card" style={{ border: "1px solid #FCA5A5", background: "#FEF2F2" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#B91C1C", marginBottom: 8 }}>🚫 Upload Produk Diblokir Admin</div>
          <p style={{ fontSize: 14, color: "#7F1D1D", lineHeight: 1.6 }}>Akun kamu sedang diblokir manual oleh admin/sub admin. Silakan bayar tagihan komisi melalui menu Tagihan Komisi, upload bukti pembayaran, lalu tunggu admin approve. Setelah approve, blokir akan otomatis dibuka.</p>
        </div>
      </div>
    );
  }

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { alert("Ukuran gambar maksimal 1MB"); return; }
    setFile(f); setPreview(URL.createObjectURL(f));
  }

  async function submit(e) {
    e.preventDefault();
    if (!sellerApproved) { alert("Akun seller belum disetujui admin. Kamu belum bisa upload produk."); return; }
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Upload produk belum bisa dilakukan.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (!file) { alert("Pilih gambar dulu"); return; }
    setLoading(true);
    const imageUrl = await uploadImageToCloudinary(file);
    const needsAdminApproval = form.category === "Jasa Lokal" && form.subCategory === "Jasa Pijat";
    const ref = await addDoc(collection(db, "products"), {
      sellerId: user.uid, sellerName: profile.name, productName: form.productName, category: form.category, subCategory: form.subCategory,
      price: parseNumberInput(form.price), stock: Number(form.stock), description: form.description,
      weightGram: Number(form.weightGram || 1000), sellerAddress: form.sellerAddress,
      sellerMapLink: form.sellerMapLink,
      imageUrl, status: needsAdminApproval ? "pending" : "active", isDeleted: false, commissionType: "percent", commissionValue: Number(commissionSetting?.globalCommissionPercent || 10),
      averageRating: 0, ratingCount: 0, totalReviews: 0, soldCount: 0, totalSold: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await createNotif({ role: "admin", type: "product_new", title: "Produk Baru", message: `${profile.name} upload produk ${form.productName}`, productId: ref.id });
    setLoading(false); setShowForm(false); setFile(null); setPreview("");
    alert(needsAdminApproval ? "Jasa Pijat berhasil diupload dan menunggu approval admin." : "Produk berhasil diupload dan langsung aktif.");
  }

  async function quickEditProduct(p) {
    const price = prompt("Harga baru:", p.price || "");
    if (price === null) return;
    const stock = prompt("Stok baru:", p.stock || "");
    if (stock === null) return;
    await updateDoc(doc(db, "products", p.id), { price: Number(String(price).replace(/\D/g, "")), stock: Number(String(stock).replace(/\D/g, "")), updatedAt: serverTimestamp() });
    alert("Produk berhasil diedit");
  }

  async function softDeleteProduct(p) {
    if (!confirm("Hapus produk " + p.productName + "?")) return;
    await updateDoc(doc(db, "products", p.id), { isDeleted: true, updatedAt: serverTimestamp() });
    alert("Produk berhasil dihapus");
  }

  async function editSellerMapLink(p) {
    const link = prompt("Link Google Maps toko:", p.sellerMapLink || "");
    if (link === null) return;
    await updateDoc(doc(db, "products", p.id), { sellerMapLink: link.trim(), updatedAt: serverTimestamp() });
    alert("Link Google Maps toko berhasil disimpan");
  }
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>📦 Produk Saya ({products.filter((p) => !p.isDeleted).length})</div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>+ Tambah Produk</button>
      </div>
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Tambah Produk Baru</div>
          <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="form-group">
              <label>Nama Produk</label>
              <input className="form-input" placeholder="Nama produk" onChange={(e) => setForm({ ...form, productName: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Kategori</label>
              <select className="form-input" onChange={(e) => setForm({ ...form, category: e.target.value, subCategory: "" })} required>
                <option value="">Pilih kategori</option>
                {CATEGORIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Subkategori</label>
              <select className="form-input" value={form.subCategory} onChange={(e) => setForm({ ...form, subCategory: e.target.value })} required disabled={!form.category}>
                <option value="">{form.category ? "Pilih subkategori" : "Pilih kategori dulu"}</option>
                {(CATEGORY_GROUPS[form.category] || []).map((sub) => <option key={sub} value={sub}>{sub}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Harga (Rp)</label>
              <input className="form-input" inputMode="numeric" placeholder="Contoh: 25.000" value={form.price} onChange={(e) => setForm({ ...form, price: formatNumberInput(e.target.value) })} required />
            </div>
            <div className="form-group">
              <label>Stok</label>
              <input className="form-input" type="number" placeholder="Jumlah stok" onChange={(e) => setForm({ ...form, stock: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Berat (gram)</label>
              <input className="form-input" type="number" placeholder="Contoh: 500" onChange={(e) => setForm({ ...form, weightGram: e.target.value })} />
            </div>

            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Alamat Toko</label>
              <input className="form-input" placeholder="Alamat lengkap toko/gudang" onChange={(e) => setForm({ ...form, sellerAddress: e.target.value })} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Link Google Maps Toko</label>
              <input className="form-input" placeholder="https://maps.google.com/..." onChange={(e) => setForm({ ...form, sellerMapLink: e.target.value })} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Deskripsi</label>
              <textarea className="form-input" rows={3} placeholder="Deskripsi produk..." onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Foto Produk (maks 1MB)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} className="form-input" style={{ padding: 8 }} />
              {preview && <img src={preview} alt="Preview" style={{ height: 160, objectFit: "cover", borderRadius: 8, marginTop: 8 }} />}
            </div>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Batal</button>
              <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Mengupload..." : "Upload Produk"}</button>
            </div>
          </form>
        </div>
      )}
      {products.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📦</div><p>Belum ada produk</p></div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Produk</th><th>Kategori</th><th>Harga</th><th>Stok</th><th>Status</th><th>Rating</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {products.filter((p) => !p.isDeleted).map((p) => {
                const s = statusLabel(p.status);
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <img src={p.imageUrl || ""} alt={p.productName} style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{p.productName}</span>
                      </div>
                    </td>
                    <td><span style={{ fontSize: 12 }}>{p.category}{p.subCategory ? ` / ${p.subCategory}` : ""}</span></td>
                    <td><span style={{ color: "var(--orange)", fontWeight: 600 }}>{rupiah(p.price)}</span></td>
                    <td>{p.stock}</td>
                    <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                    <td>⭐ {(p.averageRating || 0).toFixed(1)}</td>
                    <td><button className="btn-ghost btn-sm" onClick={() => quickEditProduct(p)}>Edit</button> <button className="btn-ghost btn-sm" onClick={() => editSellerMapLink(p)}>Edit Maps</button> <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => softDeleteProduct(p)}>Hapus</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SellerOrders({ orders, createNotif, hasCommissionDebt = false, commissionDebt = 0 }) {
  const sortedOrders = sortNewest(orders);
  const [shipForm, setShipForm] = useState({});
  const [quoteForm, setQuoteForm] = useState({});

  const isPickup = (o) => o.shippingType === "pickup";
  const isSameDay = (o) => o.shippingType === "same_day";
  const isExpedition = (o) => !isPickup(o) && !isSameDay(o);

  async function quoteShipping(o) {
    const cost = Number(String(quoteForm[o.id] || "").replace(/\D/g, ""));
    if (!cost || cost < 0) { alert("Isi harga ongkir dulu"); return; }
    const productTotal = Number(o.productTotal || 0);
    const adminFee = getProductCommissionTotal(o);
    const sellerAmount = Math.max(0, productTotal - adminFee + cost);
    const totalAmount = productTotal + cost;
    await updateDoc(doc(db, "orders", o.id), {
      shippingCost: cost,
      totalAmount,
      sellerAmount,
      sellerReceivableAmount: isTransferPayment(o) ? sellerAmount : 0,
      sellerProductAmount: Math.max(0, productTotal - adminFee),
      sellerShippingAmount: cost,
      cashReceivedBySeller: isCashPayment(o) ? totalAmount : 0,
      pendingShippingQuote: false,
      statusPembayaran: o.paymentMethod === "cash" ? "tunai" : "menunggu_pembayaran",
      statusPesanan: o.paymentMethod === "cash" ? "pesanan_masuk" : "menunggu_pembayaran",
      courierService: `Ongkir: ${rupiah(cost)}`,
      updatedAt: serverTimestamp()
    });
    // Komisi tunai diproses saat order selesai, bukan saat ongkir dikirim.
    await createNotif({ role: "buyer", userId: o.buyerId, type: "shipping_quote_ready", title: "Ongkir Sudah Dihitung", message: `Ongkir ${o.productName} adalah ${rupiah(cost)}. Silakan lanjutkan pembayaran.`, orderId: o.id });
    alert("Ongkir dikirim ke buyer");
  }

  async function processOrder(o) {
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Kamu belum bisa proses order.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (isPickup(o)) {
      alert("Ambil di tempat tidak memakai proses/kirim. Konfirmasi setelah pembeli datang.");
      return;
    }
    if (o.statusPembayaran !== "sudah_dibayar" && o.paymentMethod !== "cash") { alert("Order transfer harus di-approve admin dulu"); return; }
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "diproses", processedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_processing", title: "Pesanan Diproses", message: `Pesanan ${o.productName} sedang diproses seller.`, orderId: o.id });
  }

  async function confirmPickup(o) {
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Kamu belum bisa konfirmasi pickup.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (!confirm("Konfirmasi hanya setelah pembeli sudah datang dan mengambil pesanan. Lanjutkan?")) return;
    await completeOrderAndCreditSeller(o, { pickupConfirmedAt: serverTimestamp() }, createNotif);
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_done", title: "Pesanan Diambil", message: `Pesanan ${o.productName} sudah dikonfirmasi seller. Silakan beri ulasan bintang dan komentar.`, orderId: o.id });
    alert("Pesanan ambil di tempat sudah dikonfirmasi. Buyer akan diminta beri ulasan.");
  }

  async function sendSameDay(o) {
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dikirim", expeditionName: "Same Day Lokal", trackingNumber: "", shippedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_shipped", title: "Pesanan Same Day Dikirim", message: `Pesanan ${o.productName} sedang dikirim oleh seller.`, orderId: o.id });
    alert("Pesanan Same Day ditandai sedang dikirim");
  }

  async function sendTracking(o) {
    if (isPickup(o) || isSameDay(o)) {
      alert("Resi hanya untuk ekspedisi. Ambil di tempat dan Same Day tidak memakai nomor resi.");
      return;
    }
    const data = shipForm[o.id] || {};
    if (!data.expeditionName || !data.trackingNumber) { alert("Isi nama ekspedisi dan nomor resi"); return; }
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dikirim", expeditionName: data.expeditionName, trackingNumber: data.trackingNumber, shippedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_shipped", title: "Pesanan Dikirim 🚚", message: `Pesanan ${o.productName} dikirim via ${data.expeditionName}. Resi: ${data.trackingNumber}`, orderId: o.id });
    alert("Resi berhasil dikirim ke buyer");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>🛒 Pesanan Masuk ({sortedOrders.length})</div>
      {sortedOrders.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>Belum ada pesanan masuk</p></div>
      ) : sortedOrders.map((o) => {
        const s = statusLabel(o.statusPesanan);
        const needQuote = o.statusPembayaran === "menunggu_ongkir" || o.pendingShippingQuote;
        return (
          <div key={o.id} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <img src={o.productImage || "https://via.placeholder.com/72?text=No"} alt={o.productName} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{o.productName}</span>
                  <span className={`badge ${s.cls}`}>{s.label}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}>
                  <span>Pembeli: {o.buyerName}</span>
                  <span>WA: {o.buyerWhatsapp}</span>
                  <span>Qty: {o.quantity}</span>
                  <span>Subtotal: {rupiah(o.productTotal)}</span>
                  <span>Ongkir: {rupiah(o.shippingCost)}</span>
                  <span>Total Bayar: <b style={{ color: "var(--orange)" }}>{rupiah(o.totalAmount)}</b></span>
                  <span>Metode Pembayaran: <b style={{ color: isCashPayment(o) ? "#D97706" : "#2563EB" }}>{isCashPayment(o) ? "Tunai" : paymentMethodLabel(o.paymentMethod)}</b></span>
                  <span>Kurir: {o.courierName}</span>
                  <span>{isCashPayment(o) ? "Tunai diterima seller" : "Saldo masuk saat selesai"}: <b style={{ color: "#10B981" }}>{rupiah(isCashPayment(o) ? o.totalAmount : getSellerReceivableAmount(o))}</b></span>
                </div>
                {o.buyerAddress && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>📍 {o.buyerAddress}</div>}
                {isPickup(o) && o.sellerMapLink && <div style={{ fontSize: 12, marginTop: 6 }}>Link lokasi toko: <button type="button" className="btn-primary btn-sm" onClick={() => window.open(o.sellerMapLink, "_blank")} style={{ marginLeft: 6 }}>Buka Maps Toko</button><br/><b>Siapkan pesanannya dan lakukan konfirmasi setelah pembeli datang.</b></div>}
                {isSameDay(o) && o.buyerMapsLink && <div style={{ fontSize: 12, marginTop: 6 }}>Maps pembeli: <button type="button" className="btn-primary btn-sm" onClick={() => window.open(o.buyerMapsLink, "_blank")} style={{ marginLeft: 6 }}>Buka Maps Pembeli</button></div>}
                {isExpedition(o) && (o.buyerVillage || o.buyerDistrict || o.buyerRegency) && <div style={{ fontSize: 12, marginTop: 6 }}>Alamat ongkir: {o.buyerVillage}, {o.buyerDistrict}, {o.buyerRegency} <button type="button" className="btn-primary btn-sm" onClick={() => window.open("https://rajaongkir.com/cek-ongkir", "_blank")} style={{ marginLeft: 8 }}>Cek Ongkir</button></div>}
              </div>
            </div>

            {o.paymentProofUrl && <div style={{ marginTop: 10 }}><img src={o.paymentProofUrl} alt="Bukti" style={{ width: 160, height: 100, objectFit: "cover", borderRadius: 8 }} /></div>}

            {needQuote && !isPickup(o) && (
              <div style={{ marginTop: 12, padding: 12, background: "#FFF8E1", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{isSameDay(o) ? "Isi Ongkir Same Day" : "Isi Ongkir Ekspedisi"}</div>
                {isExpedition(o) && <button type="button" className="btn-primary btn-sm" style={{ marginBottom: 8 }} onClick={() => window.open("https://rajaongkir.com/cek-ongkir", "_blank")}>Cek Ongkir</button>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input className="form-input" style={{ maxWidth: 220 }} placeholder="Harga ongkir, contoh 15000" value={quoteForm[o.id] || ""} onChange={(e) => setQuoteForm({ ...quoteForm, [o.id]: Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID") })} />
                  <button className="btn-primary btn-sm" onClick={() => quoteShipping(o)}>Kirim Ongkir</button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!needQuote && isPickup(o) && o.statusPesanan === "pesanan_masuk" && (
                <div style={{ width: "100%" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--orange)", marginBottom: 8 }}>Konfirmasi ketika pembeli sudah datang dan mengambil pesanan.</div>
                  <button className="btn-primary btn-sm" onClick={() => confirmPickup(o)}>✅ Konfirmasi Pembeli Datang</button>
                </div>
              )}

              {!needQuote && !isPickup(o) && o.statusPesanan === "pesanan_masuk" && (
                <button className="btn-primary btn-sm" onClick={() => processOrder(o)}>🔄 Proses</button>
              )}

              {isSameDay(o) && o.statusPesanan === "diproses" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {o.buyerMapsLink && <button type="button" className="btn-ghost btn-sm" onClick={() => window.open(o.buyerMapsLink, "_blank")}>Buka Maps Pembeli</button>}
                  <button className="btn-primary btn-sm" style={{ background: "#3B82F6" }} onClick={() => sendSameDay(o)}>🚚 Kirim</button>
                </div>
              )}

              {isExpedition(o) && o.statusPesanan === "diproses" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input className="form-input" style={{ maxWidth: 180 }} placeholder="Nama ekspedisi" value={shipForm[o.id]?.expeditionName || ""} onChange={(e) => setShipForm({ ...shipForm, [o.id]: { ...(shipForm[o.id] || {}), expeditionName: e.target.value } })} />
                  <input className="form-input" style={{ maxWidth: 180 }} placeholder="Nomor resi" value={shipForm[o.id]?.trackingNumber || ""} onChange={(e) => setShipForm({ ...shipForm, [o.id]: { ...(shipForm[o.id] || {}), trackingNumber: e.target.value } })} />
                  <button className="btn-primary btn-sm" style={{ background: "#3B82F6" }} onClick={() => sendTracking(o)}>🚚 Kirim Resi</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function Withdraw({ user, profile, wallet, hasCommissionDebt = false, commissionDebt = 0, createNotif }) {
  const [amountText, setAmountText] = useState("");
  const [form, setForm] = useState({ bankName: "", accountNumber: "", accountHolder: "" });
  const [loading, setLoading] = useState(false);
  const amount = Number(amountText.replace(/\D/g, ""));

  async function submit(e) {
    e.preventDefault();
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Penarikan belum bisa dilakukan.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (amount < 10000) { alert("Minimal penarikan adalah Rp10.000"); return; }
    if (amount > Number(wallet?.saldoTersedia || 0)) { alert("Saldo tersedia tidak cukup untuk penarikan ini"); return; }
    setLoading(true);
    try {
      const withdrawalRef = doc(collection(db, "withdrawals"));
      const walletRef = doc(db, "seller_wallets", user.uid);
      const batch = writeBatch(db);
      batch.update(walletRef, {
        saldoTersedia: increment(-amount),
        saldoTertahan: increment(amount),
        updatedAt: serverTimestamp(),
      });
      batch.set(withdrawalRef, {
        sellerId: user.uid, sellerName: profile.name, amount, bankName: form.bankName,
        accountNumber: form.accountNumber, accountHolder: form.accountHolder, status: "pending",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      batch.set(doc(collection(db, "wallet_transactions")), {
        sellerId: user.uid, withdrawalId: withdrawalRef.id, type: "withdraw_request", amount,
        note: "Request penarikan, saldo dipindahkan ke saldo tertahan", createdAt: serverTimestamp()
      });
      await batch.commit();
      await createNotif({ role: "admin", type: "withdraw_new", title: "Penarikan Baru", message: `Penarikan baru dari ${profile.name} sebesar ${rupiah(amount)} ke ${form.bankName}`, withdrawalId: withdrawalRef.id });
      setAmountText(""); setForm({ bankName: "", accountNumber: "", accountHolder: "" });
      alert("Pengajuan penarikan berhasil dikirim. Saldo masuk ke saldo tertahan sampai admin memproses.");
    } catch (error) {
      console.error("Gagal mengajukan penarikan:", error);
      alert("Gagal mengajukan penarikan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>💰 Penarikan Saldo</div>
      {hasCommissionDebt && <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 14, marginBottom: 16, color: "#B91C1C", fontSize: 13 }}>Penarikan diblokir manual oleh admin/sub admin.{commissionDebt > 0 && <> Tagihan komisi: <b>{rupiah(commissionDebt)}</b>.</>}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "#10B98115" }}><span>💰</span></div>
          <div className="stat-value" style={{ color: "#10B981", fontSize: 18 }}>{rupiah(wallet?.saldoTersedia || 0)}</div>
          <div className="stat-label">Saldo Tersedia</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "#F59E0B15" }}><span>📈</span></div>
          <div className="stat-value" style={{ color: "#F59E0B", fontSize: 18 }}>{rupiah(wallet?.totalPenjualan || 0)}</div>
          <div className="stat-label">Total Penjualan</div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 480 }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>Ajukan Penarikan</div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Jumlah (minimal Rp10.000)</label>
            <input className="form-input" placeholder="Contoh: 50.000" value={amountText}
              onChange={(e) => setAmountText(Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID"))} required />
          </div>
          <div className="form-group">
            <label>Nama Bank</label>
            <input className="form-input" placeholder="BCA / BRI / Mandiri / dll" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Nomor Rekening</label>
            <input className="form-input" placeholder="1234567890" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Atas Nama</label>
            <input className="form-input" placeholder="Nama sesuai rekening" value={form.accountHolder} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Memproses..." : "Ajukan Penarikan"}</button>
        </form>
      </div>
    </div>
  );
}

/* ─── ADMIN DASHBOARD ────────────────────────── */

function SellerCommissionBills({ bills = [], paymentSetting, createNotif }) {
  const [proofFiles, setProofFiles] = useState({});
  const [uploadingBillIds, setUploadingBillIds] = useState({});
  const openBills = bills.filter(isOpenCommissionBill);
  const historyBills = sortNewest(bills).filter((bill) => !isOpenCommissionBill(bill)).slice(0, 5);

  async function uploadProof(bill) {
    if (uploadingBillIds[bill.id]) return;
    if (["menunggu_approval", "approved", "auto_paid", "paid"].includes(bill.status)) { alert("Bukti pembayaran komisi sudah dikirim atau tagihan sudah lunas."); return; }
    const file = proofFiles[bill.id];
    if (!file) { alert("Pilih bukti pembayaran komisi dulu"); return; }
    if (file.size > 1024 * 1024) { alert("Ukuran bukti maksimal 1MB"); return; }
    setUploadingBillIds((prev) => ({ ...prev, [bill.id]: true }));
    try {
      const url = await uploadImageToCloudinary(file);
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, "komisi_tagihan", bill.id);
        const freshBill = await transaction.get(billRef);
        const data = freshBill.data() || {};
        if (["menunggu_approval", "approved", "auto_paid", "paid"].includes(data.status)) {
          throw new Error("Bukti pembayaran komisi sudah dikirim atau tagihan sudah lunas.");
        }
        transaction.update(billRef, {
          proofUrl: url,
          status: "menunggu_approval",
          proofUploadedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (bill.orderId) {
          transaction.update(doc(db, "orders", bill.orderId), {
            cashCommissionProofUrl: url,
            cashCommissionStatus: "menunggu_approval",
            updatedAt: serverTimestamp(),
          });
        }
      });
      await createNotif({
        role: "admin",
        type: "commission_proof",
        title: "Bukti Komisi Tunai Menunggu Approval",
        message: `${bill.sellerName || "Seller"} mengirim bukti pembayaran komisi ${rupiah(bill.remaining || bill.amount)}. Silakan cek dan approve jika pembayaran sudah masuk.`,
        billId: bill.id,
        orderId: bill.orderId || null,
        sellerId: bill.sellerId || null,
      });
      setProofFiles((prev) => ({ ...prev, [bill.id]: null }));
      alert("Bukti komisi berhasil dikirim. Menunggu approval admin.");
    } catch (error) {
      console.error("Gagal upload bukti komisi", error);
      alert(error?.message || "Gagal upload bukti komisi. Coba lagi.");
    } finally {
      setUploadingBillIds((prev) => ({ ...prev, [bill.id]: false }));
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>💸 Tagihan Komisi Tunai</div>
      <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
        Klik <b>Upload Bukti Pembayaran</b> setelah transfer komisi ke rekening admin. Sistem akan mengirim pengingat otomatis maksimal 1x per hari untuk tagihan yang belum dibayar. Jika akun sedang diblokir, blokir akan otomatis terbuka setelah admin approve bukti pembayaran.
      </div>
      {openBills.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">✅</div><p>Tidak ada tagihan komisi terbuka</p></div>
      ) : openBills.map((bill) => (
        <div key={bill.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800 }}>{bill.productName || "Tagihan Komisi"}</div>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>Jumlah yang harus dibayar: <b style={{ color: "#EF4444" }}>{rupiah(bill.remaining || bill.amount)}</b></div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, lineHeight: 1.6 }}>
                Total komisi: <b>{rupiah(bill.amount)}</b> · Dipotong saldo: <b>{rupiah(bill.autoDeductedFromBalance || bill.paidFromBalance || 0)}</b> · Sisa: <b>{rupiah(bill.remaining || 0)}</b>
              </div>
              {bill.note && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{bill.note}</div>}
              <div style={{ fontSize: 12, color: "var(--text3)" }}>Status: {bill.status}</div>
            </div>
            <span className={`badge ${bill.status === "menunggu_approval" ? "badge-yellow" : "badge-red"}`}>{bill.status === "menunggu_approval" ? "Menunggu Admin" : "Belum Lunas"}</span>
          </div>
          {bill.status !== "menunggu_approval" && (
            <div style={{ marginTop: 12, background: "#FFF8E1", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Bayar Komisi ke Rekening Admin</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 8 }}>
                Bank: <b>{paymentSetting?.bankName || "Belum diatur"}</b><br/>
                No Rekening: <b>{paymentSetting?.accountNumber || "-"}</b><br/>
                Atas Nama: <b>{paymentSetting?.accountHolder || "-"}</b>
              </div>
              <input className="form-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setProofFiles({ ...proofFiles, [bill.id]: e.target.files?.[0] || null })} />
              <button className="btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => uploadProof(bill)} disabled={!!uploadingBillIds[bill.id]}>{uploadingBillIds[bill.id] ? "Mengirim..." : "Upload Bukti Pembayaran"}</button>
            </div>
          )}
          {bill.proofUrl && <img src={bill.proofUrl} alt="Bukti komisi" style={{ marginTop: 10, width: 160, height: 100, objectFit: "cover", borderRadius: 8 }} />}
        </div>
      ))}

      {historyBills.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Riwayat Komisi Terakhir</div>
          {historyBills.map((bill) => (
            <div key={bill.id} className="card" style={{ marginBottom: 10, padding: 12, background: "#F8FAFC" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                <div>
                  <b style={{ color: "var(--text)" }}>{bill.productName || "Komisi Tunai"}</b><br/>
                  Total: <b>{rupiah(bill.amount)}</b> · Potong saldo: <b>{rupiah(bill.autoDeductedFromBalance || bill.paidFromBalance || 0)}</b> · Sisa: <b>{rupiah(bill.remaining || 0)}</b>
                  {bill.note && <div style={{ color: "var(--text3)", marginTop: 3 }}>{bill.note}</div>}
                </div>
                <span className={`badge ${["approved","auto_paid","paid"].includes(bill.status) ? "badge-green" : "badge-gray"}`}>{bill.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminCommissionBills({ bills = [], createNotif }) {
  const sorted = sortNewest(bills);
  const [approvingBillIds, setApprovingBillIds] = useState({});
  const [cancellingBillIds, setCancellingBillIds] = useState({});

  async function approveBill(bill) {
    if (approvingBillIds[bill.id] || bill.status !== "menunggu_approval") return;
    setApprovingBillIds((prev) => ({ ...prev, [bill.id]: true }));
    try {
      const approvedAmount = Number(bill.remaining || bill.amount || 0);
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, "komisi_tagihan", bill.id);
        const freshBill = await transaction.get(billRef);
        const data = freshBill.data() || {};
        if (data.status !== "menunggu_approval") {
          throw new Error("Tagihan ini sudah diproses.");
        }
        transaction.update(billRef, {
          status: "approved",
          remaining: 0,
          manualPaidAmount: approvedAmount,
          approvedAt: serverTimestamp(),
          paidManualAt: serverTimestamp(),
          note: `Sisa tagihan ${rupiah(approvedAmount)} sudah di-approve admin dari bukti transfer.`,
          updatedAt: serverTimestamp(),
        });
        if (bill.orderId) {
          transaction.update(doc(db, "orders", bill.orderId), {
            cashCommissionStatus: "approved",
            cashCommissionRemaining: 0,
            cashCommissionApprovedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        transaction.set(doc(db, "wallet_transactions", `cash_commission_approved_${bill.id}`), {
          sellerId: bill.sellerId,
          billId: bill.id,
          orderId: bill.orderId || null,
          type: "cash_commission_manual_approved",
          amount: approvedAmount,
          note: "Komisi tunai disetujui admin dari bukti transfer",
          createdAt: serverTimestamp(),
        });
        if (bill.sellerId) {
          transaction.update(doc(db, "users", bill.sellerId), {
            commissionBlocked: false,
            commissionUnblockedAt: serverTimestamp(),
            commissionUnblockedBy: "commission_approved",
            updatedAt: serverTimestamp(),
          });
        }
      });
      await createNotif({ role: "seller", userId: bill.sellerId, type: "commission_approved", title: "Komisi Tunai Disetujui", message: `Bukti pembayaran komisi ${rupiah(bill.amount)} disetujui admin. Akun seller otomatis aktif kembali jika sebelumnya diblokir.`, billId: bill.id, orderId: bill.orderId || null });
      alert("Komisi disetujui. Seller otomatis dibuka blokirnya jika sebelumnya diblokir.");
    } catch (error) {
      alert(error?.message || "Gagal approve komisi. Coba lagi.");
    } finally {
      setApprovingBillIds((prev) => ({ ...prev, [bill.id]: false }));
    }
  }

  async function cancelBill(bill) {
    if (cancellingBillIds[bill.id] || bill.status !== "menunggu_approval") return;
    setCancellingBillIds((prev) => ({ ...prev, [bill.id]: true }));
    try {
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, "komisi_tagihan", bill.id);
        const freshBill = await transaction.get(billRef);
        const data = freshBill.data() || {};
        if (data.status !== "menunggu_approval") {
          throw new Error("Tagihan ini sudah diproses.");
        }
        transaction.update(billRef, {
          status: "cancelled",
          proofUrl: "",
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (bill.orderId) {
          transaction.update(doc(db, "orders", bill.orderId), {
            cashCommissionStatus: "cancelled",
            cashCommissionProofUrl: "",
            updatedAt: serverTimestamp(),
          });
        }
      });
      await createNotif({ role: "seller", userId: bill.sellerId, type: "commission_cancelled", title: "Bukti Komisi Ditolak", message: `Bukti pembayaran komisi ditolak. Silakan upload ulang.`, billId: bill.id, orderId: bill.orderId || null });
      alert("Tagihan dikembalikan ke seller untuk upload ulang");
    } catch (error) {
      alert(error?.message || "Gagal menolak bukti komisi. Coba lagi.");
    } finally {
      setCancellingBillIds((prev) => ({ ...prev, [bill.id]: false }));
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>💸 Komisi Tunai Seller</div>
      <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
        Klik <b>Approve Komisi</b> setelah bukti transfer valid. Saat approve, tagihan lunas dan blokir seller otomatis dibuka. Blokir seller tetap hanya manual dari menu Blok Seller.
      </div>
      {sorted.length === 0 ? <div className="empty-state"><div className="empty-icon">💸</div><p>Belum ada tagihan komisi</p></div> : sorted.map((bill) => (
        <div key={bill.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, fontSize: 13 }}>
            <div><b>Seller</b><br/>{bill.sellerName || bill.sellerId}</div>
            <div><b>Produk</b><br/>{bill.productName || "-"}</div>
            <div><b>Total Komisi</b><br/><span style={{ color: "var(--orange)", fontWeight: 800 }}>{rupiah(bill.amount)}</span></div>
            <div><b>Potong Saldo</b><br/>{rupiah(bill.autoDeductedFromBalance || bill.paidFromBalance || 0)}</div>
            <div><b>Sisa Tagihan</b><br/><span style={{ color: Number(bill.remaining || 0) > 0 ? "#EF4444" : "#10B981", fontWeight: 800 }}>{rupiah(bill.remaining || 0)}</span></div>
            <div><b>Status</b><br/><span className={`badge ${bill.status === "approved" || bill.status === "auto_paid" || bill.status === "paid" ? "badge-green" : bill.status === "menunggu_approval" ? "badge-yellow" : "badge-red"}`}>{bill.status}</span></div>
          </div>
          {bill.note && <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)", background: "#F8FAFC", borderRadius: 8, padding: 8 }}>{bill.note}</div>}
          {bill.proofUrl && <img src={bill.proofUrl} alt="Bukti komisi" style={{ marginTop: 10, width: 180, height: 110, objectFit: "cover", borderRadius: 8 }} />}
          {bill.status === "menunggu_approval" && (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="btn-primary btn-sm" onClick={() => approveBill(bill)} disabled={!!approvingBillIds[bill.id]}>{approvingBillIds[bill.id] ? "Memproses..." : "Approve Komisi"}</button>
              <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => cancelBill(bill)} disabled={!!cancellingBillIds[bill.id]}>{cancellingBillIds[bill.id] ? "Memproses..." : "Cancel/Tolak"}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AdminDashboard({ user, profile, products, orders, withdrawals, paymentSetting, manualBalance, commissionSetting, wallets, commissionBills = [], users, createNotif, onLogout }) {
  const [tab, setTab] = useState("order");
  const remindedAdminApprovalBillsRef = useRef(new Set());
  const autoBalance = wallets.reduce((sum, w) => sum + Number(w.saldoTersedia || 0), 0);
  const displayedBalance = manualBalance?.isManualBalanceActive ? Number(manualBalance.totalSellerBalanceManual || 0) : autoBalance;
  const completedCommissionIncome = orders.reduce((sum, o) => sum + getAdminCommissionIncome(o), 0);

  const isAdmin = profile.role === "admin";
  const isSubAdmin = profile.role === "sub_admin";

  useEffect(() => {
    if (!(isAdmin || isSubAdmin) || !createNotif) return;

    commissionBills
      .filter(shouldRemindAdminCommissionApproval)
      .forEach(async (bill) => {
        if (!bill?.id || remindedAdminApprovalBillsRef.current.has(bill.id)) return;
        remindedAdminApprovalBillsRef.current.add(bill.id);
        const amount = Number(bill.remaining || bill.amount || 0);
        try {
          await createNotif({
            role: "admin",
            type: "commission_approval_reminder",
            title: "Pengingat Approval Komisi",
            message: `Ada bukti pembayaran komisi ${rupiah(amount)} dari ${bill.sellerName || "seller"} yang masih menunggu approval admin.`,
            billId: bill.id,
            orderId: bill.orderId || null,
            sellerId: bill.sellerId || null,
          });
          await updateDoc(doc(db, "komisi_tagihan", bill.id), {
            lastAdminApprovalReminderAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          remindedAdminApprovalBillsRef.current.delete(bill.id);
          console.error("Gagal membuat pengingat approval komisi admin:", error);
        }
      });
  }, [commissionBills, isAdmin, isSubAdmin, createNotif]);

  const tabs = [
    { id: "order", label: "Order Masuk", icon: "🛒" },
    { id: "sellerApproval", label: "Approve Seller", icon: "✅" },
    { id: "sellerBlock", label: "Blok Seller", icon: "🚫" },
    { id: "chat", label: "Chat Seller", icon: "💬" },
    { id: "commission", label: "Komisi Tunai", icon: "💸" },
    ...(isAdmin ? [
      { id: "produk", label: "Kelola Produk", icon: "📦" },
      { id: "users", label: "Kelola Akun", icon: "👥" },
      { id: "withdraw", label: "Penarikan", icon: "💰" },
      { id: "commissionSetting", label: "Komisi Global", icon: "📊" },
      { id: "payment", label: "Rekening", icon: "💳" },
      { id: "balance", label: "Saldo Manual", icon: "⚙️" },
      { id: "admins", label: "Tambah Admin", icon: "👤" },
    ] : []),
  ];

  return (
    <div className="dash-layout">
      <div className="dash-sidebar">
        <div className="dash-sidebar-profile">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#3B82F615", color: "#3B82F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🛡️</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{profile?.name}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>{isAdmin ? "Admin Utama" : "Admin Order"}</div>
            </div>
          </div>
        </div>
        {tabs.map((t) => (
          <div key={t.id} className={`dash-sidebar-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span> {t.label}
          </div>
        ))}
        <div className="dash-logout-btn-wrap" style={{ padding: "8px 12px", marginTop: "auto" }}>
          <button onClick={onLogout} style={{ width: "100%", padding: "10px 14px", background: "#FEF2F2", color: "#EF4444", border: "1px solid #FECACA", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            🚪 Keluar
          </button>
        </div>
      </div>
      <div className="dash-content">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Total Produk", value: products.length, icon: "📦", color: "#EE4D2D" },
            { label: "Total Order", value: orders.length, icon: "🛒", color: "#3B82F6" },
            { label: "Penarikan", value: withdrawals.length, icon: "💸", color: "#F59E0B" },
            { label: "Saldo Seller", value: rupiah(displayedBalance), icon: "💰", color: "#10B981" },
            { label: "Tagihan Komisi", value: rupiah(sumCommissionDebt(commissionBills)), icon: "💸", color: "#EF4444" },
            { label: "Penghasilan Komisi", value: rupiah(completedCommissionIncome), icon: "📈", color: "#10B981" },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <div className="stat-icon" style={{ background: s.color + "15" }}><span>{s.icon}</span></div>
              <div style={{ fontWeight: 700, color: s.color, fontSize: s.label === "Saldo Seller" ? 14 : 22 }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
        {tab === "order" && <AdminOrders orders={orders} createNotif={createNotif} />}
        {tab === "chat" && <ChatCenter user={user} profile={profile} createNotif={createNotif} mode="admin" users={users} />}
        {tab === "sellerApproval" && (isAdmin || isSubAdmin) && <AdminSellerApprovals users={users} />}
        {tab === "sellerBlock" && (isAdmin || isSubAdmin) && <AdminSellerBlocks users={users} commissionBills={commissionBills} createNotif={createNotif} />}
        {tab === "produk" && isAdmin && <AdminProducts products={products} />}
        {tab === "users" && isAdmin && <AdminUsers users={users} products={products} />}
        {tab === "withdraw" && isAdmin && <AdminWithdraw withdrawals={withdrawals} />}
        {tab === "commission" && (isAdmin || isSubAdmin) && <AdminCommissionBills bills={commissionBills} createNotif={createNotif} />}
        {tab === "commissionSetting" && isAdmin && <AdminCommissionSetting current={commissionSetting} products={products} />}
        {tab === "payment" && isAdmin && <PaymentSetting paymentSetting={paymentSetting} />}
        {tab === "balance" && isAdmin && <ManualBalance />}
        {tab === "admins" && isAdmin && <CreateSubAdmin />}
      </div>
    </div>
  );
}




function AdminSellerBlocks({ users = [], commissionBills = [], createNotif }) {
  const sellers = users
    .filter((u) => u.role === "seller" && !u.isDeleted && u.status !== "deleted")
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));

  function sellerIdOf(u) {
    return u.uid || u.id;
  }

  function sellerDebt(sellerId) {
    return sumCommissionDebt(commissionBills.filter((b) => b.sellerId === sellerId));
  }

  async function toggleSellerBlock(u, blocked) {
    const sellerId = sellerIdOf(u);
    if (!sellerId) { alert("ID seller tidak ditemukan."); return; }
    if (!confirm(`${blocked ? "Blokir" : "Buka blokir"} seller ${u.name || u.email || sellerId}?`)) return;
    await updateDoc(doc(db, "users", sellerId), {
      commissionBlocked: blocked,
      commissionBlockedAt: blocked ? serverTimestamp() : null,
      commissionUnblockedAt: !blocked ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
    if (createNotif) {
      await createNotif({
        role: "seller",
        userId: sellerId,
        type: blocked ? "seller_commission_blocked" : "seller_commission_unblocked",
        title: blocked ? "Akun Seller Diblokir Admin 🚫" : "Blokir Seller Dibuka ✅",
        message: blocked
          ? "Admin/sub admin memblokir sementara fitur upload produk, proses order, dan penarikan. Selesaikan pembayaran komisi lalu hubungi admin."
          : "Admin/sub admin sudah membuka blokir akun kamu. Fitur seller bisa digunakan kembali.",
      });
    }
    alert(blocked ? "Seller berhasil diblokir." : "Blokir seller berhasil dibuka.");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>🚫 Blokir Seller Manual</div>
      <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: "#78350F" }}>
        Blokir tidak otomatis. Admin/sub admin bisa blok seller yang belum bayar komisi, lalu buka lagi setelah pembayaran selesai/di-approve.
      </div>
      {sellers.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🏪</div><p>Belum ada seller</p></div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Seller</th><th>Status Akun</th><th>Tagihan Komisi</th><th>Status Blok</th><th>Aksi</th></tr></thead>
            <tbody>
              {sellers.map((u) => {
                const sellerId = sellerIdOf(u);
                const debt = sellerDebt(sellerId);
                const blocked = u.commissionBlocked === true;
                return (
                  <tr key={sellerId}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{u.name || "Seller"}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>{u.email || "-"}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{u.status || "active"}</td>
                    <td style={{ fontWeight: 800, color: debt > 0 ? "#EF4444" : "#10B981" }}>{rupiah(debt)}</td>
                    <td><span className={`badge ${blocked ? "badge-red" : "badge-green"}`}>{blocked ? "Diblokir" : "Aktif"}</span></td>
                    <td>
                      {blocked ? (
                        <button className="btn-primary btn-sm" style={{ background: "#10B981" }} onClick={() => toggleSellerBlock(u, false)}>Buka Blokir</button>
                      ) : (
                        <button className="btn-ghost btn-sm" style={{ color: "#B91C1C", borderColor: "#FCA5A5" }} onClick={() => toggleSellerBlock(u, true)}>Blokir Seller</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminSellerApprovals({ users = [] }) {
  const pendingSellers = users
    .filter((u) => u.role === "seller" && u.status !== "active" && u.status !== "approved" && !u.isDeleted)
    .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

  async function approveSeller(u) {
    if (u.role !== "seller") return;
    const sellerId = u.uid || u.id;
    if (!sellerId) {
      alert("ID seller tidak ditemukan.");
      return;
    }
    await updateDoc(doc(db, "users", sellerId), {
      status: "active",
      commissionBlocked: false,
      approvedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "seller_wallets", sellerId), {
      sellerId,
      sellerName: u.name || u.email || "Seller",
      saldoTersedia: 0,
      saldoTertahan: 0,
      totalPenjualan: 0,
      totalDitarik: 0,
    }, { merge: true });
    await addDoc(collection(db, "notifications"), {
      role: "seller",
      userId: sellerId,
      type: "seller_approved",
      title: "Akun Seller Disetujui ✅",
      message: "Akun seller kamu sudah disetujui admin. Sekarang kamu bisa upload produk.",
      isRead: false,
      createdAt: serverTimestamp(),
    });
    alert("Seller berhasil di-approve. Seller sekarang bisa upload produk.");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>✅ Approve Seller</div>
      {pendingSellers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Tidak ada seller menunggu approval</p>
          <p style={{ fontSize: 13, color: "var(--text3)" }}>Seller baru yang mendaftar akan muncul di sini.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {pendingSellers.map((u) => (
            <div className="card" key={u.uid || u.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{u.name || "Seller Baru"}</div>
                <div style={{ fontSize: 13, color: "var(--text3)" }}>{u.email || "-"}</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Status: <b>{u.status || "pending"}</b></div>
              </div>
              <button className="btn-primary btn-sm" onClick={() => approveSeller(u)}>Approve Seller</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminUsers({ users = [], products = [] }) {
  const [filter, setFilter] = useState("all");
  const visibleUsers = users
    .filter((u) => u.role === "buyer" || u.role === "seller" || u.role === "deleted")
    .filter((u) => filter === "all" ? true : u.role === filter)
    .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

  async function approveSeller(u) {
    if (u.role !== "seller") return;
    await updateDoc(doc(db, "users", u.uid || u.id), {
      status: "active",
      commissionBlocked: false,
      approvedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "seller_wallets", u.uid || u.id), {
      sellerId: u.uid || u.id,
      sellerName: u.name || u.email || "Seller",
      saldoTersedia: 0,
      saldoTertahan: 0,
      totalPenjualan: 0,
      totalDitarik: 0,
    }, { merge: true });
    await addDoc(collection(db, "notifications"), {
      role: "seller",
      userId: u.uid || u.id,
      type: "seller_approved",
      title: "Akun Seller Disetujui ✅",
      message: "Akun seller kamu sudah disetujui admin. Sekarang kamu bisa upload produk.",
      isRead: false,
      createdAt: serverTimestamp(),
    });
    alert("Akun seller berhasil disetujui. Seller sekarang bisa upload produk.");
  }

  async function toggleSellerBlock(u, blocked) {
    if (u.role !== "seller") return;
    const sellerId = u.uid || u.id;
    if (!sellerId) { alert("ID seller tidak ditemukan."); return; }
    const actionText = blocked ? "blokir" : "buka blokir";
    if (!confirm(`${blocked ? "Blokir" : "Buka blokir"} seller ${u.name || u.email || sellerId}?`)) return;
    await updateDoc(doc(db, "users", sellerId), {
      commissionBlocked: blocked,
      commissionBlockedAt: blocked ? serverTimestamp() : null,
      commissionUnblockedAt: !blocked ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "notifications"), {
      role: "seller",
      userId: sellerId,
      type: blocked ? "seller_commission_blocked" : "seller_commission_unblocked",
      title: blocked ? "Akun Seller Diblokir Admin 🚫" : "Blokir Seller Dibuka ✅",
      message: blocked
        ? "Admin/sub admin memblokir sementara fitur upload produk, proses order, dan penarikan. Selesaikan pembayaran komisi lalu hubungi admin."
        : "Admin/sub admin sudah membuka blokir akun kamu. Fitur seller bisa digunakan kembali.",
      isRead: false,
      createdAt: serverTimestamp(),
    });
    alert(`Seller berhasil di-${actionText}.`);
  }

  async function deleteAccount(u) {
    if (u.role !== "buyer" && u.role !== "seller") {
      alert("Hanya akun buyer atau seller yang bisa dihapus dari menu ini.");
      return;
    }
    if (!confirm(`Hapus akun ${u.name || u.email}? Akun akan dinonaktifkan dari dashboard.`)) return;
    await updateDoc(doc(db, "users", u.uid || u.id), {
      status: "deleted",
      previousRole: u.role,
      role: "deleted",
      isDeleted: true,
      deletedAt: serverTimestamp(),
    });
    if (u.role === "seller") {
      const snap = await getDocs(query(collection(db, "products"), where("sellerId", "==", u.uid || u.id)));
      await Promise.all(snap.docs.map((d) => updateDoc(doc(db, "products", d.id), { isDeleted: true, updatedAt: serverTimestamp() })));
    }
    alert("Akun berhasil dinonaktifkan. Jika ini akun seller, produk seller juga disembunyikan.");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>👥 Kelola Akun Buyer & Seller</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all", "buyer", "seller", "deleted"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
              borderColor: filter === s ? "var(--orange)" : "var(--border)",
              background: filter === s ? "var(--orange-light)" : "#fff",
              color: filter === s ? "var(--orange)" : "var(--text2)" }}>
            {s === "all" ? "Semua" : s === "buyer" ? "Buyer" : s === "seller" ? "Seller" : "Terhapus"}
          </button>
        ))}
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {visibleUsers.map((u) => (
              <tr key={u.uid || u.id}>
                <td style={{ fontWeight: 600 }}>{u.name || "-"}</td>
                <td style={{ fontSize: 13 }}>{u.email || "-"}</td>
                <td><span className="badge badge-info">{u.previousRole && u.role === "deleted" ? u.previousRole : u.role}</span></td>
                <td style={{ fontSize: 13 }}>{u.status || "active"}{u.role === "seller" && u.commissionBlocked === true && <div><span className="badge badge-red">Diblokir Komisi</span></div>}</td>
                <td>
                  {u.role === "buyer" || u.role === "seller" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {u.role === "seller" && u.status !== "active" && u.status !== "approved" && (
                        <button className="btn-primary btn-sm" onClick={() => approveSeller(u)}>Approve Seller</button>
                      )}
                      {u.role === "seller" && (u.commissionBlocked === true ? (
                        <button className="btn-primary btn-sm" style={{ background: "#10B981" }} onClick={() => toggleSellerBlock(u, false)}>Buka Blokir</button>
                      ) : (
                        <button className="btn-ghost btn-sm" style={{ color: "#B91C1C", borderColor: "#FCA5A5" }} onClick={() => toggleSellerBlock(u, true)}>Blokir Seller</button>
                      ))}
                      <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => deleteAccount(u)}>Hapus Akun</button>
                    </div>
                  ) : <span style={{ fontSize: 12, color: "var(--text3)" }}>Tidak ada aksi</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminProducts({ products }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? products : products.filter((p) => p.status === filter);

  async function approve(id) { await updateDoc(doc(db, "products", id), { status: "active" }); alert("Produk disetujui"); }
  async function reject(id) { await updateDoc(doc(db, "products", id), { status: "rejected" }); alert("Produk ditolak"); }
  async function updateCommission(id, type, value) {
    const v = prompt(`Komisi ${type === "percent" ? "persen (%):" : "nominal (Rp):"}`, "10");
    if (v === null) return;
    await updateDoc(doc(db, "products", id), { commissionType: type, commissionValue: Number(v) });
    alert("Komisi diperbarui");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Kelola Produk</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all","pending","active","rejected"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
              borderColor: filter === s ? "var(--orange)" : "var(--border)",
              background: filter === s ? "var(--orange-light)" : "#fff",
              color: filter === s ? "var(--orange)" : "var(--text2)" }}>
            {s === "all" ? "Semua" : statusLabel(s).label} ({s === "all" ? products.length : products.filter((p) => p.status === s).length})
          </button>
        ))}
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Produk</th><th>Seller</th><th>Harga</th><th>Komisi</th><th>Status</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const s = statusLabel(p.status);
              return (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <img src={p.imageUrl || ""} alt={p.productName} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover" }} />
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{p.productName}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{p.sellerName}</td>
                  <td style={{ color: "var(--orange)", fontWeight: 600 }}>{rupiah(p.price)}</td>
                  <td style={{ fontSize: 12 }}>{p.commissionType === "percent" ? `${p.commissionValue}%` : rupiah(p.commissionValue)}</td>
                  <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {p.status !== "active" && <button className="btn-primary btn-sm" onClick={() => approve(p.id)}>✅ Setujui</button>}
                      {p.status !== "rejected" && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => reject(p.id)}>Tolak</button>}
                      <button className="btn-ghost btn-sm" onClick={() => updateCommission(p.id, "percent", p.commissionValue)}>% Komisi</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminOrders({ orders, createNotif }) {
  const [filter, setFilter] = useState("all");
  const sortedOrders = sortNewest(orders);
  const filtered = filter === "all" ? sortedOrders : sortedOrders.filter((o) => o.statusPembayaran === filter || o.statusPesanan === filter);

  async function approve(o) {
    await updateDoc(doc(db, "orders", o.id), {
      statusPembayaran: "sudah_dibayar",
      statusPesanan: "pesanan_masuk",
      verifiedAt: serverTimestamp(),
      showToSeller: true,
      updatedAt: serverTimestamp(),
    });
    await createNotif({
      role: "seller",
      userId: o.sellerId,
      type: "payment_approved",
      title: "Pembayaran Buyer Disetujui",
      message: `Pembayaran ${o.productName} sudah disetujui. Saldo seller akan masuk setelah order selesai.`,
      orderId: o.id
    });
    alert("Pembayaran disetujui. Saldo seller akan masuk setelah order selesai.");
  }

  async function reject(o) {
    await restoreProductStockOnce(o);
    await cancelCashCommissionBillForOrder(o.id);
    await updateDoc(doc(db, "orders", o.id), { statusPembayaran: "ditolak", statusPesanan: "dibatalkan", updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran untuk ${o.productName} ditolak admin`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran ${o.productName} ditolak admin`, orderId: o.id });
    alert("Pembayaran ditolak");
  }

  async function approveCancel(o) {
    if (!confirm("Setujui pembatalan pesanan ini?")) return;
    await restoreProductStockOnce(o);
    await cancelCashCommissionBillForOrder(o.id);
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dibatalkan", cancelStatus: "approved", cancelApprovedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_cancel_approved", title: "Pembatalan Disetujui", message: `Pembatalan pesanan ${o.productName} disetujui admin.`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "order_cancel_approved", title: "Pesanan Dibatalkan", message: `Pesanan ${o.productName} dibatalkan oleh admin atas pengajuan buyer.`, orderId: o.id });
    alert("Pembatalan pesanan disetujui");
  }

  async function rejectCancel(o) {
    if (!confirm("Tolak pengajuan pembatalan ini?")) return;
    const backStatus = o.paymentMethod === "cash" || o.statusPembayaran === "tunai" ? "pesanan_masuk" : (o.statusPembayaran === "sudah_dibayar" ? "pesanan_masuk" : "menunggu_pembayaran");
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: backStatus, cancelRequest: false, cancelStatus: "rejected", cancelRejectedAt: serverTimestamp(), updatedAt: serverTimestamp(), cancelRejectedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_cancel_rejected", title: "Pembatalan Ditolak", message: `Pengajuan pembatalan ${o.productName} ditolak admin. Pesanan dilanjutkan.`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "order_cancel_rejected", title: "Pembatalan Ditolak", message: `Pesanan ${o.productName} tetap dilanjutkan.`, orderId: o.id });
    alert("Pengajuan pembatalan ditolak");
  }


  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🛒 Order Masuk ({orders.length})</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all","menunggu_pembayaran","menunggu_verifikasi","sudah_dibayar","pembatalan_diajukan"].map((s) => {
          const info = s === "all" ? { label: "Semua" } : statusLabel(s);
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
                borderColor: filter === s ? "var(--orange)" : "var(--border)",
                background: filter === s ? "var(--orange-light)" : "#fff",
                color: filter === s ? "var(--orange)" : "var(--text2)" }}>
              {info.label}{(s === "all" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPembayaran === s || o.statusPesanan === s).length) > 0 ? ` (${s === "all" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPembayaran === s || o.statusPesanan === s).length})` : ""}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>Tidak ada order</p></div>
      ) : filtered.map((o) => {
        const s = statusLabel(o.statusPesanan);
        const sp = statusLabel(o.statusPembayaran);
        return (
          <div key={o.id} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <img src={o.productImage || "https://via.placeholder.com/72?text=No"} alt={o.productName} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{o.productName}</span>
                  <span className={`badge ${sp.cls}`}>Bayar: {sp.label}</span>
                  <span className={`badge ${s.cls}`}>Pesanan: {s.label}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}>
                  <span>Pembeli: {o.buyerName}</span>
                  <span>WA: {o.buyerWhatsapp}</span>
                  <span>Qty: {o.quantity}</span>
                  <span>Subtotal: {rupiah(o.productTotal)}</span>
                  <span>Ongkir: {rupiah(o.shippingCost)}</span>
                  <span>Total: <b style={{ color: "var(--orange)" }}>{rupiah(o.totalAmount)}</b></span>
                  <span>Komisi: {rupiah(o.adminFee)}</span>
                  <span>{isCashPayment(o) ? "Tunai ke Seller" : "Saldo Seller"}: <b style={{ color: "#10B981" }}>{rupiah(isCashPayment(o) ? o.totalAmount : getSellerReceivableAmount(o))}</b></span>
                  <span>Kurir: {o.courierName} {o.courierService}</span>
                </div>
                {o.buyerAddress && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>📍 {o.buyerAddress}</div>}
              </div>
            </div>
            {o.paymentProofUrl && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Bukti Pembayaran:</div>
                <img src={o.paymentProofUrl} alt="Bukti" style={{ width: 200, height: 130, objectFit: "cover", borderRadius: 8, cursor: "pointer" }} onClick={() => window.open(o.paymentProofUrl, "_blank")} />
              </div>
            )}
            {o.statusPembayaran === "menunggu_verifikasi" && (
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button className="btn-primary btn-sm" onClick={() => approve(o)}>✅ Setujui Pembayaran</button>
                <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => reject(o)}>✕ Tolak</button>
              </div>
            )}
            {(o.cancelRequest || o.statusPesanan === "pembatalan_diajukan") && o.cancelStatus !== "approved" && (
              <div style={{ marginTop: 12, padding: 12, background: "#FFF8E1", borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#92400E", marginBottom: 8 }}>Buyer mengajukan pembatalan pesanan</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-primary btn-sm" onClick={() => approveCancel(o)}>Approve Pembatalan</button>
                  <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => rejectCancel(o)}>Tolak Pembatalan</button>
                </div>
              </div>
            )}
            {o.shippingType === "pickup" && o.statusPesanan !== "selesai" && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--text3)" }}>Konfirmasi ambil di tempat dilakukan oleh seller setelah pembeli datang.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminWithdraw({ withdrawals }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? withdrawals : withdrawals.filter((w) => w.status === filter);

  async function updateStatus(w, status) {
    if (w.status === status) return;
    if (w.status === "paid" || w.status === "rejected") {
      alert("Penarikan ini sudah final dan tidak bisa diubah lagi.");
      return;
    }

    const amount = Number(w.amount || 0);
    const batch = writeBatch(db);
    const withdrawalRef = doc(db, "withdrawals", w.id);
    const walletRef = doc(db, "seller_wallets", w.sellerId);
    const txRef = doc(collection(db, "wallet_transactions"));

    batch.update(withdrawalRef, { status, updatedAt: serverTimestamp() });

    if (status === "approved") {
      batch.update(withdrawalRef, { approvedAt: serverTimestamp() });
      batch.set(txRef, { sellerId: w.sellerId, withdrawalId: w.id, type: "withdraw_approved", amount, note: "Penarikan disetujui admin", createdAt: serverTimestamp() });
    }

    if (status === "paid") {
      batch.update(walletRef, { saldoTertahan: increment(-amount), totalDitarik: increment(amount), updatedAt: serverTimestamp() });
      batch.update(withdrawalRef, { paidAt: serverTimestamp() });
      batch.set(txRef, { sellerId: w.sellerId, withdrawalId: w.id, type: "withdraw_paid", amount, note: "Penarikan berhasil dibayarkan", createdAt: serverTimestamp() });
    }

    if (status === "rejected") {
      batch.update(walletRef, { saldoTersedia: increment(amount), saldoTertahan: increment(-amount), updatedAt: serverTimestamp() });
      batch.update(withdrawalRef, { rejectedAt: serverTimestamp() });
      batch.set(txRef, { sellerId: w.sellerId, withdrawalId: w.id, type: "withdraw_rejected_return", amount, note: "Penarikan ditolak/cancel, saldo dikembalikan ke saldo tersedia", createdAt: serverTimestamp() });
    }

    try {
      await batch.commit();
      alert(status === "rejected" ? "Penarikan ditolak dan saldo dikembalikan" : "Status penarikan diubah");
    } catch (error) {
      console.error("Gagal mengubah status penarikan:", error);
      alert("Gagal mengubah status penarikan. Coba lagi.");
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>💸 Penarikan Seller</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all","pending","approved","paid","rejected"].map((s) => {
          const info = s === "all" ? { label: "Semua" } : statusLabel(s);
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
                borderColor: filter === s ? "var(--orange)" : "var(--border)",
                background: filter === s ? "var(--orange-light)" : "#fff",
                color: filter === s ? "var(--orange)" : "var(--text2)" }}>
              {info.label}{(s === "all" ? withdrawals.length : withdrawals.filter((w) => w.status === s).length) > 0 ? ` (${s === "all" ? withdrawals.length : withdrawals.filter((w) => w.status === s).length})` : ""}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">💸</div><p>Tidak ada penarikan</p></div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Seller</th><th>Jumlah</th><th>Rekening</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {filtered.map((w) => {
                const s = statusLabel(w.status);
                return (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 500 }}>{w.sellerName}</td>
                    <td style={{ color: "var(--orange)", fontWeight: 700 }}>{rupiah(w.amount)}</td>
                    <td style={{ fontSize: 12 }}>
                      <div>{w.bankName}</div>
                      <div style={{ color: "var(--text3)" }}>{w.accountNumber} a.n {w.accountHolder}</div>
                    </td>
                    <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(w.accountNumber); alert("Disalin!"); }}>📋 Salin Rek</button>
                        {w.status === "pending" && <button className="btn-primary btn-sm" onClick={() => updateStatus(w, "approved")}>Setujui</button>}
                        {w.status === "approved" && <button className="btn-primary btn-sm" style={{ background: "#10B981" }} onClick={() => updateStatus(w, "paid")}>Sudah Dibayar</button>}
                        {w.status !== "rejected" && w.status !== "paid" && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => updateStatus(w, "rejected")}>Tolak</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PaymentSetting({ paymentSetting }) {
  const [form, setForm] = useState(paymentSetting || {});
  const [qrisFile, setQrisFile] = useState(null);
  const [qrisPreview, setQrisPreview] = useState(paymentSetting?.qrisUrl || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm(paymentSetting || {});
    setQrisPreview(paymentSetting?.qrisUrl || "");
  }, [paymentSetting]);

  function handleQrisFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { alert("Format QRIS harus JPG, PNG, atau WEBP"); return; }
    if (f.size > 1024 * 1024) { alert("Ukuran QRIS maksimal 1MB"); return; }
    setQrisFile(f);
    setQrisPreview(URL.createObjectURL(f));
  }

  async function save(e) {
    e.preventDefault(); setLoading(true);
    try {
      let qrisUrl = form.qrisUrl || "";
      if (qrisFile) qrisUrl = await uploadImageToCloudinary(qrisFile);
      await setDoc(doc(db, "admin_settings", "payment"), { ...form, qrisUrl, updatedAt: serverTimestamp() });
      setForm((prev) => ({ ...prev, qrisUrl }));
      setQrisFile(null);
      alert("Rekening dan QRIS admin disimpan");
    } catch (err) {
      alert(err.message || "Gagal menyimpan pengaturan pembayaran");
    }
    setLoading(false);
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>💳 Pengaturan Rekening & QRIS Admin</div>
      <div className="card" style={{ maxWidth: 520 }}>
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Nama Bank</label>
            <input className="form-input" placeholder="Contoh: BCA, BRI, Mandiri" value={form.bankName || ""} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Nomor Rekening</label>
            <input className="form-input" placeholder="1234567890" value={form.accountNumber || ""} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Atas Nama</label>
            <input className="form-input" placeholder="Nama pemegang rekening" value={form.accountHolder || ""} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Foto QRIS Admin</label>
            <input className="form-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleQrisFile} style={{ padding: 8 }} />
            {qrisPreview && (
              <div style={{ marginTop: 10 }}>
                <img src={qrisPreview} alt="Preview QRIS" style={{ width: 220, maxWidth: "100%", borderRadius: 12, border: "1px solid var(--border)", background: "#fff" }} />
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>QRIS hanya milik admin dan hanya tampil saat buyer memilih pembayaran Scan QRIS.</div>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Menyimpan..." : "Simpan Rekening & QRIS"}</button>
        </form>
      </div>
    </div>
  );
}

function ManualBalance() {
  const [amount, setAmount] = useState("");
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  async function save(e) {
    e.preventDefault(); setLoading(true);
    await setDoc(doc(db, "admin_settings", "manualBalance"), { totalSellerBalanceManual: Number(amount.replace(/\D/g, "")), isManualBalanceActive: active, updatedAt: serverTimestamp() });
    setLoading(false); alert("Saldo manual disimpan");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>⚙️ Edit Saldo Manual</div>
      <div className="card" style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, background: "var(--orange-light)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--orange)" }}>
          ⚠️ Fitur ini akan mengganti tampilan total saldo seller di dashboard admin dengan nilai manual.
        </div>
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Total Saldo Manual (Rp)</label>
            <input className="form-input" placeholder="Contoh: 1.000.000" value={amount}
              onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID"))} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--orange)" }} />
            <span>Aktifkan saldo manual</span>
          </label>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Menyimpan..." : "Simpan"}</button>
        </form>
      </div>
    </div>
  );
}

function CreateSubAdmin() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault(); setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, "users", res.user.uid), {
        uid: res.user.uid, name: form.name, email: form.email, role: "sub_admin", status: "active",
        permissions: { canViewOrders: true, canApprovePayments: true, canRejectPayments: true, canViewPaymentProof: true },
        createdAt: serverTimestamp(),
      });
      alert("Admin tambahan berhasil dibuat");
      setForm({ name: "", email: "", password: "" });
    } catch (err) { alert(err.message); }
    setLoading(false);
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>👤 Tambah Admin Order</div>
      <div className="card" style={{ maxWidth: 420 }}>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Nama Admin</label>
            <input className="form-input" placeholder="Nama lengkap" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Email Login</label>
            <input className="form-input" type="email" placeholder="admin@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input className="form-input" type="password" placeholder="Minimal 6 karakter" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Membuat..." : "Buat Admin"}</button>
        </form>
      </div>
    </div>
  );
}

/* ─── NOTIFICATION PAGE ──────────────────────── */
const NOTIF_ICONS = {
  seller_register: "🧑‍💼", user_register: "👤", order_new: "🛒", order_placed: "✅",
  order_update: "📦", order_done: "🎉", payment_proof: "📄", payment_proof_sent: "📤",
  payment_approved: "✅", payment_rejected: "❌", product_new: "📦", withdraw_new: "💸", commission_bill: "💸", commission_proof: "🧾", commission_approved: "✅", commission_cancelled: "❌", commission_auto_paid: "⚡",
};
const NOTIF_COLORS = {
  seller_register: "#6366F1", user_register: "#8B5CF6", order_new: "#EE4D2D", order_placed: "#10B981",
  order_update: "#F59E0B", order_done: "#10B981", payment_proof: "#3B82F6", payment_proof_sent: "#3B82F6",
  payment_approved: "#10B981", payment_rejected: "#EF4444", product_new: "#F59E0B", withdraw_new: "#EE4D2D", commission_bill: "#EF4444", commission_proof: "#F59E0B", commission_approved: "#10B981", commission_cancelled: "#EF4444", commission_auto_paid: "#10B981",
};

function timeAgo(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}


/* ─── LIVE CHAT BUYER–SELLER ───────────────────────── */
async function startChatWithSeller(product, user, profile) {
  if (!user || !profile) return alert("Login sebagai pembeli dulu untuk chat seller.");
  if (!product?.sellerId) return alert("Data seller tidak ditemukan.");
  if (product.sellerId === user.uid) return alert("Ini produk toko kamu sendiri.");
  const chatId = [user.uid, product.sellerId].sort().join("_");
  await setDoc(doc(db, "chats", chatId), {
    buyerId: profile.role === "buyer" ? user.uid : null,
    sellerId: product.sellerId,
    participants: [user.uid, product.sellerId],
    buyerName: profile.name || "Buyer",
    sellerName: product.sellerName || "Seller",
    productId: product.id || null,
    productName: product.productName || "Produk",
    lastMessage: "Chat dimulai",
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  alert("Chat dengan seller sudah dibuat. Buka menu Chat untuk mengirim pesan.");
}

function ChatCenter({ user, profile, createNotif, mode = "buyer", users = [] }) {
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [admins, setAdmins] = useState([]);
  const firstMsgLoadRef = useRef(true);
  const isAdminChatMode = mode === "admin";
  const isSellerChatMode = mode === "seller";

  useEffect(() => {
    if (!isSellerChatMode) return;
    getDocs(query(collection(db, "users"), where("role", "==", "admin")))
      .then((snap) => setAdmins(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((error) => {
        console.error("Gagal memuat admin untuk chat:", error);
        setAdmins([]);
      });
  }, [isSellerChatMode]);

  function getOtherName(chat) {
    if (chat?.chatType === "admin_seller") {
      if (profile?.role === "admin" || profile?.role === "sub_admin") return chat.sellerName || "Seller";
      return chat.adminName || "Admin";
    }
    return user.uid === chat.sellerId ? (chat.buyerName || "Buyer") : (chat.sellerName || "Seller");
  }

  function getChatSubtitle(chat) {
    if (chat?.chatType === "admin_seller") return "Chat Seller ↔ Admin";
    return chat?.productName || "Chat produk";
  }

  function canShowChat(chat) {
    if (!Array.isArray(chat.participants) || !chat.participants.includes(user.uid)) return false;
    if (isAdminChatMode) return chat.chatType === "admin_seller";
    if (isSellerChatMode) return true;
    return chat.chatType !== "admin_seller";
  }

  async function startAdminSellerChat(targetSeller) {
    if (!user?.uid) return;
    const sellerId = targetSeller?.uid || targetSeller?.id;
    if (!sellerId) return alert("ID seller tidak ditemukan.");
    setStartingChat(true);
    try {
      const chatId = ["admin_seller", user.uid, sellerId].join("_");
      const payload = {
        chatType: "admin_seller",
        adminId: user.uid,
        sellerId,
        participants: [user.uid, sellerId],
        adminName: profile?.name || "Admin",
        sellerName: targetSeller?.name || targetSeller?.email || "Seller",
        productId: null,
        productName: "Chat dengan Admin",
        lastMessage: "Chat admin dimulai",
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "chats", chatId), payload, { merge: true });
      const nextChat = { id: chatId, ...payload };
      setActiveChat(nextChat);
      if (createNotif) {
        await createNotif({ role: "seller", userId: sellerId, type: "chat_message", title: "Chat Admin", message: `${profile?.name || "Admin"} membuka chat dengan kamu.`, chatId });
      }
    } catch (error) {
      console.error("Gagal membuat chat admin-seller:", error);
      alert("Gagal membuka chat. Coba lagi.");
    } finally {
      setStartingChat(false);
    }
  }

  async function startChatWithAdmin() {
    if (!user?.uid || !profile) return;
    const admin = admins.find((a) => (a.uid || a.id) && a.status !== "deleted") || admins[0];
    const adminId = admin?.uid || admin?.id;
    if (!adminId) return alert("Admin belum ditemukan untuk chat.");
    setStartingChat(true);
    try {
      const chatId = ["admin_seller", adminId, user.uid].join("_");
      const payload = {
        chatType: "admin_seller",
        adminId,
        sellerId: user.uid,
        participants: [adminId, user.uid],
        adminName: admin?.name || admin?.email || "Admin",
        sellerName: profile?.name || profile?.email || "Seller",
        productId: null,
        productName: "Chat dengan Admin",
        lastMessage: "Chat admin dimulai",
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "chats", chatId), payload, { merge: true });
      const nextChat = { id: chatId, ...payload };
      setActiveChat(nextChat);
      if (createNotif) {
        await createNotif({ role: "admin", userId: adminId, type: "chat_message", title: "Chat Seller", message: `${profile?.name || "Seller"} membuka chat dengan admin.`, chatId });
      }
    } catch (error) {
      console.error("Gagal membuat chat seller-admin:", error);
      alert("Gagal membuka chat admin. Coba lagi.");
    } finally {
      setStartingChat(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "chats"), (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(canShowChat)
        .sort((a, b) => getMillis(b.updatedAt || b.lastMessageAt) - getMillis(a.updatedAt || a.lastMessageAt));
      setChats(data);
      setActiveChat((prev) => {
        if (prev?.id && data.some((c) => c.id === prev.id)) return data.find((c) => c.id === prev.id);
        return data[0] || null;
      });
    }, (error) => {
      console.error("Chats realtime error:", error);
      setChats([]);
    });
    return () => unsub();
  }, [user?.uid, mode, profile?.role]);

  useEffect(() => {
    if (!activeChat?.id) { setMessages([]); return; }
    firstMsgLoadRef.current = true;
    const unsub = onSnapshot(collection(db, "chats", activeChat.id, "messages"), (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt));
      if (!firstMsgLoadRef.current && data.some((m) => m.senderId !== user.uid && !messages.find((old) => old.id === m.id))) {
        playOrderSound();
      }
      firstMsgLoadRef.current = false;
      setMessages(data);
    }, (error) => {
      console.error("Chat messages realtime error:", error);
      setMessages([]);
    });
    return () => unsub();
  }, [activeChat?.id, user?.uid]);

  useEffect(() => {
    if (!activeChat?.id || !user?.uid) return;
    getDocs(query(collection(db, "notifications"), where("userId", "==", user.uid), where("type", "==", "chat_message"))).then((snap) => {
      snap.docs.forEach((d) => {
        const n = d.data();
        if (!n.isRead && n.chatId === activeChat.id) updateDoc(doc(db, "notifications", d.id), { isRead: true, read: true });
      });
    }).catch(() => {});
  }, [activeChat?.id, user?.uid]);

  async function sendMessage(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || !activeChat?.id || busy) return;
    setBusy(true);
    try {
      const receiverId = activeChat.participants?.find((id) => id !== user.uid);
      await addDoc(collection(db, "chats", activeChat.id, "messages"), {
        chatId: activeChat.id,
        senderId: user.uid,
        senderName: profile?.name || "User",
        receiverId: receiverId || null,
        text: value,
        isRead: false,
        unreadFor: receiverId || null,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, "chats", activeChat.id), {
        lastMessage: value,
        lastSenderId: user.uid,
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      if (receiverId && createNotif) {
        const receiverRole = activeChat.chatType === "admin_seller"
          ? (receiverId === activeChat.adminId ? "admin" : "seller")
          : "chat";
        await createNotif({ role: receiverRole, userId: receiverId, type: "chat_message", title: "Pesan Baru", message: `${profile?.name || "User"}: ${value.slice(0, 80)}`, chatId: activeChat.id });
      }
      setText("");
    } catch (err) {
      alert("Gagal mengirim pesan. Coba lagi.");
    }
    setBusy(false);
  }

  const sellers = users
    .filter((u) => u.role === "seller" && !u.isDeleted && u.status !== "deleted")
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));

  return (
    <div className="page-container chat-page" style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>💬 Live Chat</div>
        {isSellerChatMode && <button className="btn-primary btn-sm" onClick={startChatWithAdmin} disabled={startingChat}>{startingChat ? "Membuka..." : "Chat Admin"}</button>}
      </div>
      {isAdminChatMode && sellers.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Mulai chat dengan seller</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sellers.map((s) => (
              <button key={s.uid || s.id} className="btn-ghost btn-sm" onClick={() => startAdminSellerChat(s)} disabled={startingChat}>
                {s.name || s.email || "Seller"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", gap: 14 }} className="chat-layout-wrap">
        <div className="card chat-list-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: 14, fontWeight: 800, borderBottom: "1px solid var(--border)" }}>Daftar Chat</div>
          {chats.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon">💬</div>
              <p>Belum ada chat.</p>
            </div>
          ) : chats.map((c) => {
            const otherName = getOtherName(c);
            return (
              <button key={c.id} onClick={() => setActiveChat(c)}
                style={{ width: "100%", textAlign: "left", padding: 14, border: "none", borderBottom: "1px solid var(--border)", background: activeChat?.id === c.id ? "var(--orange-light)" : "#fff", cursor: "pointer" }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{otherName}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>{getChatSubtitle(c)}</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.lastMessage || "-"}</div>
              </button>
            );
          })}
        </div>
        <div className="card chat-room-card" style={{ minHeight: 460, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {activeChat ? (
            <>
              <div style={{ padding: 14, borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
                {getOtherName(activeChat)}
                <div style={{ fontWeight: 400, fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{getChatSubtitle(activeChat)}</div>
              </div>
              <div className="chat-message-area" style={{ flex: 1, padding: 14, background: "#F8FAFC", overflowY: "auto" }}>
                {messages.length === 0 ? <p style={{ color: "var(--text3)", fontSize: 13 }}>Mulai percakapan...</p> : messages.map((m) => {
                  const mine = m.senderId === user.uid;
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
                      <div style={{ maxWidth: "78%", padding: "9px 12px", borderRadius: 14, background: mine ? "var(--orange)" : "#fff", color: mine ? "#fff" : "var(--text)", boxShadow: "0 2px 8px rgba(0,0,0,.05)", fontSize: 14, lineHeight: 1.45 }}>
                        {m.text}
                      </div>
                    </div>
                  );
                })}
              </div>
              <form className="chat-input-row" onSubmit={sendMessage} style={{ padding: 12, display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
                <input className="form-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis pesan..." style={{ flex: 1 }} />
                <button className="btn-primary" disabled={busy || !text.trim()}>{busy ? "..." : "Kirim"}</button>
              </form>
            </>
          ) : (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="empty-icon">💬</div>
              <p>Pilih chat untuk mulai percakapan.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminCommissionSetting({ current, products = [] }) {
  const [value, setValue] = useState(String(current?.globalCommissionPercent || 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setValue(String(current?.globalCommissionPercent || 10)); }, [current?.globalCommissionPercent]);

  async function save(applyAll = false) {
    const percent = Number(String(value).replace(/[^0-9.]/g, ""));
    if (!percent || percent < 0 || percent > 100) return alert("Masukkan komisi 1 sampai 100%.");
    setBusy(true);
    try {
      await setDoc(doc(db, "admin_settings", "commission"), { globalCommissionPercent: percent, updatedAt: serverTimestamp() }, { merge: true });
      if (applyAll) {
        const batch = writeBatch(db);
        products.filter((p) => !p.isDeleted).forEach((p) => {
          batch.update(doc(db, "products", p.id), { commissionType: "percent", commissionValue: percent, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      alert(applyAll ? "Komisi global disimpan dan diterapkan ke semua produk." : "Komisi global disimpan untuk produk baru.");
    } catch (err) {
      alert("Gagal menyimpan komisi global.");
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>📊 Pengaturan Komisi Global</div>
      <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>Komisi dihitung per item produk. Contoh: harga Rp100.000, qty 2, komisi 10% = Rp20.000. Ongkir tidak kena komisi.</p>
      <div className="form-group">
        <label>Komisi Global Marketplace (%)</label>
        <input className="form-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="10" />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn-primary" disabled={busy} onClick={() => save(false)}>{busy ? "Menyimpan..." : "Simpan untuk Produk Baru"}</button>
        <button className="btn-outline" disabled={busy} onClick={() => save(true)}>Terapkan ke Semua Produk</button>
      </div>
    </div>
  );
}

function NotificationPage({ notifications }) {
  const [notifBusy, setNotifBusy] = useState(false);
  async function markRead(id) {
    await updateDoc(doc(db, "notifications", id), { isRead: true, read: true });
  }
  async function deleteNotif(id) {
    await deleteDoc(doc(db, "notifications", id));
  }
  async function deleteAll() {
    if (!notifications.length || notifBusy) return;
    if (!confirm("Hapus semua notifikasi?")) return;
    setNotifBusy(true);
    try {
      await Promise.all(notifications.map((n) => deleteDoc(doc(db, "notifications", n.id))));
    } finally {
      setNotifBusy(false);
    }
  }
  async function markAllRead() {
    const unreadItems = notifications.filter((n) => !n.isRead && !n.read);
    if (!unreadItems.length || notifBusy) return;
    setNotifBusy(true);
    try {
      await Promise.all(unreadItems.map((n) => updateDoc(doc(db, "notifications", n.id), { isRead: true, read: true })));
    } finally {
      setNotifBusy(false);
    }
  }

  const unread = notifications.filter((n) => !n.isRead);
  const sorted = [...notifications].sort((a, b) => {
    const ta = a.createdAt?.seconds || 0;
    const tb = b.createdAt?.seconds || 0;
    return tb - ta;
  });

  return (
    <div className="page-container" style={{ maxWidth: 680 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Notifikasi</div>
            {unread.length > 0 && (
              <span style={{ background: "var(--orange)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>
                {unread.length} belum dibaca
              </span>
            )}
          </div>
          {notifications.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              {unread.length > 0 && (
                <button className="btn-ghost btn-sm" onClick={markAllRead} disabled={notifBusy} style={{ fontSize: 12 }}>
                  {notifBusy ? "Memproses..." : "✓ Tandai Semua Dibaca"}
                </button>
              )}
              <button className="btn-ghost btn-sm" onClick={deleteAll} disabled={notifBusy} style={{ fontSize: 12, color: "#EF4444", borderColor: "#FECACA" }}>
                {notifBusy ? "Memproses..." : "🗑 Hapus Semua"}
              </button>
            </div>
          )}
        </div>
        {unread.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 6 }}>
            Kamu memiliki {unread.length} notifikasi baru yang belum dibaca.
          </p>
        )}
      </div>

      {/* Empty state */}
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔔</div>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Belum ada notifikasi</p>
          <p style={{ fontSize: 13, color: "var(--text3)" }}>Semua aktivitas akun kamu akan muncul di sini.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((n) => {
            const icon = NOTIF_ICONS[n.type] || "🔔";
            const color = NOTIF_COLORS[n.type] || "var(--orange)";
            return (
              <div
                key={n.id}
                className="card"
                style={{
                  padding: "14px 16px",
                  borderLeft: `4px solid ${n.isRead ? "var(--border)" : color}`,
                  background: n.isRead ? "#fff" : "#FFFBF9",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: n.isRead ? "#F3F4F6" : `${color}18`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                  }}>
                    {icon}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: n.isRead ? "var(--text1)" : "#111", lineHeight: 1.3 }}>
                        {n.title}
                        {!n.isRead && (
                          <span style={{ display: "inline-block", width: 7, height: 7, background: color, borderRadius: "50%", marginLeft: 6, verticalAlign: "middle" }} />
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text3)", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {timeAgo(n.createdAt)}
                      </div>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, margin: 0 }}>{n.message}</p>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                      {!n.isRead && (
                        <button
                          onClick={() => markRead(n.id)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 12, color: color, fontWeight: 600, padding: "2px 0",
                          }}
                        >
                          ✓ Tandai Dibaca
                        </button>
                      )}
                      {!n.isRead && <span style={{ color: "var(--border)", fontSize: 12 }}>|</span>}
                      <button
                        onClick={() => deleteNotif(n.id)}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 12, color: "#9CA3AF", fontWeight: 500, padding: "2px 0",
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
