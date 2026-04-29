import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import AddProduct from "./pages/seller/AddProduct";

function Home() {
  return (
    <div style={{ padding: 20 }}>
      <h1>UMKM Digital</h1>
      <p>Marketplace UMKM</p>

      <Link to="/add-product">
        <button>Tambah Produk</button>
      </Link>
    </div>
  );
}

function Navbar() {
  return (
    <div
      style={{
        padding: 15,
        background: "#059669",
        color: "white",
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      <h3>UMKM Digital</h3>

      <div>
        <Link to="/" style={{ color: "white", marginRight: 10 }}>
          Home
        </Link>
        <Link to="/add-product" style={{ color: "white" }}>
          Seller
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Navbar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/add-product" element={<AddProduct />} />
      </Routes>
    </Router>
  );
}
