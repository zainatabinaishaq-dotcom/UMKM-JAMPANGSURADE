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
} from "firebase/firestore";
import { auth, db } from "./services/firebase";
import { uploadImageToCloudinary } from "./services/cloudinary";
import "./index.css";

const complaintEmail = "umkmdigitalecommerce@gmail.com";
const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;
const formatNumberInput = (value) => String(value || "").replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const parseNumberInput = (value) => Number(String(value || "").replace(/\D/g, ""));
const getStock = (product) => Number(product?.stock ?? product?.stok ?? 0);
const isOutOfStock = (product) => getStock(product) <= 0;



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

function calcCommission(total, type, value) {
  if (type === "percent") return Math.round(total * (Number(value || 0) / 100));
  if (type === "fixed") return Number(value || 0);
  return 0;
}


const OPEN_COMMISSION_STATUSES = ["pending", "partial", "cancelled", "menunggu_approval"];
function isOpenCommissionBill(bill) {
  return OPEN_COMMISSION_STATUSES.includes(bill?.status) && Number(bill?.remaining || bill?.amount || 0) > 0;
}
function sumCommissionDebt(bills = []) {
  return bills.filter(isOpenCommissionBill).reduce((sum, bill) => sum + Number(bill.remaining || bill.amount || 0), 0);
}

async function autoDeductCommissionBills(sellerId, createNotif) {
  if (!sellerId) return;
  const walletRef = doc(db, "seller_wallets", sellerId);
  const walletSnap = await getDoc(walletRef);
  if (!walletSnap.exists()) {
    await setDoc(walletRef, { sellerId, saldoTersedia: 0, saldoTertahan: 0, totalPenjualan: 0, totalDitarik: 0, updatedAt: serverTimestamp() }, { merge: true });
    return;
  }
  let saldo = Number(walletSnap.data()?.saldoTersedia || 0);
  if (saldo <= 0) return;

  const billsSnap = await getDocs(query(collection(db, "komisi_tagihan"), where("sellerId", "==", sellerId)));
  const bills = billsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => ["pending", "partial", "cancelled"].includes(b.status) && Number(b.remaining || b.amount || 0) > 0)
    .sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt));

  for (const bill of bills) {
    if (saldo <= 0) break;
    const remaining = Number(bill.remaining || bill.amount || 0);
    const deduct = Math.min(saldo, remaining);
    const newRemaining = remaining - deduct;
    saldo -= deduct;

    const batch = writeBatch(db);
    batch.update(walletRef, {
      saldoTersedia: increment(-deduct),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "komisi_tagihan", bill.id), {
      paidFromBalance: increment(deduct),
      remaining: newRemaining,
      status: newRemaining <= 0 ? "auto_paid" : "partial",
      updatedAt: serverTimestamp(),
    });
    if (bill.orderId) {
      batch.update(doc(db, "orders", bill.orderId), {
        cashCommissionPaidFromBalance: increment(deduct),
        cashCommissionRemaining: newRemaining,
        cashCommissionStatus: newRemaining <= 0 ? "auto_paid" : "partial_paid",
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(collection(db, "wallet_transactions")), {
      sellerId,
      billId: bill.id,
      orderId: bill.orderId || null,
      type: "cash_commission_auto_deduct",
      amount: deduct,
      remaining: newRemaining,
      note: "Komisi tunai dipotong otomatis dari saldo seller",
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    if (newRemaining <= 0 && createNotif) {
      await createNotif({
        role: "seller",
        userId: sellerId,
        type: "commission_auto_paid",
        title: "Komisi Tunai Lunas Otomatis",
        message: `Tagihan komisi ${rupiah(remaining)} sudah lunas dipotong dari saldo.`,
        orderId: bill.orderId || null,
      });
    }
  }
}

async function createCashCommissionBill(orderId, orderData, createNotif) {
  const existingSnap = await getDocs(query(collection(db, "komisi_tagihan"), where("orderId", "==", orderId)));
  if (!existingSnap.empty) {
    await autoDeductCommissionBills(orderData.sellerId, createNotif);
    return;
  }
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
    status: "pending",
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
      title: "Tagihan Komisi Tunai",
      message: `Ada tagihan komisi ${rupiah(amount)} untuk ${orderData.productName}. Sistem akan memotong saldo otomatis jika saldo tersedia cukup.`,
      orderId,
    });
  }
  await autoDeductCommissionBills(orderData.sellerId, createNotif);
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
  if (m === "transfer") return "Transfer";
  return method || "Belum dipilih";
}

function canBuyerCancelOrder(order) {
  const statusPesanan = order?.statusPesanan || "";
  const statusPembayaran = order?.statusPembayaran || "";
  const shippingType = order?.shippingType || "";
  const paymentMethod = order?.paymentMethod || "";

  if (!order?.id) return false;
  if (["dikirim", "selesai", "dibatalkan", "ditolak", "pembatalan_diajukan"].includes(statusPesanan)) return false;
  if (["sudah_dibayar", "approved", "paid"].includes(statusPembayaran)) return false;
  if (shippingType === "same_day" && paymentMethod === "transfer" && statusPesanan === "dikirim") return false;
  if (["jne", "pos", "tiki", "jnt", "sicepat"].includes(shippingType) && paymentMethod === "transfer" && ["sudah_dibayar", "approved", "paid"].includes(statusPembayaran)) return false;
  return true;
}

async function creditSellerBalanceOnce(orderId, orderData) {
  if (!orderId || !orderData?.sellerId) return;
  if (orderData.balanceCredited === true) return;

  const sellerAmount = Number(orderData.sellerAmount || 0);
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
    type: "order_completed_credit",
    amount: sellerAmount,
    productTotal,
    adminFee: Number(orderData.adminFee || 0),
    note: "Saldo seller masuk setelah pesanan selesai",
    createdAt: serverTimestamp(),
  });

  batch.update(doc(db, "orders", orderId), {
    balanceCredited: true,
    balanceCreditedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

async function completeOrderAndCreditSeller(order, extra = {}) {
  if (!order?.id) return;
  await updateDoc(doc(db, "orders", order.id), {
    statusPesanan: "selesai",
    receivedAt: serverTimestamp(),
    soldCounted: true,
    updatedAt: serverTimestamp(),
    ...extra,
  });

  await creditSellerBalanceOnce(order.id, { ...order, statusPesanan: "selesai", ...extra });

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

function scrollToTopSmooth() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState(() => {
    try {
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
        const hasNewNotification = data.some((n) => !seenNotificationIdsRef.current.has(n.id));
        if (hasNewNotification) playOrderSound();
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
                  <button className="nav-user-btn" onClick={() => { signOut(auth); navGoTo("home"); }}>
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
          onLogout={() => { signOut(auth); navGoTo("home"); }} />
      )}
      {page === "seller" && profile?.role === "seller" && (
        <SellerDashboard user={user} profile={profile}
          products={products.filter((p) => p.sellerId === user.uid)}
          orders={sortOrdersByStage(orders.filter((o) => {
            const sellerProductIds = new Set(products.filter((p) => p.sellerId === user.uid).map((p) => p.id));
            return o.sellerId === user.uid || sellerProductIds.has(o.productId);
          }))}
          wallets={wallets} commissionBills={commissionBills} paymentSetting={paymentSetting} commissionSetting={commissionSetting} chatUnread={unreadChat} createNotif={createNotif}
          onLogout={() => { signOut(auth); navGoTo("home"); }} />
      )}
      {page === "admin" && (profile?.role === "admin" || profile?.role === "sub_admin") && (
        <AdminDashboard profile={profile} products={products} orders={sortOrdersByStage(orders)} withdrawals={withdrawals}
          paymentSetting={paymentSetting} manualBalance={manualBalance} commissionSetting={commissionSetting} wallets={wallets} commissionBills={commissionBills} users={allUsers} createNotif={createNotif}
          onLogout={() => { signOut(auth); navGoTo("home"); }} />
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
          paymentMethod: String(form.paymentMethod || "transfer"),
          shippingCost,
          distanceKm,
          courierName,
          courierService,
          totalAmount,
          adminFee,
          sellerAmount,
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

        if (form.paymentMethod === "cash" && !needsSellerQuote) {
          try {
            await createCashCommissionBill(ref.id, { sellerId: safeSellerId, sellerName: String(item.sellerName || ""), productName: safeProductName, adminFee }, createNotif);
          } catch (error) {
            console.error("Gagal membuat tagihan komisi tunai:", error);
          }
        }

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
    if (order.proofSubmitted || order.paymentProofUrl) { alert("Bukti pembayaran sudah pernah dikirim"); return; }
    if (!file) { alert("Pilih bukti pembayaran dulu"); return; }
    setUploadLoading(true);
    const url = await uploadImageToCloudinary(file);
    await updateDoc(doc(db, "orders", order.id), { paymentProofUrl: url, proofSubmitted: true, paymentProofUploadedAt: serverTimestamp(), statusPembayaran: "menunggu_verifikasi", updatedAt: serverTimestamp() });
    await createNotif({ role: "admin", type: "payment_proof", title: "Bukti Pembayaran Dikirim", message: `${order.buyerName} mengupload bukti pembayaran untuk ${order.productName}`, orderId: order.id });
    await createNotif({ role: "seller", userId: order.sellerId, type: "payment_proof", title: "Buyer Upload Bukti Bayar", message: `Pembeli sudah mengupload bukti pembayaran untuk ${order.productName}.`, orderId: order.id });
    setUploadLoading(false); alert("Bukti pembayaran berhasil dikirim");
  }
  async function received() {
    if (order.receivedAt) return;
    const qty = Number(order.quantity || 1);
    await completeOrderAndCreditSeller(order);
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
    if (cancelBusy || order.cancelRequest || ["selesai", "dibatalkan"].includes(order.statusPesanan)) return;
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
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>{order.statusPesanan === "dikirim" && !order.receivedAt && <button className="btn-primary btn-sm" onClick={received}>✅ Sudah Diterima</button>}{!["selesai","dibatalkan","pembatalan_diajukan"].includes(order.statusPesanan) && !order.cancelRequest && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={requestCancelOrder} disabled={cancelBusy}>{cancelBusy ? "Memproses..." : "Batalkan Pesanan"}</button>}{order.statusPesanan === "pembatalan_diajukan" && <span className="badge badge-yellow">Menunggu Approval Admin</span>}{order.statusPesanan === "selesai" && !order.reviewSubmitted && <button className="btn-outline btn-sm" onClick={() => setShowReview(!showReview)}>⭐ Beri Ulasan</button>}{order.statusPesanan === "selesai" && order.reviewSubmitted && <button className="btn-primary btn-sm" disabled style={{ background: "#111", borderColor: "#111" }}>Ulasan Terkirim</button>}</div>
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
  const hasCommissionDebt = commissionDebt > 0;
  const tabs = [
    { id: "beranda", label: "Beranda", icon: "🏠" },
    { id: "produk", label: "Produk Saya", icon: "📦" },
    { id: "tagihan", label: "Tagihan Komisi", icon: "💸" },
    { id: "order", label: "Pesanan Masuk", icon: "🛒" },
    { id: "chat", label: "Chat Buyer", icon: "💬" },
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
            {hasCommissionDebt && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 800, color: "#B91C1C", marginBottom: 4 }}>💸 Tagihan Komisi Belum Lunas</div>
                <p style={{ fontSize: 13, color: "#7F1D1D" }}>Total tagihan komisi: <b>{rupiah(commissionDebt)}</b>. Upload produk dan penarikan saldo diblokir sampai tagihan lunas atau saldo otomatis terpotong.</p>
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
        {tab === "produk" && <AddProduct user={user} profile={profile} products={products} hasCommissionDebt={hasCommissionDebt} commissionDebt={commissionDebt} commissionSetting={commissionSetting} createNotif={createNotif} />}
        {tab === "tagihan" && <SellerCommissionBills bills={sellerCommissionBills} paymentSetting={paymentSetting} createNotif={createNotif} />}
        {tab === "order" && <SellerOrders orders={orders} createNotif={createNotif} hasCommissionDebt={hasCommissionDebt} commissionDebt={commissionDebt} />}
        {tab === "chat" && <ChatCenter user={user} profile={profile} createNotif={createNotif} />}
        {tab === "withdraw" && <Withdraw user={user} profile={profile} wallet={wallet} hasCommissionDebt={hasCommissionDebt} commissionDebt={commissionDebt} createNotif={createNotif} />}
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
          <div style={{ fontSize: 18, fontWeight: 800, color: "#B91C1C", marginBottom: 8 }}>💸 Upload Produk Diblokir Sementara</div>
          <p style={{ fontSize: 14, color: "#7F1D1D", lineHeight: 1.6 }}>Kamu masih punya tagihan komisi sebesar <b>{rupiah(commissionDebt)}</b>. Lunasi tagihan dulu atau tunggu saldo otomatis dipotong.</p>
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
    if (hasCommissionDebt) { alert(`Kamu masih punya tagihan komisi ${rupiah(commissionDebt)}. Lunasi dulu sebelum upload produk.`); return; }
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
    const sellerAmount = productTotal - Number(o.adminFee || 0) + cost;
    const totalAmount = productTotal + cost;
    await updateDoc(doc(db, "orders", o.id), {
      shippingCost: cost,
      totalAmount,
      sellerAmount,
      pendingShippingQuote: false,
      statusPembayaran: o.paymentMethod === "cash" ? "tunai" : "menunggu_pembayaran",
      statusPesanan: o.paymentMethod === "cash" ? "pesanan_masuk" : "menunggu_pembayaran",
      courierService: `Ongkir: ${rupiah(cost)}`,
      updatedAt: serverTimestamp()
    });
    if (o.paymentMethod === "cash") {
      await createCashCommissionBill(o.id, { sellerId: o.sellerId, sellerName: o.sellerName || "", productName: o.productName, adminFee: o.adminFee }, createNotif);
    }
    await createNotif({ role: "buyer", userId: o.buyerId, type: "shipping_quote_ready", title: "Ongkir Sudah Dihitung", message: `Ongkir ${o.productName} adalah ${rupiah(cost)}. Silakan lanjutkan pembayaran.`, orderId: o.id });
    alert("Ongkir dikirim ke buyer");
  }

  async function processOrder(o) {
    if (hasCommissionDebt) { alert(`Akun diblokir sementara karena masih ada tagihan komisi ${rupiah(commissionDebt)}. Lunasi dulu agar bisa proses order.`); return; }
    if (isPickup(o)) {
      alert("Ambil di tempat tidak memakai proses/kirim. Konfirmasi setelah pembeli datang.");
      return;
    }
    if (o.statusPembayaran !== "sudah_dibayar" && o.paymentMethod !== "cash") { alert("Order transfer harus di-approve admin dulu"); return; }
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "diproses", processedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_processing", title: "Pesanan Diproses", message: `Pesanan ${o.productName} sedang diproses seller.`, orderId: o.id });
  }

  async function confirmPickup(o) {
    if (hasCommissionDebt) { alert(`Akun diblokir sementara karena masih ada tagihan komisi ${rupiah(commissionDebt)}. Lunasi dulu agar bisa pickup order.`); return; }
    if (!confirm("Konfirmasi hanya setelah pembeli sudah datang dan mengambil pesanan. Lanjutkan?")) return;
    await completeOrderAndCreditSeller(o, { pickupConfirmedAt: serverTimestamp() });
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
                  <span>Kurir: {o.courierName}</span>
                  <span>Saldo bersih: <b style={{ color: "#10B981" }}>{rupiah(o.sellerAmount)}</b></span>
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
    if (hasCommissionDebt) { alert(`Masih ada tagihan komisi ${rupiah(commissionDebt)}. Penarikan diblokir sampai lunas.`); return; }
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
      {hasCommissionDebt && <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 14, marginBottom: 16, color: "#B91C1C", fontSize: 13 }}>Penarikan diblokir karena ada tagihan komisi: <b>{rupiah(commissionDebt)}</b>.</div>}
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
  const openBills = bills.filter(isOpenCommissionBill);

  async function uploadProof(bill) {
    const file = proofFiles[bill.id];
    if (!file) { alert("Pilih bukti pembayaran komisi dulu"); return; }
    if (file.size > 1024 * 1024) { alert("Ukuran bukti maksimal 1MB"); return; }
    try {
      const url = await uploadImageToCloudinary(file);
      await updateDoc(doc(db, "komisi_tagihan", bill.id), {
        proofUrl: url,
        status: "menunggu_approval",
        proofUploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (bill.orderId) {
        await updateDoc(doc(db, "orders", bill.orderId), {
          cashCommissionProofUrl: url,
          cashCommissionStatus: "menunggu_approval",
          updatedAt: serverTimestamp(),
        });
      }
      await createNotif({ role: "admin", type: "commission_proof", title: "Bukti Komisi Tunai", message: `Seller mengirim bukti pembayaran komisi ${rupiah(bill.remaining || bill.amount)}`, billId: bill.id, orderId: bill.orderId || null });
      setProofFiles({ ...proofFiles, [bill.id]: null });
      alert("Bukti komisi berhasil dikirim. Menunggu approval admin.");
    } catch (error) {
      console.error("Gagal upload bukti komisi", error);
      alert("Gagal upload bukti komisi. Coba lagi.");
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>💸 Tagihan Komisi Tunai</div>
      {openBills.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">✅</div><p>Tidak ada tagihan komisi terbuka</p></div>
      ) : openBills.map((bill) => (
        <div key={bill.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800 }}>{bill.productName || "Tagihan Komisi"}</div>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>Sisa tagihan: <b style={{ color: "#EF4444" }}>{rupiah(bill.remaining || bill.amount)}</b></div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>Status: {bill.status}</div>
            </div>
            <span className={`badge ${bill.status === "menunggu_approval" ? "badge-yellow" : "badge-red"}`}>{bill.status === "menunggu_approval" ? "Menunggu Admin" : "Belum Lunas"}</span>
          </div>
          {bill.status !== "menunggu_approval" && (
            <div style={{ marginTop: 12, background: "#FFF8E1", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Bayar ke Rekening Admin</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 8 }}>
                Bank: <b>{paymentSetting?.bankName || "Belum diatur"}</b><br/>
                No Rekening: <b>{paymentSetting?.accountNumber || "-"}</b><br/>
                Atas Nama: <b>{paymentSetting?.accountHolder || "-"}</b>
              </div>
              <input className="form-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setProofFiles({ ...proofFiles, [bill.id]: e.target.files?.[0] || null })} />
              <button className="btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => uploadProof(bill)}>Kirim Bukti Komisi</button>
            </div>
          )}
          {bill.proofUrl && <img src={bill.proofUrl} alt="Bukti komisi" style={{ marginTop: 10, width: 160, height: 100, objectFit: "cover", borderRadius: 8 }} />}
        </div>
      ))}
    </div>
  );
}

function AdminCommissionBills({ bills = [], createNotif }) {
  const sorted = sortNewest(bills);

  async function approveBill(bill) {
    await updateDoc(doc(db, "komisi_tagihan", bill.id), {
      status: "approved",
      remaining: 0,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (bill.orderId) {
      await updateDoc(doc(db, "orders", bill.orderId), {
        cashCommissionStatus: "approved",
        cashCommissionRemaining: 0,
        cashCommissionApprovedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await addDoc(collection(db, "wallet_transactions"), {
      sellerId: bill.sellerId,
      billId: bill.id,
      orderId: bill.orderId || null,
      type: "cash_commission_manual_approved",
      amount: Number(bill.remaining || bill.amount || 0),
      note: "Komisi tunai disetujui admin dari bukti transfer",
      createdAt: serverTimestamp(),
    });
    await createNotif({ role: "seller", userId: bill.sellerId, type: "commission_approved", title: "Komisi Tunai Disetujui", message: `Bukti pembayaran komisi ${rupiah(bill.amount)} disetujui admin.`, billId: bill.id, orderId: bill.orderId || null });
    alert("Komisi disetujui");
  }

  async function cancelBill(bill) {
    await updateDoc(doc(db, "komisi_tagihan", bill.id), {
      status: "cancelled",
      proofUrl: "",
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (bill.orderId) {
      await updateDoc(doc(db, "orders", bill.orderId), {
        cashCommissionStatus: "cancelled",
        cashCommissionProofUrl: "",
        updatedAt: serverTimestamp(),
      });
    }
    await createNotif({ role: "seller", userId: bill.sellerId, type: "commission_cancelled", title: "Bukti Komisi Ditolak", message: `Bukti pembayaran komisi ditolak. Silakan upload ulang.`, billId: bill.id, orderId: bill.orderId || null });
    alert("Tagihan dikembalikan ke seller untuk upload ulang");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>💸 Komisi Tunai Seller</div>
      {sorted.length === 0 ? <div className="empty-state"><div className="empty-icon">💸</div><p>Belum ada tagihan komisi</p></div> : sorted.map((bill) => (
        <div key={bill.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, fontSize: 13 }}>
            <div><b>Seller</b><br/>{bill.sellerName || bill.sellerId}</div>
            <div><b>Produk</b><br/>{bill.productName || "-"}</div>
            <div><b>Tagihan</b><br/><span style={{ color: "var(--orange)", fontWeight: 800 }}>{rupiah(bill.remaining || bill.amount)}</span></div>
            <div><b>Status</b><br/><span className={`badge ${bill.status === "approved" || bill.status === "auto_paid" ? "badge-green" : bill.status === "menunggu_approval" ? "badge-yellow" : "badge-red"}`}>{bill.status}</span></div>
          </div>
          {bill.proofUrl && <img src={bill.proofUrl} alt="Bukti komisi" style={{ marginTop: 10, width: 180, height: 110, objectFit: "cover", borderRadius: 8 }} />}
          {bill.status === "menunggu_approval" && (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="btn-primary btn-sm" onClick={() => approveBill(bill)}>Approve Komisi</button>
              <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => cancelBill(bill)}>Cancel/Tolak</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AdminDashboard({ profile, products, orders, withdrawals, paymentSetting, manualBalance, commissionSetting, wallets, commissionBills = [], users, createNotif, onLogout }) {
  const [tab, setTab] = useState("order");
  const autoBalance = wallets.reduce((sum, w) => sum + Number(w.saldoTersedia || 0), 0);
  const displayedBalance = manualBalance?.isManualBalanceActive ? Number(manualBalance.totalSellerBalanceManual || 0) : autoBalance;
  const completedCommissionIncome = orders.filter((o) => o.statusPesanan === "selesai").reduce((sum, o) => sum + Number(o.adminFee || 0), 0);

  const isAdmin = profile.role === "admin";
  const isSubAdmin = profile.role === "sub_admin";
  const tabs = [
    { id: "order", label: "Order Masuk", icon: "🛒" },
    { id: "sellerApproval", label: "Approve Seller", icon: "✅" },
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
        {tab === "sellerApproval" && (isAdmin || isSubAdmin) && <AdminSellerApprovals users={users} />}
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
                <td style={{ fontSize: 13 }}>{u.status || "active"}</td>
                <td>
                  {u.role === "buyer" || u.role === "seller" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {u.role === "seller" && u.status !== "active" && u.status !== "approved" && (
                        <button className="btn-primary btn-sm" onClick={() => approveSeller(u)}>Approve Seller</button>
                      )}
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
    await updateDoc(doc(db, "orders", o.id), { statusPembayaran: "sudah_dibayar", statusPesanan: "pesanan_masuk", verifiedAt: serverTimestamp(), updatedAt: serverTimestamp(), showToSeller: true, updatedAt: serverTimestamp() });
    await setDoc(doc(db, "seller_wallets", o.sellerId), { sellerId: o.sellerId, saldoTersedia: increment(o.sellerAmount), totalPenjualan: increment(o.sellerAmount) }, { merge: true });
    await addDoc(collection(db, "wallet_transactions"), { sellerId: o.sellerId, orderId: o.id, amount: o.sellerAmount, type: "income", createdAt: serverTimestamp() });
    await autoDeductCommissionBills(o.sellerId, createNotif);
    await createNotif({ role: "seller", userId: o.sellerId, type: "payment_approved", title: "Pesanan Sudah Dibayar", message: `Pesanan ${o.productName} sudah dibayar. Saldo bersih ${rupiah(o.sellerAmount)}`, orderId: o.id });
    alert("Pembayaran disetujui");
  }

  async function reject(o) {
    await updateDoc(doc(db, "orders", o.id), { statusPembayaran: "ditolak", statusPesanan: "dibatalkan", updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran untuk ${o.productName} ditolak admin`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran ${o.productName} ditolak admin`, orderId: o.id });
    alert("Pembayaran ditolak");
  }

  async function approveCancel(o) {
    if (!confirm("Setujui pembatalan pesanan ini?")) return;
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dibatalkan", cancelStatus: "approved", cancelApprovedAt: serverTimestamp(), updatedAt: serverTimestamp(), cancelApprovedAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
                  <span>Saldo Seller: <b style={{ color: "#10B981" }}>{rupiah(o.sellerAmount)}</b></span>
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

function ChatCenter({ user, profile, createNotif }) {
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const firstMsgLoadRef = useRef(true);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "chats"), (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => Array.isArray(c.participants) && c.participants.includes(user.uid))
        .sort((a, b) => getMillis(b.updatedAt || b.lastMessageAt) - getMillis(a.updatedAt || a.lastMessageAt));
      setChats(data);
      setActiveChat((prev) => prev || data[0] || null);
    }, (error) => {
      console.error("Chats realtime error:", error);
      setChats([]);
    });
    return () => unsub();
  }, [user]);

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
        await createNotif({ role: "chat", userId: receiverId, type: "chat_message", title: "Pesan Baru", message: `${profile?.name || "User"}: ${value.slice(0, 80)}`, chatId: activeChat.id });
      }
      setText("");
    } catch (err) {
      alert("Gagal mengirim pesan. Coba lagi.");
    }
    setBusy(false);
  }

  return (
    <div className="page-container" style={{ maxWidth: 1100 }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>💬 Live Chat</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", gap: 14 }} className="chat-layout-wrap">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: 14, fontWeight: 800, borderBottom: "1px solid var(--border)" }}>Daftar Chat</div>
          {chats.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon">💬</div>
              <p>Belum ada chat.</p>
            </div>
          ) : chats.map((c) => {
            const otherName = user.uid === c.sellerId ? (c.buyerName || "Buyer") : (c.sellerName || "Seller");
            return (
              <button key={c.id} onClick={() => setActiveChat(c)}
                style={{ width: "100%", textAlign: "left", padding: 14, border: "none", borderBottom: "1px solid var(--border)", background: activeChat?.id === c.id ? "var(--orange-light)" : "#fff", cursor: "pointer" }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{otherName}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>{c.productName || "Chat"}</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.lastMessage || "-"}</div>
              </button>
            );
          })}
        </div>
        <div className="card" style={{ minHeight: 460, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {activeChat ? (
            <>
              <div style={{ padding: 14, borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
                {user.uid === activeChat.sellerId ? (activeChat.buyerName || "Buyer") : (activeChat.sellerName || "Seller")}
                <div style={{ fontWeight: 400, fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{activeChat.productName || "Chat produk"}</div>
              </div>
              <div style={{ flex: 1, padding: 14, background: "#F8FAFC", overflowY: "auto" }}>
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
              <form onSubmit={sendMessage} style={{ padding: 12, display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
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
