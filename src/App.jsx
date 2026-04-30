import { useEffect, useState } from "react";
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

const complaintEmail = "umkmdigitalecommerce@gmail.com";

const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;

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
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((Number(lat1) * Math.PI) / 180) *
      Math.cos((Number(lat2) * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calculateSameDayShipping(distanceKm) {
  if (distanceKm <= 40) return 10000;
  return 10000 + Math.ceil(distanceKm - 40) * 2000;
}

async function getOngkirAPI(originCityId, destinationCityId, weightGram, courier) {
  const res = await fetch("/api/ongkir", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      origin: originCityId,
      destination: destinationCityId,
      weight: weightGram,
      courier,
    }),
  });

  const data = await res.json();

  if (!data.rajaongkir?.results?.[0]?.costs) {
    throw new Error("Ongkir gagal dihitung. Cek kurir atau ID kota.");
  }

  return data.rajaongkir.results[0].costs;
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

  async function createNotif(data) {
    await addDoc(collection(db, "notifications"), {
      ...data,
      isRead: false,
      createdAt: serverTimestamp(),
    });
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
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "orders"), (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "withdrawals"), (snap) => {
      setWithdrawals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "seller_wallets"), (snap) => {
      setWallets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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

  if (loading) return <div style={styles.center}>Loading...</div>;

  const activeProducts = products.filter((p) => p.status === "active");

  return (
    <div style={styles.app}>
      <nav style={styles.nav}>
        <b style={styles.logo}>UMKM Digital</b>

        <div style={styles.navLinks}>
          <button onClick={() => setPage("home")}>Home</button>

          {user && (
            <button onClick={() => setPage("notif")}>
              Notif ({notifications.filter((n) => !n.isRead).length})
            </button>
          )}

          {!user && <button onClick={() => setPage("login")}>Login</button>}
          {!user && <button onClick={() => setPage("register")}>Daftar</button>}

          {profile?.role === "buyer" && (
            <button onClick={() => setPage("buyer")}>Customer</button>
          )}

          {profile?.role === "seller" && (
            <button onClick={() => setPage("seller")}>Seller</button>
          )}

          {(profile?.role === "admin" || profile?.role === "sub_admin") && (
            <button onClick={() => setPage("admin")}>Admin</button>
          )}

          {user && <button onClick={() => signOut(auth)}>Logout</button>}
        </div>
      </nav>

      {page === "home" && <Home products={activeProducts} setPage={setPage} user={user} />}

      {page === "login" && <Login setPage={setPage} />}

      {page === "register" && <Register setPage={setPage} createNotif={createNotif} />}

      {page === "buyer" && profile?.role === "buyer" && (
        <BuyerDashboard
          user={user}
          orders={orders}
          products={products}
          paymentSetting={paymentSetting}
          createNotif={createNotif}
        />
      )}

      {page === "seller" && profile?.role === "seller" && (
        <SellerDashboard
          user={user}
          profile={profile}
          products={products}
          orders={orders}
          createNotif={createNotif}
        />
      )}

      {page === "admin" && (profile?.role === "admin" || profile?.role === "sub_admin") && (
        <AdminDashboard
          profile={profile}
          products={products}
          orders={orders}
          withdrawals={withdrawals}
          paymentSetting={paymentSetting}
          manualBalance={manualBalance}
          wallets={wallets}
          createNotif={createNotif}
        />
      )}

      {page === "notif" && user && (
        <NotificationPage notifications={notifications} />
      )}

      <footer style={styles.footer}>
        Kontak pengaduan: {complaintEmail}
      </footer>
    </div>
  );
}

function Home({ products, setPage, user }) {
  return (
    <main style={styles.container}>
      <section style={styles.hero}>
        <h1>Marketplace UMKM Modern</h1>
        <p>Produk lokal, pembayaran pusat, seller bisa tarik saldo.</p>

        {!user && (
          <button style={styles.primary} onClick={() => setPage("register")}>
            Mulai Sekarang
          </button>
        )}
      </section>

      <h2>Produk UMKM</h2>

      <div style={styles.grid}>
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </main>
  );
}

function ProductCard({ product }) {
  return (
    <div style={styles.card}>
      <img src={product.imageUrl} alt={product.productName} style={styles.img} />
      <h3>{product.productName}</h3>
      <p>{product.category}</p>
      <b>{rupiah(product.price)}</b>
      <p>⭐ {product.averageRating || 0} | {product.totalReviews || 0} ulasan</p>
    </div>
  );
}

function Login({ setPage }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function login(e) {
    e.preventDefault();
    await signInWithEmailAndPassword(auth, email, password);
    setPage("home");
  }

  async function resetPassword() {
    if (!email) {
      alert("Masukkan email dulu");
      return;
    }

    await sendPasswordResetEmail(auth, email);
    alert("Link reset password dikirim ke email");
  }

  return (
    <form style={styles.form} onSubmit={login}>
      <h2>Login</h2>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button style={styles.primary}>Login</button>
      <button type="button" onClick={resetPassword}>Lupa Password?</button>
    </form>
  );
}

function Register({ setPage, createNotif }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "buyer",
    whatsapp: "",
  });

  async function register(e) {
    e.preventDefault();

    const res = await createUserWithEmailAndPassword(auth, form.email, form.password);

    await setDoc(doc(db, "users", res.user.uid), {
      uid: res.user.uid,
      name: form.name,
      email: form.email,
      role: form.role,
      whatsapp: form.whatsapp,
      status: form.role === "seller" ? "pending" : "active",
      createdAt: serverTimestamp(),
    });

    if (form.role === "seller") {
      await setDoc(doc(db, "seller_wallets", res.user.uid), {
        sellerId: res.user.uid,
        sellerName: form.name,
        saldoTersedia: 0,
        saldoTertahan: 0,
        totalPenjualan: 0,
        totalDitarik: 0,
      });

      await createNotif({
        role: "admin",
        type: "seller_register",
        title: "Seller Baru",
        message: `${form.name} mendaftar sebagai seller`,
        userId: res.user.uid,
      });
    }

    alert("Akun berhasil dibuat");
    setPage("home");
  }

  return (
    <form style={styles.form} onSubmit={register}>
      <h2>Daftar Akun</h2>
      <input placeholder="Nama" onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input placeholder="WhatsApp" onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
      <input placeholder="Email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input placeholder="Password" type="password" onChange={(e) => setForm({ ...form, password: e.target.value })} />

      <select onChange={(e) => setForm({ ...form, role: e.target.value })}>
        <option value="buyer">Pembeli</option>
        <option value="seller">Penjual</option>
      </select>

      <button style={styles.primary}>Daftar</button>
    </form>
  );
}

function SellerDashboard({ user, profile, products, orders, createNotif }) {
  const [tab, setTab] = useState("produk");
  const myProducts = products.filter((p) => p.sellerId === user.uid);
  const myOrders = orders.filter((o) => o.sellerId === user.uid);

  return (
    <main style={styles.container}>
      <h2>Dashboard Seller</h2>

      <button onClick={() => setTab("produk")}>Produk</button>
      <button onClick={() => setTab("order")}>Order</button>
      <button onClick={() => setTab("withdraw")}>Penarikan</button>

      {tab === "produk" && (
        <AddProduct user={user} profile={profile} products={myProducts} createNotif={createNotif} />
      )}

      {tab === "order" && (
        <SellerOrders orders={myOrders} createNotif={createNotif} />
      )}

      {tab === "withdraw" && (
        <Withdraw user={user} profile={profile} createNotif={createNotif} />
      )}
    </main>
  );
}

function AddProduct({ user, profile, products, createNotif }) {
  const [form, setForm] = useState({
    productName: "",
    category: "",
    price: "",
    stock: "",
    description: "",
    weightGram: "",
    sellerAddress: "",
    sellerCityId: "",
    sellerLatitude: "",
    sellerLongitude: "",
  });

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");

  function handleFile(e) {
    const selected = e.target.files[0];
    if (!selected) return;

    if (selected.size > 1024 * 1024) {
      alert("Ukuran gambar maksimal 1MB");
      return;
    }

    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  async function submit(e) {
    e.preventDefault();

    if (!file) {
      alert("Pilih gambar dulu");
      return;
    }

    const imageUrl = await uploadImageToCloudinary(file);

    const ref = await addDoc(collection(db, "products"), {
      sellerId: user.uid,
      sellerName: profile.name,
      productName: form.productName,
      category: form.category,
      price: Number(form.price),
      stock: Number(form.stock),
      description: form.description,
      weightGram: Number(form.weightGram || 1000),
      sellerAddress: form.sellerAddress,
      sellerCityId: form.sellerCityId,
      sellerLatitude: Number(form.sellerLatitude || 0),
      sellerLongitude: Number(form.sellerLongitude || 0),
      imageUrl,
      status: "pending",
      commissionType: "percent",
      commissionValue: 10,
      averageRating: 0,
      totalReviews: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await createNotif({
      role: "admin",
      type: "product_new",
      title: "Produk Baru",
      message: `${profile.name} upload produk ${form.productName}`,
      productId: ref.id,
    });

    alert("Produk berhasil diupload. Menunggu approval admin.");
  }

  return (
    <div>
      <form style={styles.form} onSubmit={submit}>
        <h3>Tambah Produk</h3>
        <input placeholder="Nama produk" onChange={(e) => setForm({ ...form, productName: e.target.value })} />
        <input placeholder="Kategori" onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input placeholder="Harga" type="number" onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <input placeholder="Stok" type="number" onChange={(e) => setForm({ ...form, stock: e.target.value })} />
        <input placeholder="Berat gram, contoh 1000" type="number" onChange={(e) => setForm({ ...form, weightGram: e.target.value })} />
        <input placeholder="Alamat seller" onChange={(e) => setForm({ ...form, sellerAddress: e.target.value })} />
        <input placeholder="ID kota RajaOngkir seller" onChange={(e) => setForm({ ...form, sellerCityId: e.target.value })} />
        <input placeholder="Latitude seller" onChange={(e) => setForm({ ...form, sellerLatitude: e.target.value })} />
        <input placeholder="Longitude seller" onChange={(e) => setForm({ ...form, sellerLongitude: e.target.value })} />
        <textarea placeholder="Deskripsi" onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} />
        <small>Foto maksimal 1MB</small>

        {preview && <img src={preview} alt="Preview" style={styles.preview} />}

        <button style={styles.primary}>Upload Produk</button>
      </form>

      <h3>Produk Saya</h3>
      <div style={styles.grid}>
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}

function SellerOrders({ orders, createNotif }) {
  async function updateOrder(o, status) {
    await updateDoc(doc(db, "orders", o.id), {
      statusPesanan: status,
      updatedAt: serverTimestamp(),
    });

    await createNotif({
      role: "buyer",
      userId: o.buyerId,
      type: "order_update",
      title: "Update Pesanan",
      message: `Pesanan ${o.productName} sekarang ${status}`,
      orderId: o.id,
    });

    alert("Status order berhasil diubah");
  }

  return (
    <div>
      <h3>Pesanan Seller</h3>

      {orders.map((o) => (
        <div style={styles.card} key={o.id}>
          <h3>{o.productName}</h3>
          <p>Buyer: {o.buyerName}</p>
          <p>Subtotal: {rupiah(o.productTotal)}</p>
          <p>Ongkir: {rupiah(o.shippingCost)}</p>
          <p>Total dibayar buyer: {rupiah(o.totalAmount)}</p>
          <p>Saldo bersih seller: {rupiah(o.sellerAmount)}</p>
          <p>Pengiriman: {o.courierName} {o.courierService}</p>
          <p>Status bayar: {o.statusPembayaran}</p>
          <p>Status pesanan: {o.statusPesanan}</p>

          {o.paymentProofUrl && (
            <img src={o.paymentProofUrl} alt="Bukti pembayaran" style={styles.proofImg} />
          )}

          <button onClick={() => updateOrder(o, "diproses")}>Proses</button>
          <button onClick={() => updateOrder(o, "dikirim")}>Kirim</button>
          <button onClick={() => updateOrder(o, "dibatalkan")}>Batalkan</button>
        </div>
      ))}
    </div>
  );
}

function Withdraw({ user, profile, createNotif }) {
  const [amountText, setAmountText] = useState("");
  const [form, setForm] = useState({
    bankName: "",
    accountNumber: "",
    accountHolder: "",
  });

  const amount = Number(amountText.replace(/\D/g, ""));

  async function submit(e) {
    e.preventDefault();

    if (amount < 10000) {
      alert("Minimal penarikan adalah Rp10.000");
      return;
    }

    const ref = await addDoc(collection(db, "withdrawals"), {
      sellerId: user.uid,
      sellerName: profile.name,
      amount,
      bankName: form.bankName,
      accountNumber: form.accountNumber,
      accountHolder: form.accountHolder,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await createNotif({
      role: "admin",
      type: "withdraw_new",
      title: "Penarikan Baru",
      message: `Penarikan baru dari ${profile.name} sebesar ${rupiah(amount)} ke ${form.bankName}`,
      withdrawalId: ref.id,
    });

    alert("Penarikan diajukan");
  }

  return (
    <form style={styles.form} onSubmit={submit}>
      <h3>Ajukan Penarikan</h3>
      <input
        placeholder="Jumlah minimal 10.000"
        value={amountText}
        onChange={(e) => setAmountText(Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID"))}
      />
      <input placeholder="Bank" onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
      <input placeholder="Nomor rekening" onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} />
      <input placeholder="Atas nama" onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} />
      <button style={styles.primary}>Ajukan</button>
    </form>
  );
}

function BuyerDashboard({ user, orders, products, paymentSetting, createNotif }) {
  const myOrders = orders.filter((o) => o.buyerId === user.uid);
  const [cart, setCart] = useState([]);

  function addToCart(product) {
    const exists = cart.find((item) => item.id === product.id);

    if (exists) {
      setCart(cart.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }

    alert("Produk masuk keranjang");
  }

  function removeFromCart(productId) {
    setCart(cart.filter((item) => item.id !== productId));
  }

  function updateQty(productId, quantity) {
    if (quantity < 1) return;
    setCart(cart.map((item) => item.id === productId ? { ...item, quantity } : item));
  }

  async function checkoutCart() {
    if (cart.length === 0) {
      alert("Keranjang masih kosong");
      return;
    }

    const buyerName = prompt("Nama pembeli:");
    const buyerWhatsapp = prompt("Nomor WhatsApp:");
    const buyerAddress = prompt("Alamat lengkap:");
    const shippingType = prompt("Pilih pengiriman: pickup / same_day / jne / pos / tiki / sicepat / jnt");

    if (!buyerName || !buyerWhatsapp || !buyerAddress || !shippingType) {
      alert("Data wajib lengkap");
      return;
    }

    let buyerLatitude = "";
    let buyerLongitude = "";
    let destinationCityId = "";

    if (shippingType === "same_day") {
      buyerLatitude = prompt("Latitude buyer:");
      buyerLongitude = prompt("Longitude buyer:");

      if (!buyerLatitude || !buyerLongitude) {
        alert("Latitude dan longitude wajib untuk Same Day");
        return;
      }
    }

    if (shippingType !== "same_day" && shippingType !== "pickup") {
      destinationCityId = prompt("ID kota RajaOngkir tujuan buyer:");

      if (!destinationCityId) {
        alert("ID kota tujuan wajib diisi");
        return;
      }
    }

    let totalSemuaOrder = 0;

    for (const item of cart) {
      const productTotal = Number(item.price) * Number(item.quantity);
      const adminFee = calcCommission(productTotal, item.commissionType, item.commissionValue);

      let shippingCost = 0;
      let distanceKm = 0;
      let courierName = "";
      let courierService = "";

      if (shippingType === "pickup") {
        shippingCost = 0;
        courierName = "Ambil di Tempat";
        courierService = "Gratis";
      }

      if (shippingType === "same_day") {
        distanceKm = calculateDistanceKm(
          item.sellerLatitude,
          item.sellerLongitude,
          buyerLatitude,
          buyerLongitude
        );

        shippingCost = calculateSameDayShipping(distanceKm);
        courierName = "Same Day Lokal";
        courierService = `${distanceKm.toFixed(1)} km`;
      }

      if (["jne", "pos", "tiki", "sicepat", "jnt"].includes(shippingType)) {
        const weightTotal = Number(item.weightGram || 1000) * Number(item.quantity);
        const costs = await getOngkirAPI(item.sellerCityId, destinationCityId, weightTotal, shippingType);
        const selected = costs[0];

        shippingCost = selected.cost[0].value;
        courierName = shippingType.toUpperCase();
        courierService = `${selected.service} - ${selected.cost[0].etd} hari`;
      }

      const totalAmount = productTotal + shippingCost;
      const sellerAmount = productTotal - adminFee + shippingCost;

      const ref = await addDoc(collection(db, "orders"), {
        buyerId: user.uid,
        sellerId: item.sellerId,
        productId: item.id,
        productName: item.productName,
        productImage: item.imageUrl,
        buyerName,
        buyerWhatsapp,
        buyerAddress,
        buyerLatitude: buyerLatitude ? Number(buyerLatitude) : null,
        buyerLongitude: buyerLongitude ? Number(buyerLongitude) : null,
        destinationCityId: destinationCityId || null,
        quantity: item.quantity,
        productTotal,
        shippingType,
        shippingCost,
        distanceKm,
        courierName,
        courierService,
        totalAmount,
        adminFee,
        sellerAmount,
        statusPembayaran: "menunggu_pembayaran",
        statusPesanan: "menunggu_pembayaran",
        showToSeller: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      totalSemuaOrder += totalAmount;

      await createNotif({
        role: "admin",
        type: "order_new",
        title: "Order Baru",
        message: `${buyerName} membuat pesanan ${item.productName}`,
        orderId: ref.id,
      });

      await createNotif({
        role: "seller",
        userId: item.sellerId,
        type: "order_new",
        title: "Pesanan Baru",
        message: `Ada pesanan baru ${item.productName}, total ${rupiah(totalAmount)}`,
        orderId: ref.id,
      });
    }

    alert(`Checkout berhasil. Total semua: ${rupiah(totalSemuaOrder)}. Silakan upload bukti pembayaran.`);
    setCart([]);
  }

  return (
    <main style={styles.container}>
      <h2>Dashboard Customer</h2>

      <div style={styles.card}>
        <h3>Rekening Pembayaran</h3>
        <p>Bank: {paymentSetting?.bankName || "-"}</p>
        <p>No Rekening: {paymentSetting?.accountNumber || "-"}</p>
        <p>Atas Nama: {paymentSetting?.accountHolder || "-"}</p>
        <p>Kontak pengaduan: {complaintEmail}</p>
      </div>

      <h3>Produk Tersedia</h3>
      <div style={styles.grid}>
        {products.filter((p) => p.status === "active").map((p) => (
          <div style={styles.card} key={p.id}>
            <img src={p.imageUrl} style={styles.img} alt={p.productName} />
            <h3>{p.productName}</h3>
            <p>{p.category}</p>
            <b>{rupiah(p.price)}</b>
            <p>⭐ {p.averageRating || 0} | {p.totalReviews || 0} ulasan</p>
            <button style={styles.cartBtn} onClick={() => addToCart(p)}>🛒 Tambah ke Keranjang</button>
          </div>
        ))}
      </div>

      <h3>🛒 Keranjang Saya</h3>
      {cart.length === 0 ? (
        <div style={styles.card}>Keranjang kosong</div>
      ) : (
        <div style={styles.card}>
          {cart.map((item) => (
            <div key={item.id} style={styles.cartItem}>
              <img src={item.imageUrl} style={styles.cartImg} alt={item.productName} />
              <div style={{ flex: 1 }}>
                <h4>{item.productName}</h4>
                <p>{rupiah(item.price)}</p>
                <div style={styles.qtyBox}>
                  <button onClick={() => updateQty(item.id, item.quantity - 1)}>-</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQty(item.id, item.quantity + 1)}>+</button>
                </div>
              </div>
              <button onClick={() => removeFromCart(item.id)}>Hapus</button>
            </div>
          ))}

          <button style={styles.primary} onClick={checkoutCart}>Checkout Keranjang</button>
        </div>
      )}

      <h3>Riwayat Pesanan Saya</h3>
      {myOrders.map((o) => (
        <BuyerOrder key={o.id} order={o} createNotif={createNotif} />
      ))}
    </main>
  );
}

function BuyerOrder({ order, createNotif }) {
  const [file, setFile] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  function handleProofFile(e) {
    const selected = e.target.files[0];
    if (!selected) return;

    if (selected.size > 1024 * 1024) {
      alert("Ukuran gambar maksimal 1MB");
      return;
    }

    setFile(selected);
  }

  async function uploadProof() {
    if (!file) {
      alert("Pilih bukti pembayaran dulu");
      return;
    }

    const url = await uploadImageToCloudinary(file);

    await updateDoc(doc(db, "orders", order.id), {
      paymentProofUrl: url,
      paymentProofUploadedAt: serverTimestamp(),
      statusPembayaran: "menunggu_verifikasi",
    });

    await createNotif({
      role: "admin",
      type: "payment_proof",
      title: "Bukti Pembayaran Baru",
      message: `Bukti pembayaran dikirim oleh ${order.buyerName}`,
      orderId: order.id,
    });

    await createNotif({
      role: "seller",
      userId: order.sellerId,
      type: "payment_proof",
      title: "Buyer Upload Bukti",
      message: `Buyer upload bukti untuk ${order.productName}`,
      orderId: order.id,
    });

    alert("Bukti pembayaran terkirim");
  }

  async function received() {
    await updateDoc(doc(db, "orders", order.id), {
      statusPesanan: "selesai",
      updatedAt: serverTimestamp(),
    });

    await createNotif({
      role: "seller",
      userId: order.sellerId,
      type: "order_done",
      title: "Pesanan Selesai",
      message: `${order.buyerName} telah menerima pesanan`,
      orderId: order.id,
    });
  }

  async function sendReview() {
    await addDoc(collection(db, "reviews"), {
      orderId: order.id,
      productId: order.productId,
      sellerId: order.sellerId,
      buyerId: order.buyerId,
      buyerName: order.buyerName,
      rating: Number(rating),
      comment,
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, "products", order.productId), {
      totalReviews: increment(1),
      averageRating: Number(rating),
    });

    alert("Ulasan terkirim");
  }

  return (
    <div style={styles.card}>
      <h3>{order.productName}</h3>
      <p>Total: {rupiah(order.totalAmount)}</p>
      <p>Ongkir: {rupiah(order.shippingCost)}</p>
      <p>Pengiriman: {order.courierName} {order.courierService}</p>
      <p>Status bayar: {order.statusPembayaran}</p>
      <p>Status pesanan: {order.statusPesanan}</p>

      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleProofFile} />
      <small>Bukti pembayaran maksimal 1MB</small>
      <button onClick={uploadProof}>Kirim Bukti Pembayaran</button>

      {order.statusPesanan === "dikirim" && (
        <button style={styles.primary} onClick={received}>Pesanan Diterima</button>
      )}

      {order.statusPesanan === "selesai" && (
        <div>
          <h4>Ulasan</h4>
          <select onChange={(e) => setRating(e.target.value)}>
            <option value="5">5 Bintang</option>
            <option value="4">4 Bintang</option>
            <option value="3">3 Bintang</option>
            <option value="2">2 Bintang</option>
            <option value="1">1 Bintang</option>
          </select>
          <textarea placeholder="Komentar" onChange={(e) => setComment(e.target.value)} />
          <button onClick={sendReview}>Kirim Ulasan</button>
        </div>
      )}
    </div>
  );
}

function AdminDashboard({
  profile,
  products,
  orders,
  withdrawals,
  paymentSetting,
  manualBalance,
  wallets,
  createNotif,
}) {
  const [tab, setTab] = useState("order");

  const autoBalance = wallets.reduce((sum, w) => sum + Number(w.saldoTersedia || 0), 0);
  const displayedBalance = manualBalance?.isManualBalanceActive
    ? Number(manualBalance.totalSellerBalanceManual || 0)
    : autoBalance;

  return (
    <main style={styles.container}>
      <h2>{profile.role === "sub_admin" ? "Dashboard Admin Order" : "Dashboard Admin Utama"}</h2>

      <div style={styles.stats}>
        <div style={styles.stat}>Produk: {products.length}</div>
        <div style={styles.stat}>Order: {orders.length}</div>
        <div style={styles.stat}>Withdraw: {withdrawals.length}</div>
        <div style={styles.stat}>Saldo belum ditarik: {rupiah(displayedBalance)}</div>
      </div>

      <button onClick={() => setTab("order")}>Order Masuk</button>

      {profile.role === "admin" && (
        <>
          <button onClick={() => setTab("produk")}>Produk</button>
          <button onClick={() => setTab("withdraw")}>Penarikan</button>
          <button onClick={() => setTab("payment")}>Rekening</button>
          <button onClick={() => setTab("balance")}>Edit Saldo Manual</button>
          <button onClick={() => setTab("admins")}>Tambah Admin</button>
        </>
      )}

      {tab === "order" && <AdminOrders orders={orders} createNotif={createNotif} />}
      {tab === "produk" && profile.role === "admin" && <AdminProducts products={products} />}
      {tab === "withdraw" && profile.role === "admin" && <AdminWithdraw withdrawals={withdrawals} />}
      {tab === "payment" && profile.role === "admin" && <PaymentSetting paymentSetting={paymentSetting} />}
      {tab === "balance" && profile.role === "admin" && <ManualBalance />}
      {tab === "admins" && profile.role === "admin" && <CreateSubAdmin />}
    </main>
  );
}

function AdminProducts({ products }) {
  async function approve(id) {
    await updateDoc(doc(db, "products", id), { status: "active" });
  }

  async function reject(id) {
    await updateDoc(doc(db, "products", id), { status: "rejected" });
  }

  async function updateCommission(id, type, value) {
    await updateDoc(doc(db, "products", id), {
      commissionType: type,
      commissionValue: Number(value),
    });
  }

  return (
    <div>
      <h3>Kelola Produk</h3>
      {products.map((p) => (
        <div style={styles.card} key={p.id}>
          <img src={p.imageUrl} style={styles.img} alt={p.productName} />
          <h3>{p.productName}</h3>
          <p>Status: {p.status}</p>
          <p>Komisi: {p.commissionType} {p.commissionValue}</p>
          <button onClick={() => approve(p.id)}>Approve</button>
          <button onClick={() => reject(p.id)}>Tolak</button>
          <button onClick={() => updateCommission(p.id, "percent", prompt("Komisi persen:", p.commissionValue || 10))}>Set Persen</button>
          <button onClick={() => updateCommission(p.id, "fixed", prompt("Komisi nominal:", p.commissionValue || 1000))}>Set Nominal</button>
        </div>
      ))}
    </div>
  );
}

function AdminOrders({ orders, createNotif }) {
  async function approve(o) {
    await updateDoc(doc(db, "orders", o.id), {
      statusPembayaran: "sudah_dibayar",
      statusPesanan: "pesanan_masuk",
      showToSeller: true,
      updatedAt: serverTimestamp(),
    });

    await setDoc(
      doc(db, "seller_wallets", o.sellerId),
      {
        sellerId: o.sellerId,
        saldoTersedia: increment(o.sellerAmount),
        totalPenjualan: increment(o.sellerAmount),
      },
      { merge: true }
    );

    await addDoc(collection(db, "wallet_transactions"), {
      sellerId: o.sellerId,
      orderId: o.id,
      amount: o.sellerAmount,
      type: "income",
      createdAt: serverTimestamp(),
    });

    await createNotif({
      role: "seller",
      userId: o.sellerId,
      type: "payment_approved",
      title: "Pesanan Sudah Dibayar",
      message: `Pesanan ${o.productName} sudah dibayar. Saldo bersih ${rupiah(o.sellerAmount)}`,
      orderId: o.id,
    });

    alert("Pembayaran disetujui");
  }

  async function reject(o) {
    await updateDoc(doc(db, "orders", o.id), {
      statusPembayaran: "ditolak",
      statusPesanan: "dibatalkan",
      updatedAt: serverTimestamp(),
    });

    await createNotif({
      role: "buyer",
      userId: o.buyerId,
      type: "payment_rejected",
      title: "Pembayaran Ditolak",
      message: `Pembayaran untuk ${o.productName} ditolak admin`,
      orderId: o.id,
    });

    await createNotif({
      role: "seller",
      userId: o.sellerId,
      type: "payment_rejected",
      title: "Pembayaran Ditolak",
      message: `Pembayaran ${o.productName} ditolak admin`,
      orderId: o.id,
    });

    alert("Pembayaran ditolak");
  }

  return (
    <div>
      <h3>Order Masuk</h3>

      {orders.map((o) => (
        <div style={styles.card} key={o.id}>
          <h3>{o.productName}</h3>
          <p>Buyer: {o.buyerName}</p>
          <p>Subtotal: {rupiah(o.productTotal)}</p>
          <p>Ongkir: {rupiah(o.shippingCost)}</p>
          <p>Total bayar: {rupiah(o.totalAmount)}</p>
          <p>Komisi admin: {rupiah(o.adminFee)}</p>
          <p>Saldo seller: {rupiah(o.sellerAmount)}</p>
          <p>Pengiriman: {o.courierName} {o.courierService}</p>
          <p>Status pembayaran: {o.statusPembayaran}</p>

          {o.paymentProofUrl && (
            <img src={o.paymentProofUrl} alt="Bukti pembayaran" style={styles.proofImg} />
          )}

          <button style={styles.primary} onClick={() => approve(o)}>Approve Pembayaran</button>
          <button onClick={() => reject(o)}>Tolak Pembayaran</button>
        </div>
      ))}
    </div>
  );
}

function AdminWithdraw({ withdrawals }) {
  async function updateStatus(w, status) {
    await updateDoc(doc(db, "withdrawals", w.id), {
      status,
      updatedAt: serverTimestamp(),
    });

    alert("Status penarikan diubah");
  }

  function copyRek(w) {
    navigator.clipboard.writeText(w.accountNumber);
    alert("Nomor rekening berhasil disalin");
  }

  function copyDetail(w) {
    const text = `Nama Seller: ${w.sellerName}
Jumlah Penarikan: ${rupiah(w.amount)}
Bank: ${w.bankName}
No Rekening: ${w.accountNumber}
Atas Nama: ${w.accountHolder}`;

    navigator.clipboard.writeText(text);
    alert("Detail berhasil disalin");
  }

  return (
    <div>
      <h3>Penarikan Seller</h3>

      {withdrawals.map((w) => (
        <div style={styles.card} key={w.id}>
          <h3>{w.sellerName}</h3>
          <p>{rupiah(w.amount)}</p>
          <p>{w.bankName} - {w.accountNumber}</p>
          <p>Atas Nama: {w.accountHolder}</p>
          <p>Status: {w.status}</p>
          <button onClick={() => copyRek(w)}>Salin Rekening</button>
          <button onClick={() => copyDetail(w)}>Salin Detail</button>
          <button onClick={() => updateStatus(w, "approved")}>Approve</button>
          <button onClick={() => updateStatus(w, "rejected")}>Tolak</button>
          <button onClick={() => updateStatus(w, "paid")}>Sudah Dibayar</button>
        </div>
      ))}
    </div>
  );
}

function PaymentSetting({ paymentSetting }) {
  const [form, setForm] = useState(paymentSetting || {});

  async function save(e) {
    e.preventDefault();

    await setDoc(doc(db, "admin_settings", "payment"), {
      ...form,
      updatedAt: serverTimestamp(),
    });

    alert("Rekening pembayaran disimpan");
  }

  return (
    <form style={styles.form} onSubmit={save}>
      <h3>Pengaturan Rekening Pembayaran</h3>
      <input placeholder="Bank" value={form.bankName || ""} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
      <input placeholder="Nomor rekening" value={form.accountNumber || ""} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} />
      <input placeholder="Atas nama" value={form.accountHolder || ""} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} />
      <button style={styles.primary}>Simpan</button>
    </form>
  );
}

function ManualBalance() {
  const [amount, setAmount] = useState("");
  const [active, setActive] = useState(false);

  async function save(e) {
    e.preventDefault();

    await setDoc(doc(db, "admin_settings", "manualBalance"), {
      totalSellerBalanceManual: Number(amount.replace(/\D/g, "")),
      isManualBalanceActive: active,
      updatedAt: serverTimestamp(),
    });

    alert("Saldo manual disimpan");
  }

  return (
    <form style={styles.form} onSubmit={save}>
      <h3>Edit Manual Total Saldo Seller</h3>
      <input
        placeholder="Contoh 100.000"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID"))}
      />
      <label>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Aktifkan saldo manual
      </label>
      <button style={styles.primary}>Simpan</button>
    </form>
  );
}

function CreateSubAdmin() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  async function submit(e) {
    e.preventDefault();

    const res = await createUserWithEmailAndPassword(auth, form.email, form.password);

    await setDoc(doc(db, "users", res.user.uid), {
      uid: res.user.uid,
      name: form.name,
      email: form.email,
      role: "sub_admin",
      status: "active",
      permissions: {
        canViewOrders: true,
        canApprovePayments: true,
        canRejectPayments: true,
        canViewPaymentProof: true,
      },
      createdAt: serverTimestamp(),
    });

    alert("Admin tambahan berhasil dibuat");
  }

  return (
    <form style={styles.form} onSubmit={submit}>
      <h3>Tambah Admin Order</h3>
      <input placeholder="Nama admin" onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input placeholder="Email login" onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input placeholder="Password" type="password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <button style={styles.primary}>Buat Admin</button>
    </form>
  );
}

function NotificationPage({ notifications }) {
  async function markRead(id) {
    await updateDoc(doc(db, "notifications", id), { isRead: true });
  }

  async function deleteNotif(id) {
    await deleteDoc(doc(db, "notifications", id));
  }

  async function deleteAll() {
    for (const n of notifications) {
      await deleteDoc(doc(db, "notifications", n.id));
    }
  }

  async function markAllRead() {
    for (const n of notifications) {
      await updateDoc(doc(db, "notifications", n.id), { isRead: true });
    }
  }

  return (
    <main style={styles.container}>
      <h2>Notifikasi</h2>
      <button onClick={markAllRead}>Tandai Semua Dibaca</button>
      <button onClick={deleteAll}>Hapus Semua</button>

      {notifications.map((n) => (
        <div style={styles.card} key={n.id}>
          <h3>{n.title}</h3>
          <p>{n.message}</p>
          <p>{n.isRead ? "Sudah dibaca" : "Belum dibaca"}</p>
          <button onClick={() => markRead(n.id)}>Tandai Dibaca</button>
          <button onClick={() => deleteNotif(n.id)}>Hapus</button>
        </div>
      ))}
    </main>
  );
}

const styles = {
  app: {
    fontFamily: "Arial, sans-serif",
    background: "#f3f4f6",
    minHeight: "100vh",
  },
  nav: {
    background: "#047857",
    color: "white",
    padding: "16px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
  },
  logo: {
    fontSize: 22,
  },
  navLinks: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  container: {
    padding: 24,
    maxWidth: 1200,
    margin: "auto",
  },
  hero: {
    background: "linear-gradient(135deg,#059669,#f97316)",
    color: "white",
    padding: 40,
    borderRadius: 24,
    marginBottom: 24,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 18,
  },
  card: {
    background: "white",
    padding: 18,
    borderRadius: 18,
    boxShadow: "0 8px 25px rgba(0,0,0,0.08)",
    marginBottom: 14,
  },
  img: {
    width: "100%",
    height: 180,
    objectFit: "cover",
    borderRadius: 14,
  },
  proofImg: {
    width: "100%",
    maxWidth: 360,
    height: 240,
    objectFit: "cover",
    borderRadius: 14,
    margin: "10px 0",
  },
  preview: {
    width: "100%",
    height: 220,
    objectFit: "cover",
    borderRadius: 14,
  },
  form: {
    background: "white",
    padding: 24,
    borderRadius: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxWidth: 520,
    margin: "24px auto",
    boxShadow: "0 8px 25px rgba(0,0,0,0.08)",
  },
  primary: {
    background: "#059669",
    color: "white",
    border: "none",
    padding: "12px 16px",
    borderRadius: 12,
    cursor: "pointer",
    fontWeight: "bold",
  },
  cartBtn: {
    background: "#f97316",
    color: "white",
    border: "none",
    padding: "12px 16px",
    borderRadius: 12,
    cursor: "pointer",
    fontWeight: "bold",
    width: "100%",
    marginTop: 10,
  },
  cartItem: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    borderBottom: "1px solid #e5e7eb",
    padding: "12px 0",
  },
  cartImg: {
    width: 80,
    height: 80,
    objectFit: "cover",
    borderRadius: 12,
  },
  qtyBox: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  stats: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 20,
  },
  stat: {
    background: "white",
    padding: 18,
    borderRadius: 16,
    minWidth: 160,
    boxShadow: "0 8px 25px rgba(0,0,0,0.08)",
  },
  center: {
    padding: 50,
    textAlign: "center",
  },
  footer: {
    padding: 20,
    textAlign: "center",
    color: "#555",
  },
};
