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
} from "firebase/firestore";
import { auth, db } from "./services/firebase";
import { uploadImageToCloudinary } from "./services/cloudinary";
import "./index.css";

const complaintEmail = "umkmdigitalecommerce@gmail.com";
const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;
const formatRating = (value) => Number(value || 0).toFixed(1);
const isApprovedStatus = (status) => status === "approved" || status === "active";


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

function playOrderSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    setTimeout(() => ctx.close?.(), 600);
  } catch (error) {
    // Browser can block autoplay before user interaction. Ignore safely.
  }
}

function calcCommission(total, type, value) {
  if (type === "percent") return Math.round(total * (Number(value || 0) / 100));
  if (type === "fixed") return Number(value || 0);
  return 0;
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
  "Jasa Lokal": ["Service Elektronik", "Tukang Bangunan", "Jasa Antar", "Laundry", "Bersih-Bersih"],
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

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState("home");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [paymentSetting, setPaymentSetting] = useState(null);
  const [manualBalance, setManualBalance] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const seenOrderIdsRef = useRef(new Set());
  const orderSoundReadyRef = useRef(false);

  async function createNotif(data) {
    await addDoc(collection(db, "notifications"), { ...data, isRead: false, createdAt: serverTimestamp() });
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db, "users", u.uid));
        setProfile(snap.exists() ? snap.data() : null);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "products"), (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Gagal memuat products:", error);
      setProducts([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "orders"), (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Gagal memuat orders:", error);
      setOrders([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "withdrawals"), (snap) => {
      setWithdrawals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Gagal memuat withdrawals:", error);
      setWithdrawals([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "seller_wallets"), (snap) => {
      setWallets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Gagal memuat seller_wallets:", error);
      setWallets([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "payment"), (snap) => {
      setPaymentSetting(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "admin_settings", "manualBalance"), (snap) => {
      setManualBalance(snap.exists() ? snap.data() : null);
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
      setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
  const activeProducts = products.filter((p) => p.status === "active" && !p.isDeleted);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: "#999", fontSize: 14 }}>Memuat aplikasi...</p>
      </div>
    );
  }

  function navGoTo(p) { setPage(p); setShowCart(false); setSelectedProduct(null); }

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
          onSuccess={() => { setCart([]); setShowCheckout(false); navGoTo("buyer"); }}
          createNotif={createNotif}
        />
      )}

      {/* PRODUCT DETAIL MODAL */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={(p) => { addToCart(p); setSelectedProduct(null); }}
          user={user}
          profile={profile}
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
      {page === "login" && <LoginPage setPage={navGoTo} />}
      {page === "register" && <RegisterPage setPage={navGoTo} createNotif={createNotif} />}
      {page === "buyer" && profile?.role === "buyer" && (
        <BuyerDashboard user={user} profile={profile} orders={orders.filter((o) => o.buyerId === user.uid)}
          products={activeProducts} paymentSetting={paymentSetting} createNotif={createNotif}
          onAddToCart={addToCart} onProductClick={setSelectedProduct} setPage={navGoTo}
          onLogout={() => { signOut(auth); navGoTo("home"); }} />
      )}
      {page === "seller" && profile?.role === "seller" && (
        <SellerDashboard user={user} profile={profile}
          products={products.filter((p) => p.sellerId === user.uid)}
          orders={orders.filter((o) => o.sellerId === user.uid)}
          wallets={wallets} createNotif={createNotif}
          onLogout={() => { signOut(auth); navGoTo("home"); }} />
      )}
      {page === "admin" && (profile?.role === "admin" || profile?.role === "sub_admin") && (
        <AdminDashboard profile={profile} products={products} orders={orders} withdrawals={withdrawals}
          paymentSetting={paymentSetting} manualBalance={manualBalance} wallets={wallets} createNotif={createNotif}
          onLogout={() => { signOut(auth); navGoTo("home"); }} />
      )}
      {page === "notif" && user && (
        <NotificationPage notifications={notifications} />
      )}

      {/* FOOTER — hidden on mobile */}
      <footer style={{ background: "#222", color: "#aaa", padding: "32px 16px", marginTop: 40 }} className="footer-desktop">
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 32, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", marginBottom: 12 }}>UMKM<span style={{ color: "var(--orange)" }}>Digital</span></div>
              <p style={{ fontSize: 13, lineHeight: 1.7 }}>Marketplace digital untuk UMKM lokal Jampang Surade. Produk lokal berkualitas, pembayaran aman.</p>
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
            © 2025 UMKM Digital Jampang Surade. Hak cipta dilindungi.
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
          <button className={`bottom-nav-item ${page === "notif" ? "active" : ""}`} onClick={() => navGoTo("notif")} style={{ position: "relative" }}>
            <span className="nav-icon">🔔</span>
            {unreadNotif > 0 && <span className="nav-badge">{unreadNotif}</span>}
            <span>Notifikasi</span>
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
  if (sortBy === "terlaris") filtered = [...filtered].sort((a, b) => (b.totalReviews || 0) - (a.totalReviews || 0));

  return (
    <div className="page-container">
      {/* HERO */}
      <div className="hero-banner">
        <div className="hero-pattern" />
        <div className="hero-pattern2">🛍️</div>
        <h1>Belanja Produk UMKM<br />Lokal Berkualitas</h1>
        <p>Temukan ribuan produk UMKM terbaik dari Jampang Surade. Dukung pengusaha lokal, belanja lebih hemat!</p>
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

function ProductCard({ product, onClick, onAddToCart, user }) {
  return (
    <div className="product-card" onClick={onClick}>
      <img src={product.imageUrl || "https://via.placeholder.com/200x200?text=No+Image"} alt={product.productName} className="product-img" />
      <div className="product-info">
        <div className="product-name">{product.productName}</div>
        <div className="product-price">{rupiah(product.price)}</div>
        <div className="product-meta">
          <span>⭐ {formatRating(product.averageRating)}</span>
          <span>·</span>
          <span>{product.totalReviews || 0} terjual</span>
        </div>
        {user && (
          <button className="add-cart-btn" onClick={(e) => { e.stopPropagation(); onAddToCart(); }}>
            + Keranjang
          </button>
        )}
      </div>
    </div>
  );
}

function ProductDetailModal({ product, onClose, onAddToCart, user, profile }) {
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
                <span style={{ fontSize: 13, color: "var(--text2)" }}>⭐ {formatRating(product.averageRating)}</span>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>| {product.totalReviews || 0} terjual</span>
                <span className={`badge ${statusLabel(product.status).cls}`}>{statusLabel(product.status).label}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}><b>Kategori:</b> {product.category}{product.subCategory ? ` / ${product.subCategory}` : ""}</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}><b>Stok:</b> {product.stock}</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}><b>Penjual:</b> {product.sellerName}</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}><b>Berat:</b> {product.weightGram}g</div>
              {product.description && <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>{product.description}</div>}
              {user && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="qty-control">
                    <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
                    <span style={{ minWidth: 32, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                    <button onClick={() => setQty(qty + 1)}>+</button>
                  </div>
                  <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => { for (let i = 0; i < qty; i++) onAddToCart(product); }}>
                    🛒 Tambah ke Keranjang
                  </button>
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
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "buyer", whatsapp: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function register(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const res = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, "users", res.user.uid), {
        uid: res.user.uid, name: form.name, email: form.email, role: form.role,
        whatsapp: form.whatsapp, status: form.role === "seller" ? "pending" : "active", createdAt: serverTimestamp(),
      });
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
            <div className="form-group">
              <label>Nama Lengkap</label>
              <input className="form-input" placeholder="Nama lengkap Anda" onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Nomor WhatsApp</label>
              <input className="form-input" placeholder="08xxxxxxxxxx" onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" type="email" placeholder="contoh@email.com" onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-input" type="password" placeholder="Minimal 6 karakter" onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Daftar sebagai</label>
              <select className="form-input" onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="buyer">Pembeli</option>
                <option value="seller">Penjual (Seller)</option>
              </select>
            </div>
            {form.role === "seller" && (
              <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E" }}>
                ✅ Akun seller bisa langsung upload produk.
              </div>
            )}
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: 13, fontSize: 15 }} disabled={loading}>
              {loading ? "Memproses..." : "Daftar Sekarang"}
            </button>
          </form>
          <div className="divider" />
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text2)" }}>
            Sudah punya akun?{" "}
            <span style={{ color: "var(--orange)", fontWeight: 600, cursor: "pointer" }} onClick={() => setPage("login")}>Masuk</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── CHECKOUT MODAL ─────────────────────────── */
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
    buyerAddress: savedAddress.buyerAddress || "",
    shippingType: "pickup",
    paymentMethod: "transfer",
    buyerMapsLink: savedAddress.buyerMapsLink || "",
    buyerVillage: savedAddress.buyerVillage || "",
    buyerDistrict: savedAddress.buyerDistrict || "",
    buyerRegency: savedAddress.buyerRegency || "",
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
        localStorage.setItem(`umkm_last_shipping_address_${user.uid}`, JSON.stringify(addressToSave));
        await setDoc(doc(db, "users", user.uid), { savedShippingAddress: addressToSave }, { merge: true });
      }

      for (const item of cart) {
        const productTotal = Number(item.price) * Number(item.quantity);
        const adminFee = calcCommission(productTotal, item.commissionType, item.commissionValue);
        let shippingCost = 0, distanceKm = 0, courierName = "Ambil di Tempat", courierService = "Gratis", statusPembayaran = "menunggu_pembayaran", statusPesanan = "menunggu_pembayaran";
        if (form.shippingType === "pickup") { statusPembayaran = "tunai"; statusPesanan = "pesanan_masuk"; }
        if (form.shippingType === "same_day") { courierName = "Same Day Lokal"; courierService = "Penjual sedang menghitung ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        if (needsAddress) { courierName = form.shippingType.toUpperCase(); courierService = "Penjual sedang cek ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        const totalAmount = productTotal + shippingCost;
        const sellerAmount = productTotal - adminFee + shippingCost;
        const ref = await addDoc(collection(db, "orders"), {
          buyerId: user.uid, sellerId: item.sellerId, productId: item.id, productName: item.productName, productImage: item.imageUrl,
          buyerName: form.buyerName, buyerWhatsapp: form.buyerWhatsapp, buyerAddress: form.buyerAddress,
          buyerMapsLink: form.buyerMapsLink || "", buyerVillage: form.buyerVillage || "", buyerDistrict: form.buyerDistrict || "", buyerRegency: form.buyerRegency || "",
          sellerMapLink: item.sellerMapLink || "", sellerAddress: item.sellerAddress || "", quantity: item.quantity,
          productTotal, shippingType: form.shippingType, paymentMethod: form.paymentMethod, shippingCost, distanceKm, courierName, courierService,
          totalAmount, adminFee, sellerAmount, statusPembayaran, statusPesanan, proofSubmitted: false, reviewSubmitted: false,
          pendingShippingQuote: needsSellerQuote, showToSeller: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        await createNotif({ role: "admin", type: "order_new", title: "Order Baru Masuk", message: `${form.buyerName} memesan ${item.productName} senilai ${rupiah(totalAmount)}`, orderId: ref.id });
        await createNotif({ role: "seller", userId: item.sellerId, type: needsSellerQuote ? "shipping_quote_needed" : "order_new", title: needsSellerQuote ? "Cek Ongkir Pesanan" : "Ada Pesanan Baru! 🎉", message: needsSellerQuote ? `Pembeli memilih ${courierName}. Input ongkir untuk ${item.productName}.` : `Pesanan baru: ${item.productName} (${item.quantity} pcs).`, orderId: ref.id });
        await createNotif({ role: "buyer", userId: user.uid, type: "order_placed", title: "Pesanan Berhasil Dibuat", message: needsSellerQuote ? `Pesanan ${item.productName} dibuat. Penjual sedang menghitung ongkir.` : `Pesanan ${item.productName} berhasil dibuat.`, orderId: ref.id });
      }
      onSuccess();
    } catch (err) { setError(err.message || "Checkout gagal. Coba lagi."); }
    setLoading(false);
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
        <div className="form-group"><label>Metode Pengiriman</label><select className="form-input" value={form.shippingType} onChange={(e) => { const nextShipping = e.target.value; setForm({ ...form, shippingType: nextShipping, paymentMethod: nextShipping === "pickup" ? "cash" : (nextShipping === "same_day" ? form.paymentMethod : "transfer") }); setShippingCheckRequested(false); }}><option value="pickup">Ambil di Tempat (Gratis)</option><option value="same_day">Same Day Lokal</option><option value="jne">JNE</option><option value="pos">POS</option><option value="tiki">TIKI</option><option value="jnt">J&T</option><option value="sicepat">SiCepat</option></select></div>
        {form.shippingType === "pickup" && <div className="form-group"><label>Metode Pembayaran</label><div className="form-input" style={{ background: "#f8fafc", color: "var(--text2)" }}>Tunai saat ambil barang</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Tidak perlu upload bukti pembayaran. Setelah order, pembeli melihat link lokasi toko dan instruksi segera ambil pesanan.</div></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Metode Pembayaran Same Day</label><select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="transfer">Transfer setelah ongkir keluar</option><option value="cash">Tunai saat barang diterima</option></select></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Link Google Maps Lokasi Anda</label><input className="form-input" placeholder="Tempel link Google Maps alamat pengiriman" value={form.buyerMapsLink} onChange={(e) => { setForm({ ...form, buyerMapsLink: e.target.value }); setShippingCheckRequested(false); }} required /><button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerMapsLink.trim()) { setError("Tempel link Google Maps Anda dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Penjual sedang menghitung ongkir. Klik Buat Pesanan untuk mengirim permintaan ke seller." : "Klik Cek Ongkir dulu. Setelah itu tombol Buat Pesanan aktif."}</div></div>}
        {needsAddress && <div style={{ background: "#FFF8E1", padding: 12, borderRadius: 8 }}><div style={{ fontWeight: 700, marginBottom: 8 }}>Alamat untuk cek ongkir</div><div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>Alamat ekspedisi akan otomatis disimpan ke profil dan terisi saat belanja berikutnya.</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}><input className="form-input" placeholder="Desa" value={form.buyerVillage} onChange={(e) => { setForm({ ...form, buyerVillage: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kecamatan" value={form.buyerDistrict} onChange={(e) => { setForm({ ...form, buyerDistrict: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kabupaten" value={form.buyerRegency} onChange={(e) => { setForm({ ...form, buyerRegency: e.target.value }); setShippingCheckRequested(false); }} required /></div><button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerVillage || !form.buyerDistrict || !form.buyerRegency) { setError("Isi desa, kecamatan, dan kabupaten dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Permintaan cek ongkir siap dikirim ke seller. Klik Buat Pesanan." : "Klik Cek Ongkir dulu agar seller mendapat perintah cek ongkir."}</div></div>}
      </div><div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Batal</button><button type="submit" className="btn-primary" disabled={loading || (needsSellerQuote && !shippingCheckRequested)}>{loading ? "Memproses..." : "Buat Pesanan"}</button></div></form>
    </div></div>
  );
}


/* ─── BUYER DASHBOARD ────────────────────────── */
function BuyerDashboard({ user, profile, orders, products, paymentSetting, createNotif, onAddToCart, onProductClick, setPage, onLogout }) {
  const [tab, setTab] = useState("beranda");
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
            <span>{t.icon}</span> {t.label}
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
              {info.label}
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
    await updateDoc(doc(db, "orders", order.id), { statusPesanan: "selesai", receivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "seller", userId: order.sellerId, type: "order_done", title: "Pesanan Selesai ✅", message: `${order.buyerName} telah mengkonfirmasi penerimaan ${order.productName}.`, orderId: order.id });
    setShowReview(true);
  }
  async function sendReview() {
    if (order.reviewSubmitted) { alert("Ulasan sudah dikirim"); return; }
    await addDoc(collection(db, "reviews"), { orderId: order.id, productId: order.productId, sellerId: order.sellerId, buyerId: order.buyerId, buyerName: order.buyerName, rating: Number(rating), comment, createdAt: serverTimestamp() });
    await updateDoc(doc(db, "products", order.productId), { totalReviews: increment(1), averageRating: Number(rating) });
    await updateDoc(doc(db, "orders", order.id), { reviewSubmitted: true, updatedAt: serverTimestamp() });
    await createNotif({ role: "seller", userId: order.sellerId, type: "review_new", title: "Ulasan Baru ⭐", message: `${order.buyerName} memberi rating ${rating} bintang untuk ${order.productName}.`, orderId: order.id });
    alert("Ulasan berhasil dikirim"); setShowReview(false);
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <img src={order.productImage || "https://via.placeholder.com/80?text=No"} alt={order.productName} style={{ width: 80, height: 80, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}><span style={{ fontWeight: 700, fontSize: 15 }}>{order.productName}</span><span className={`badge ${s.cls}`}>{s.label}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}><span>Qty: {order.quantity}</span><span>Subtotal: {rupiah(order.productTotal)}</span><span>Ongkir: {rupiah(order.shippingCost)}</span><span>Total: <b style={{ color: "var(--orange)" }}>{rupiah(order.totalAmount)}</b></span><span>Kurir: {order.courierName}</span>{order.trackingNumber && <span>Resi: <b>{order.trackingNumber}</b></span>}</div>
          {order.sellerMapLink && order.shippingType === "pickup" && <div style={{ marginTop: 8, fontSize: 13 }}><b>Link lokasi toko:</b> <a href={order.sellerMapLink} target="_blank" rel="noreferrer">Buka Google Maps</a><div style={{ color: "var(--orange)", fontWeight: 700 }}>Segera ambil pesanan anda</div></div>}
          {order.buyerMapsLink && <div style={{ marginTop: 8, fontSize: 13 }}><b>Link lokasi Anda:</b> <a href={order.buyerMapsLink} target="_blank" rel="noreferrer">Buka Maps</a></div>}
          {order.statusPembayaran === "menunggu_ongkir" && <div style={{ marginTop: 8, padding: 10, background: "#FFF8E1", borderRadius: 8, color: "#92400E", fontSize: 13 }}>Penjual sedang menghitung ongkir. Tombol pembayaran aktif setelah ongkir dikirim.</div>}
          {order.trackingNumber && <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(order.trackingNumber)}>Salin Resi</button><a className="btn-primary btn-sm" href="https://parcelsapp.com/id" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Lacak Paket</a></div>}
        </div>
      </div>
      {order.paymentProofUrl && <div style={{ marginTop: 10 }}><img src={order.paymentProofUrl} alt="Bukti" style={{ width: 180, height: 120, objectFit: "cover", borderRadius: 8 }} /></div>}
      {order.statusPesanan === "menunggu_pembayaran" && order.statusPembayaran !== "menunggu_ongkir" && !order.proofSubmitted && !order.paymentProofUrl && order.paymentMethod === "transfer" && order.shippingType !== "pickup" && <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}><div style={{ background: "#FFF8E1", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}><div style={{ fontWeight: 700, marginBottom: 6 }}>Rekening Pembayaran</div><div>Bank: <b>{paymentSetting?.bankName || "Belum diatur admin"}</b></div><div>No Rekening: <b>{paymentSetting?.accountNumber || "-"}</b></div><div>Atas Nama: <b>{paymentSetting?.accountHolder || "-"}</b></div><div style={{ color: "var(--orange)", fontWeight: 700, marginTop: 6 }}>Jika sudah bayar kirimkan bukti pembayaran</div></div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Upload Bukti Pembayaran</div><div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files[0]?.size > 1024*1024) { alert("Maks 1MB"); return; } setFile(e.target.files[0]); }} style={{ fontSize: 13, flex: 1 }} /><button className="btn-primary btn-sm" onClick={uploadProof} disabled={uploadLoading}>{uploadLoading ? "Mengirim..." : "Kirim Bukti"}</button></div></div>}
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>{order.statusPesanan === "dikirim" && !order.receivedAt && <button className="btn-primary btn-sm" onClick={received}>✅ Sudah Sampai</button>}{order.statusPesanan === "selesai" && !order.reviewSubmitted && <button className="btn-outline btn-sm" onClick={() => setShowReview(!showReview)}>⭐ Beri Ulasan</button>}</div>
      {showReview && !order.reviewSubmitted && <div style={{ marginTop: 14, padding: 14, background: "var(--bg)", borderRadius: 8 }}><div style={{ fontWeight: 600, marginBottom: 8 }}>Beri Ulasan</div><div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{[1,2,3,4,5].map((r) => <button key={r} onClick={() => setRating(r)} style={{ background: rating >= r ? "#F59E0B" : "#fff", border: "1.5px solid", borderColor: rating >= r ? "#F59E0B" : "var(--border)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>⭐</button>)}</div><textarea className="form-input" rows={2} placeholder="Tulis komentar Anda..." value={comment} onChange={(e) => setComment(e.target.value)} style={{ marginBottom: 8 }} /><button className="btn-primary btn-sm" onClick={sendReview}>Kirim Ulasan</button></div>}
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
        {[["Email", profile?.email],["WhatsApp", profile?.whatsapp || "-"],["Status Akun", isApprovedStatus(profile?.status) ? "✅ Aktif" : profile?.status]].map(([l,v]) => (
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
function SellerDashboard({ user, profile, products = [], orders = [], wallets = [], createNotif, onLogout }) {
  const [tab, setTab] = useState("beranda");
  const sellerProducts = Array.isArray(products) ? products : [];
  const sellerOrders = Array.isArray(orders) ? orders : [];
  const wallet = (Array.isArray(wallets) ? wallets : []).find((w) => w?.sellerId === user?.uid);
  const tabs = [
    { id: "beranda", label: "Beranda", icon: "🏠" },
    { id: "produk", label: "Produk Saya", icon: "📦" },
    { id: "order", label: "Pesanan Masuk", icon: "🛒" },
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
        {tab === "beranda" && (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Dashboard Toko 🏪</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 28 }}>
              {[
                { label: "Total Produk", value: sellerProducts.length, icon: "📦", color: "#EE4D2D" },
                { label: "Produk Aktif", value: sellerProducts.filter((p) => p?.status === "active").length, icon: "✅", color: "#10B981" },
                { label: "Total Order", value: sellerOrders.length, icon: "🛒", color: "#3B82F6" },
                { label: "Saldo Tersedia", value: rupiah(wallet?.saldoTersedia || 0), icon: "💰", color: "#F59E0B" },
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
                <p style={{ fontSize: 13, color: "#78350F" }}>Akun seller Anda sedang dalam proses verifikasi oleh admin. Anda sudah bisa menambahkan produk, namun produk akan aktif setelah admin menyetujui.</p>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: 12 }}>📊 Order Terbaru</div>
                {sortNewest(sellerOrders).slice(0, 4).map((o) => (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <span style={{ color: "var(--text2)" }}>{o.productName}</span>
                    <span className={`badge ${statusLabel(o.statusPesanan).cls}`}>{statusLabel(o.statusPesanan).label}</span>
                  </div>
                ))}
                {sellerOrders.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>Belum ada order</p>}
              </div>
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: 12 }}>📦 Produk Terbaru</div>
                {sellerProducts.slice(0, 4).map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                    <span style={{ color: "var(--text2)" }}>{p.productName}</span>
                    <span className={`badge ${statusLabel(p.status).cls}`}>{statusLabel(p.status).label}</span>
                  </div>
                ))}
                {sellerProducts.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>Belum ada produk</p>}
              </div>
            </div>
          </div>
        )}
        {tab === "produk" && <AddProduct user={user} profile={profile} products={sellerProducts} createNotif={createNotif} />}
        {tab === "order" && <SellerOrders orders={sellerOrders} createNotif={createNotif} />}
        {tab === "withdraw" && <Withdraw user={user} profile={profile} wallet={wallet} createNotif={createNotif} />}
        {tab === "profil" && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🏪 Profil Toko</div>
            <div className="card" style={{ maxWidth: 480 }}>
              {[["Nama Toko", profile?.name],["Email", profile?.email],["WhatsApp", profile?.whatsapp || "-"],["Status", isApprovedStatus(profile?.status) ? "✅ Aktif" : "⏳ Pending"],["Saldo Tersedia", rupiah(wallet?.saldoTersedia || 0)],["Total Penjualan", rupiah(wallet?.totalPenjualan || 0)]].map(([l,v]) => (
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

function AddProduct({ user, profile, products = [], createNotif }) {
  const sellerApproved = isApprovedStatus(profile?.status);
  const safeProducts = Array.isArray(products) ? products : [];
  const [form, setForm] = useState({ productName: "", category: "", subCategory: "", price: "", stock: "", description: "", weightGram: "", sellerAddress: "", sellerLatitude: "", sellerLongitude: "", sellerMapLink: "" });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { alert("Ukuran gambar maksimal 1MB"); return; }
    setFile(f); setPreview(URL.createObjectURL(f));
  }

  async function submit(e) {
    e.preventDefault();
    if (!sellerApproved) { alert("Akun seller belum disetujui admin. Kamu belum bisa upload produk."); return; }
    if (!file) { alert("Pilih gambar dulu"); return; }
    setLoading(true);
    const imageUrl = await uploadImageToCloudinary(file);
    const ref = await addDoc(collection(db, "products"), {
      sellerId: user.uid, sellerName: profile.name, productName: form.productName, category: form.category, subCategory: form.subCategory,
      price: Number(form.price), stock: Number(form.stock), description: form.description,
      weightGram: Number(form.weightGram || 1000), sellerAddress: form.sellerAddress,
      sellerLatitude: Number(form.sellerLatitude || 0), sellerLongitude: Number(form.sellerLongitude || 0), sellerMapLink: form.sellerMapLink,
      imageUrl, status: (form.category === "Jasa Lokal" && form.subCategory === "Jasa Pijat") ? "pending" : "active", isDeleted: false, commissionType: "percent", commissionValue: 10,
      averageRating: 0, totalReviews: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await createNotif({ role: "admin", type: "product_new", title: "Produk Baru", message: `${profile.name} upload produk ${form.productName}`, productId: ref.id });
    setLoading(false); setShowForm(false); setFile(null); setPreview("");
    alert((form.category === "Jasa Lokal" && form.subCategory === "Jasa Pijat") ? "Jasa Pijat berhasil diupload dan menunggu approval admin." : "Produk berhasil diupload dan langsung aktif.");
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
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>📦 Produk Saya ({safeProducts.filter((p) => !p?.isDeleted).length})</div>
        <button className="btn-primary" disabled={!sellerApproved} onClick={() => { if (!sellerApproved) { alert("Akun seller belum disetujui admin."); return; } setShowForm(!showForm); }}>+ Tambah Produk</button>
      </div>
      {showForm && sellerApproved && (
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
              <input className="form-input" type="number" placeholder="Contoh: 25000" onChange={(e) => setForm({ ...form, price: e.target.value })} required />
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
            <div className="form-group">
              <label>Latitude (opsional)</label>
              <input className="form-input" placeholder="-6.xxx" onChange={(e) => setForm({ ...form, sellerLatitude: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Longitude (opsional)</label>
              <input className="form-input" placeholder="106.xxx" onChange={(e) => setForm({ ...form, sellerLongitude: e.target.value })} />
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
      {!sellerApproved && (
        <div className="card" style={{ border: "1px solid #F59E0B", background: "#FFF8E1", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, color: "#92400E", marginBottom: 6 }}>⏳ Akun seller belum disetujui</div>
          <p style={{ fontSize: 13, color: "#78350F" }}>Produk tetap bisa dilihat di sini, tapi upload produk diblokir sampai admin approve akun seller kamu.</p>
        </div>
      )}
      {safeProducts.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📦</div><p>Belum ada produk</p></div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Produk</th><th>Kategori</th><th>Harga</th><th>Stok</th><th>Status</th><th>Rating</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {safeProducts.filter((p) => !p?.isDeleted).map((p) => {
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
                    <td>⭐ {formatRating(p.averageRating)}</td>
                    <td><button className="btn-ghost btn-sm" onClick={() => quickEditProduct(p)}>Edit</button> <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => softDeleteProduct(p)}>Hapus</button></td>
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

function SellerOrders({ orders, createNotif }) {
  const sortedOrders = sortNewest(orders);
  const [shipForm, setShipForm] = useState({});
  const [quoteForm, setQuoteForm] = useState({});
  async function quoteShipping(o) {
    const cost = Number(String(quoteForm[o.id] || "").replace(/\D/g, ""));
    if (!cost || cost < 0) { alert("Isi harga ongkir dulu"); return; }
    const productTotal = Number(o.productTotal || 0);
    const sellerAmount = productTotal - Number(o.adminFee || 0) + cost;
    const totalAmount = productTotal + cost;
    await updateDoc(doc(db, "orders", o.id), { shippingCost: cost, totalAmount, sellerAmount, pendingShippingQuote: false, statusPembayaran: o.paymentMethod === "cash" ? "tunai" : "menunggu_pembayaran", statusPesanan: o.paymentMethod === "cash" ? "pesanan_masuk" : "menunggu_pembayaran", courierService: `Ongkir: ${rupiah(cost)}`, updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "shipping_quote_ready", title: "Ongkir Sudah Dihitung", message: `Ongkir ${o.productName} adalah ${rupiah(cost)}. Silakan lanjutkan pembayaran.`, orderId: o.id });
    alert("Ongkir dikirim ke buyer");
  }
  async function processOrder(o) {
    if (o.statusPembayaran !== "sudah_dibayar" && o.paymentMethod !== "cash") { alert("Order transfer harus di-approve admin dulu"); return; }
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "diproses", processedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_processing", title: "Pesanan Diproses", message: `Pesanan ${o.productName} sedang diproses seller.`, orderId: o.id });
  }
  async function sendTracking(o) {
    const data = shipForm[o.id] || {};
    if (!data.expeditionName || !data.trackingNumber) { alert("Isi nama ekspedisi dan nomor resi"); return; }
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dikirim", expeditionName: data.expeditionName, trackingNumber: data.trackingNumber, shippedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_shipped", title: "Pesanan Dikirim 🚚", message: `Pesanan ${o.productName} dikirim via ${data.expeditionName}. Resi: ${data.trackingNumber}`, orderId: o.id });
    alert("Resi berhasil dikirim ke buyer");
  }
  return (
    <div><div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>🛒 Pesanan Masuk ({sortedOrders.length})</div>{sortedOrders.length === 0 ? <div className="empty-state"><div className="empty-icon">🛒</div><p>Belum ada pesanan masuk</p></div> : sortedOrders.map((o) => { const s = statusLabel(o.statusPesanan); const needQuote = o.statusPembayaran === "menunggu_ongkir" || o.pendingShippingQuote; return <div key={o.id} className="card" style={{ marginBottom: 14 }}><div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}><img src={o.productImage || "https://via.placeholder.com/72?text=No"} alt={o.productName} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} /><div style={{ flex: 1 }}><div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}><span style={{ fontWeight: 700, fontSize: 15 }}>{o.productName}</span><span className={`badge ${s.cls}`}>{s.label}</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}><span>Pembeli: {o.buyerName}</span><span>WA: {o.buyerWhatsapp}</span><span>Qty: {o.quantity}</span><span>Subtotal: {rupiah(o.productTotal)}</span><span>Ongkir: {rupiah(o.shippingCost)}</span><span>Total Bayar: <b style={{ color: "var(--orange)" }}>{rupiah(o.totalAmount)}</b></span><span>Kurir: {o.courierName}</span><span>Saldo bersih: <b style={{ color: "#10B981" }}>{rupiah(o.sellerAmount)}</b></span></div>{o.buyerAddress && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>📍 {o.buyerAddress}</div>}{o.sellerMapLink && o.shippingType === "pickup" && <div style={{ fontSize: 12, marginTop: 6 }}>Link lokasi toko: <button type="button" className="btn-primary btn-sm" onClick={() => window.open(o.sellerMapLink, "_blank")} style={{ marginLeft: 6 }}>Buka Maps Toko</button><br/><b>Siapkan pesanannya dan lakukan konfirmasi setelah pembeli datang.</b></div>}{o.buyerMapsLink && <div style={{ fontSize: 12, marginTop: 6 }}>Maps pembeli: <button type="button" className="btn-primary btn-sm" onClick={() => window.open(o.buyerMapsLink, "_blank")} style={{ marginLeft: 6 }}>Buka Maps Pembeli</button></div>}{(o.buyerVillage || o.buyerDistrict || o.buyerRegency) && <div style={{ fontSize: 12, marginTop: 6 }}>Alamat ongkir: {o.buyerVillage}, {o.buyerDistrict}, {o.buyerRegency} <button type="button" className="btn-primary btn-sm" onClick={() => window.open("https://rajaongkir.com/cek-ongkir", "_blank")} style={{ marginLeft: 8 }}>Cek Ongkir</button></div>}</div></div>{o.paymentProofUrl && <div style={{ marginTop: 10 }}><img src={o.paymentProofUrl} alt="Bukti" style={{ width: 160, height: 100, objectFit: "cover", borderRadius: 8 }} /></div>}{needQuote && <div style={{ marginTop: 12, padding: 12, background: "#FFF8E1", borderRadius: 8 }}><div style={{ fontWeight: 700, marginBottom: 8 }}>{o.shippingType === "same_day" ? "Isi Ongkir Same Day" : "Isi Ongkir Ekspedisi"}</div>{o.shippingType !== "same_day" && <button type="button" className="btn-primary btn-sm" style={{ marginBottom: 8 }} onClick={() => window.open("https://rajaongkir.com/cek-ongkir", "_blank")}>Cek Ongkir</button>}<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input className="form-input" style={{ maxWidth: 220 }} placeholder="Harga ongkir, contoh 15000" value={quoteForm[o.id] || ""} onChange={(e) => setQuoteForm({ ...quoteForm, [o.id]: Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID") })} /><button className="btn-primary btn-sm" onClick={() => quoteShipping(o)}>Kirim Ongkir</button></div></div>}<div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>{!needQuote && o.statusPesanan === "pesanan_masuk" && <button className="btn-primary btn-sm" onClick={() => processOrder(o)}>🔄 Proses</button>}{o.statusPesanan === "diproses" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><input className="form-input" style={{ maxWidth: 180 }} placeholder="Nama ekspedisi" value={shipForm[o.id]?.expeditionName || ""} onChange={(e) => setShipForm({ ...shipForm, [o.id]: { ...(shipForm[o.id] || {}), expeditionName: e.target.value } })} /><input className="form-input" style={{ maxWidth: 180 }} placeholder="Nomor resi" value={shipForm[o.id]?.trackingNumber || ""} onChange={(e) => setShipForm({ ...shipForm, [o.id]: { ...(shipForm[o.id] || {}), trackingNumber: e.target.value } })} /><button className="btn-primary btn-sm" style={{ background: "#3B82F6" }} onClick={() => sendTracking(o)}>🚚 Kirim Resi</button></div>}</div></div>; })}</div>
  );
}


function Withdraw({ user, profile, wallet, createNotif }) {
  const [amountText, setAmountText] = useState("");
  const [form, setForm] = useState({ bankName: "", accountNumber: "", accountHolder: "" });
  const [loading, setLoading] = useState(false);
  const amount = Number(amountText.replace(/\D/g, ""));

  async function submit(e) {
    e.preventDefault();
    if (amount < 10000) { alert("Minimal penarikan adalah Rp10.000"); return; }
    setLoading(true);
    const ref = await addDoc(collection(db, "withdrawals"), { sellerId: user.uid, sellerName: profile.name, amount, bankName: form.bankName, accountNumber: form.accountNumber, accountHolder: form.accountHolder, status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "admin", type: "withdraw_new", title: "Penarikan Baru", message: `Penarikan baru dari ${profile.name} sebesar ${rupiah(amount)} ke ${form.bankName}`, withdrawalId: ref.id });
    setLoading(false); setAmountText(""); setForm({ bankName: "", accountNumber: "", accountHolder: "" });
    alert("Pengajuan penarikan berhasil dikirim");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>💰 Penarikan Saldo</div>
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
function AdminDashboard({ profile, products, orders, withdrawals, paymentSetting, manualBalance, wallets, createNotif, onLogout }) {
  const [tab, setTab] = useState("order");
  const autoBalance = wallets.reduce((sum, w) => sum + Number(w.saldoTersedia || 0), 0);
  const displayedBalance = manualBalance?.isManualBalanceActive ? Number(manualBalance.totalSellerBalanceManual || 0) : autoBalance;

  const isAdmin = profile.role === "admin";
  const tabs = [
    { id: "order", label: "Order Masuk", icon: "🛒" },
    ...(isAdmin ? [
      { id: "produk", label: "Kelola Produk", icon: "📦" },
      { id: "withdraw", label: "Penarikan", icon: "💰" },
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
            { label: "Total Produk", value: sellerProducts.length, icon: "📦", color: "#EE4D2D" },
            { label: "Total Order", value: sellerOrders.length, icon: "🛒", color: "#3B82F6" },
            { label: "Penarikan", value: withdrawals.length, icon: "💸", color: "#F59E0B" },
            { label: "Saldo Seller", value: rupiah(displayedBalance), icon: "💰", color: "#10B981" },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <div className="stat-icon" style={{ background: s.color + "15" }}><span>{s.icon}</span></div>
              <div style={{ fontWeight: 700, color: s.color, fontSize: s.label === "Saldo Seller" ? 14 : 22 }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
        {tab === "order" && <AdminOrders orders={orders} createNotif={createNotif} />}
        {tab === "produk" && isAdmin && <AdminProducts products={products} />}
        {tab === "withdraw" && isAdmin && <AdminWithdraw withdrawals={withdrawals} />}
        {tab === "payment" && isAdmin && <PaymentSetting paymentSetting={paymentSetting} />}
        {tab === "balance" && isAdmin && <ManualBalance />}
        {tab === "admins" && isAdmin && <CreateSubAdmin />}
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
    await updateDoc(doc(db, "orders", o.id), { statusPembayaran: "sudah_dibayar", statusPesanan: "pesanan_masuk", showToSeller: true, updatedAt: serverTimestamp() });
    await setDoc(doc(db, "seller_wallets", o.sellerId), { sellerId: o.sellerId, saldoTersedia: increment(o.sellerAmount), totalPenjualan: increment(o.sellerAmount) }, { merge: true });
    await addDoc(collection(db, "wallet_transactions"), { sellerId: o.sellerId, orderId: o.id, amount: o.sellerAmount, type: "income", createdAt: serverTimestamp() });
    await createNotif({ role: "seller", userId: o.sellerId, type: "payment_approved", title: "Pesanan Sudah Dibayar", message: `Pesanan ${o.productName} sudah dibayar. Saldo bersih ${rupiah(o.sellerAmount)}`, orderId: o.id });
    alert("Pembayaran disetujui");
  }

  async function reject(o) {
    await updateDoc(doc(db, "orders", o.id), { statusPembayaran: "ditolak", statusPesanan: "dibatalkan", updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran untuk ${o.productName} ditolak admin`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran ${o.productName} ditolak admin`, orderId: o.id });
    alert("Pembayaran ditolak");
  }

  async function confirmPickup(o) {
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "selesai", pickupConfirmedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "pickup_confirmed", title: "Pesanan Diambil", message: `Pesanan ${o.productName} sudah dikonfirmasi. Silakan beri ulasan bintang dan komentar.`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "pickup_confirmed", title: "Ambil di Tempat Dikonfirmasi", message: `Pesanan ${o.productName} sudah dikonfirmasi admin.`, orderId: o.id });
    alert("Pesanan ambil di tempat dikonfirmasi");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🛒 Order Masuk ({orders.length})</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all","menunggu_pembayaran","menunggu_verifikasi","sudah_dibayar"].map((s) => {
          const info = s === "all" ? { label: "Semua" } : statusLabel(s);
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
                borderColor: filter === s ? "var(--orange)" : "var(--border)",
                background: filter === s ? "var(--orange-light)" : "#fff",
                color: filter === s ? "var(--orange)" : "var(--text2)" }}>
              {info.label}
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
            {o.shippingType === "pickup" && !o.pickupConfirmedAt && o.statusPesanan !== "selesai" && (
              <div style={{ marginTop: 12 }}>
                <button className="btn-primary btn-sm" onClick={() => confirmPickup(o)}>✅ Konfirmasi Pembeli Sudah Datang</button>
              </div>
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
    await updateDoc(doc(db, "withdrawals", w.id), { status, updatedAt: serverTimestamp() });
    alert("Status penarikan diubah");
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
              {info.label}
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
  const [loading, setLoading] = useState(false);

  async function save(e) {
    e.preventDefault(); setLoading(true);
    await setDoc(doc(db, "admin_settings", "payment"), { ...form, updatedAt: serverTimestamp() });
    setLoading(false); alert("Rekening pembayaran disimpan");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>💳 Pengaturan Rekening Pembayaran</div>
      <div className="card" style={{ maxWidth: 480 }}>
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
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Menyimpan..." : "Simpan Rekening"}</button>
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
  payment_approved: "✅", payment_rejected: "❌", product_new: "📦", withdraw_new: "💸",
};
const NOTIF_COLORS = {
  seller_register: "#6366F1", user_register: "#8B5CF6", order_new: "#EE4D2D", order_placed: "#10B981",
  order_update: "#F59E0B", order_done: "#10B981", payment_proof: "#3B82F6", payment_proof_sent: "#3B82F6",
  payment_approved: "#10B981", payment_rejected: "#EF4444", product_new: "#F59E0B", withdraw_new: "#EE4D2D",
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

function NotificationPage({ notifications }) {
  async function markRead(id) { await updateDoc(doc(db, "notifications", id), { isRead: true }); }
  async function deleteNotif(id) { await deleteDoc(doc(db, "notifications", id)); }
  async function deleteAll() { for (const n of notifications) await deleteDoc(doc(db, "notifications", n.id)); }
  async function markAllRead() { for (const n of notifications) await updateDoc(doc(db, "notifications", n.id), { isRead: true }); }

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
                <button className="btn-ghost btn-sm" onClick={markAllRead} style={{ fontSize: 12 }}>
                  ✓ Tandai Semua Dibaca
                </button>
              )}
              <button className="btn-ghost btn-sm" onClick={deleteAll} style={{ fontSize: 12, color: "#EF4444", borderColor: "#FECACA" }}>
                🗑 Hapus Semua
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
