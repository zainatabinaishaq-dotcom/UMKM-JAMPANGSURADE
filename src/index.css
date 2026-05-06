@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --orange: #EE4D2D;
  --orange-dark: #D73211;
  --orange-light: #FFF3F0;
  --green: #26AA99;
  --bg: #F5F5F5;
  --white: #FFFFFF;
  --text: #212121;
  --text2: #555;
  --text3: #999;
  --border: #E8E8E8;
  --shadow: 0 2px 12px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 20px rgba(0,0,0,0.12);
  --radius: 8px;
  --radius-lg: 12px;
  --bottom-nav-height: 60px;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  -webkit-tap-highlight-color: transparent;
}

button { cursor: pointer; font-family: inherit; }
input, select, textarea { font-family: inherit; outline: none; -webkit-appearance: none; }
img { display: block; }
a { text-decoration: none; color: inherit; }

/* ── BUTTONS ── */
.btn-primary {
  background: var(--orange); color: #fff; border: none;
  padding: 10px 20px; border-radius: var(--radius);
  font-weight: 600; font-size: 14px; transition: background 0.15s;
  display: inline-flex; align-items: center; gap: 6px;
  -webkit-user-select: none; user-select: none;
}
.btn-primary:hover { background: var(--orange-dark); }
.btn-primary:active { background: var(--orange-dark); transform: scale(0.98); }

.btn-outline {
  background: transparent; color: var(--orange);
  border: 1.5px solid var(--orange); padding: 9px 20px;
  border-radius: var(--radius); font-weight: 600; font-size: 14px; transition: all 0.15s;
}
.btn-outline:hover { background: var(--orange-light); }

.btn-ghost {
  background: transparent; color: var(--text2);
  border: 1.5px solid var(--border); padding: 8px 16px;
  border-radius: var(--radius); font-size: 13px; transition: all 0.15s;
}
.btn-ghost:hover { border-color: var(--orange); color: var(--orange); }
.btn-sm { padding: 6px 12px; font-size: 12px; }

/* ── BADGES ── */
.badge { display: inline-block; padding: 2px 8px; border-radius: 100px; font-size: 11px; font-weight: 600; }
.badge-orange { background: var(--orange-light); color: var(--orange); }
.badge-green { background: #E8F8F5; color: #26AA99; }
.badge-yellow { background: #FFF8E1; color: #F59E0B; }
.badge-red { background: #FEE8E8; color: #EF4444; }
.badge-gray { background: #F3F4F6; color: #6B7280; }

/* ── CARD ── */
.card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow); padding: 16px; }

/* ── FORMS ── */
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-weight: 500; font-size: 13px; color: var(--text2); }
.form-input {
  border: 1.5px solid var(--border); border-radius: var(--radius);
  padding: 12px 14px; font-size: 15px; width: 100%;
  transition: border-color 0.15s; background: #fff;
}
.form-input:focus { border-color: var(--orange); }
.form-input::placeholder { color: var(--text3); }
select.form-input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px;
}
textarea.form-input { resize: vertical; min-height: 90px; }
.divider { height: 1px; background: var(--border); margin: 16px 0; }

/* ── LAYOUT ── */
.page-container { max-width: 1200px; margin: 0 auto; padding: 16px; }

/* ── GRIDS ── */
.grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }

/* ── DASHBOARD ── */
.dash-layout { display: flex; min-height: calc(100vh - 110px); }
.dash-sidebar { width: 220px; flex-shrink: 0; background: var(--white); border-right: 1px solid var(--border); padding: 20px 0; display: flex; flex-direction: column; }
.dash-sidebar-profile { padding: 16px 20px 12px; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
.dash-sidebar-item { display: flex; align-items: center; gap: 10px; padding: 14px 20px; font-size: 14px; font-weight: 500; color: var(--text2); cursor: pointer; transition: all 0.15s; border-left: 3px solid transparent; }
.dash-sidebar-item:hover { background: var(--orange-light); color: var(--orange); }
.dash-sidebar-item.active { background: var(--orange-light); color: var(--orange); border-left-color: var(--orange); }
.dash-content { flex: 1; padding: 20px; overflow: auto; }

/* ── STAT CARDS ── */
.stat-card { background: var(--white); border-radius: var(--radius-lg); padding: 16px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 8px; }
.stat-card .stat-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.stat-card .stat-value { font-size: 20px; font-weight: 700; color: var(--text); }
.stat-card .stat-label { font-size: 12px; color: var(--text3); font-weight: 500; }

/* ── TABLES ── */
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #F9FAFB; padding: 12px 14px; text-align: left; font-weight: 600; color: var(--text2); border-bottom: 1px solid var(--border); }
.table td { padding: 12px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.table tr:hover td { background: #FAFAFA; }

/* ── PRODUCT CARDS ── */
.product-card { background: var(--white); border-radius: var(--radius-lg); overflow: hidden; cursor: pointer; transition: box-shadow 0.15s, transform 0.15s; box-shadow: var(--shadow); }
.product-card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }
.product-card:active { transform: scale(0.98); }
.product-card .product-img { width: 100%; aspect-ratio: 1; object-fit: cover; }
.product-card .product-info { padding: 8px 10px 10px; }
.product-card .product-name { font-size: 12px; font-weight: 500; color: var(--text); margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 32px; }
.product-card .product-price { font-size: 14px; font-weight: 700; color: var(--orange); margin-bottom: 4px; }
.product-card .product-meta { font-size: 10px; color: var(--text3); display: flex; gap: 6px; align-items: center; }
.product-card .add-cart-btn { width: 100%; margin-top: 8px; background: var(--orange); color: #fff; border: none; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600; transition: background 0.15s; }
.product-card .add-cart-btn:active { background: var(--orange-dark); }

/* ── MODALS ── */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
.modal { background: var(--white); border-radius: 20px 20px 0 0; width: 100%; max-height: 92vh; overflow-y: auto; box-shadow: var(--shadow-md); animation: slideUp 0.25s ease; }
@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.modal-handle { width: 40px; height: 4px; background: var(--border); border-radius: 2px; margin: 12px auto 0; }
.modal-header { padding: 16px 20px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.modal-body { padding: 16px 20px; }
.modal-footer { padding: 14px 20px 20px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end; }

/* ── CART DRAWER (mobile = bottom sheet) ── */
.cart-drawer { position: fixed; right: 0; top: 0; height: 100vh; width: 380px; background: var(--white); z-index: 900; box-shadow: -4px 0 20px rgba(0,0,0,0.12); display: flex; flex-direction: column; }
.cart-drawer-header { padding: 18px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.cart-drawer-body { flex: 1; overflow-y: auto; padding: 14px; -webkit-overflow-scrolling: touch; }
.cart-drawer-footer { padding: 14px 20px; border-top: 1px solid var(--border); }
.cart-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.cart-item:last-child { border-bottom: none; }
.qty-control { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.qty-control button { width: 30px; height: 30px; border: 1.5px solid var(--border); background: #fff; border-radius: 6px; font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.qty-control button:active { border-color: var(--orange); color: var(--orange); background: var(--orange-light); }

/* ── NAVBAR ── */
.nav-sticky { position: sticky; top: 0; z-index: 200; }
.nav-desktop { background: var(--orange); }
.nav-inner { max-width: 1200px; margin: 0 auto; padding: 0 16px; display: flex; align-items: center; gap: 14px; height: 56px; }
.nav-logo { font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.5px; flex-shrink: 0; cursor: pointer; }
.nav-logo span { opacity: 0.8; }
.nav-search { flex: 1; display: flex; background: #fff; border-radius: 4px; overflow: hidden; }
.nav-search input { flex: 1; border: none; padding: 9px 14px; font-size: 14px; color: var(--text); min-width: 0; }
.nav-search input::placeholder { color: #aaa; }
.nav-search button { background: var(--orange-dark); border: none; padding: 0 16px; color: #fff; font-size: 16px; cursor: pointer; flex-shrink: 0; }
.nav-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.nav-btn { background: transparent; border: 1.5px solid rgba(255,255,255,0.5); color: #fff; padding: 7px 14px; border-radius: 4px; font-size: 13px; font-weight: 500; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
.nav-btn:hover { background: rgba(255,255,255,0.15); border-color: #fff; }
.nav-icon-btn { background: transparent; border: none; color: #fff; font-size: 22px; padding: 6px; position: relative; display: flex; align-items: center; min-width: 36px; justify-content: center; }
.nav-icon-btn .badge-count { position: absolute; top: 0; right: 0; background: #fff; color: var(--orange); font-size: 10px; font-weight: 700; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.nav-user-btn { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.15); border: none; color: #fff; padding: 7px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; transition: background 0.15s; }
.nav-user-btn:hover { background: rgba(255,255,255,0.25); }
.nav-avatar { width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; }

/* Mobile Navbar */
.nav-mobile { background: var(--orange); display: none; }
.nav-mobile-top { display: flex; align-items: center; gap: 12px; padding: 10px 14px 8px; }
.nav-mobile-bottom { padding: 0 14px 10px; display: flex; }
.nav-mobile-logo { font-size: 20px; font-weight: 800; color: #fff; flex: 1; }
.nav-mobile-icons { display: flex; gap: 4px; }

/* ── BOTTOM NAVIGATION ── */
.bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: var(--bottom-nav-height); background: var(--white); border-top: 1px solid var(--border); display: none; z-index: 300; box-shadow: 0 -4px 16px rgba(0,0,0,0.08); }
.bottom-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; cursor: pointer; padding: 8px 4px; transition: color 0.15s; color: var(--text3); font-size: 10px; font-weight: 500; position: relative; border: none; background: none; -webkit-tap-highlight-color: transparent; }
.bottom-nav-item.active { color: var(--orange); }
.bottom-nav-item .nav-icon { font-size: 22px; line-height: 1; }
.bottom-nav-item .nav-badge { position: absolute; top: 6px; right: calc(50% - 16px); background: var(--orange); color: #fff; font-size: 9px; font-weight: 700; min-width: 15px; height: 15px; border-radius: 10px; display: flex; align-items: center; justify-content: center; padding: 0 3px; }

/* ── MISC ── */
.notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--orange); display: inline-block; }
.section-title { font-size: 16px; font-weight: 700; color: var(--text); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.section-title::after { content: ''; flex: 1; height: 2px; background: var(--orange); max-width: 36px; }
.loading-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px; background: var(--white); }
.spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--orange); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.empty-state { text-align: center; padding: 50px 20px; color: var(--text3); }
.empty-state .empty-icon { font-size: 44px; margin-bottom: 12px; }
.empty-state p { font-size: 14px; }
.overlay-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 800; }
.star-rating { color: #F59E0B; }

/* ── HERO BANNER ── */
.hero-banner { background: linear-gradient(135deg, #EE4D2D 0%, #FF7043 50%, #FF9A3C 100%); color: #fff; border-radius: var(--radius-lg); overflow: hidden; padding: 40px 40px; margin-bottom: 16px; position: relative; }
.hero-banner h1 { font-size: 30px; font-weight: 800; margin-bottom: 10px; line-height: 1.2; }
.hero-banner p { font-size: 14px; opacity: 0.9; margin-bottom: 20px; max-width: 440px; }
.hero-pattern { position: absolute; right: 0; top: 0; bottom: 0; width: 40%; background: rgba(255,255,255,0.06); clip-path: polygon(20% 0%, 100% 0%, 100% 100%, 0% 100%); }
.hero-pattern2 { position: absolute; right: 5%; top: 50%; transform: translateY(-50%); font-size: 110px; opacity: 0.12; pointer-events: none; }

/* ── CATEGORIES ── */
.category-grid { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 16px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
.category-grid::-webkit-scrollbar { display: none; }
.cat-item { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; background: var(--white); padding: 12px 14px; border-radius: var(--radius-lg); box-shadow: var(--shadow); transition: all 0.15s; min-width: 70px; border: 2px solid transparent; -webkit-tap-highlight-color: transparent; }
.cat-item:active, .cat-item.active { border-color: var(--orange); color: var(--orange); }
.cat-item .cat-icon { font-size: 24px; }
.cat-item span { font-size: 10px; font-weight: 600; text-align: center; }

/* ── MOBILE CONTENT PADDING ── */
.mobile-pb { padding-bottom: 0; }

/* ============================================================
   RESPONSIVE — MOBILE FIRST BREAKPOINTS
   ============================================================ */

/* Tablet */
@media (max-width: 1100px) { .grid-5 { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 900px) {
  .grid-5 { grid-template-columns: repeat(3, 1fr); }
  .grid-4 { grid-template-columns: repeat(3, 1fr); }
  .dash-sidebar { width: 190px; }
}

/* Mobile (≤ 640px) */
@media (max-width: 640px) {
  /* Hide desktop navbar, show mobile navbar */
  .nav-desktop { display: none !important; }
  .nav-mobile { display: block; }

  /* Show bottom nav */
  .bottom-nav { display: flex; }

  /* Add bottom padding to all pages for bottom nav */
  .mobile-pb { padding-bottom: calc(var(--bottom-nav-height) + 12px); }
  .page-container { padding: 12px; padding-bottom: calc(var(--bottom-nav-height) + 16px); }

  /* Grids */
  .grid-5, .grid-4 { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .grid-3 { grid-template-columns: repeat(2, 1fr); gap: 8px; }

  /* Hero */
  .hero-banner { padding: 24px 20px; margin-bottom: 14px; border-radius: 12px; }
  .hero-banner h1 { font-size: 20px; margin-bottom: 8px; }
  .hero-banner p { font-size: 12px; margin-bottom: 16px; }
  .hero-pattern2 { font-size: 70px; right: 2%; }
  .hero-pattern { width: 35%; }

  /* Cart drawer → bottom sheet on mobile */
  .cart-drawer { width: 100%; top: auto; bottom: 0; height: 85vh; border-radius: 20px 20px 0 0; box-shadow: 0 -8px 30px rgba(0,0,0,0.15); }

  /* Dashboard layout → stack on mobile */
  .dash-layout { flex-direction: column; min-height: auto; }
  .dash-sidebar { width: 100%; border-right: none; border-bottom: 2px solid var(--border); padding: 0; overflow-x: auto; display: flex; flex-direction: row; align-items: stretch; }
  .dash-sidebar::-webkit-scrollbar { display: none; }
  .dash-sidebar-profile { display: none; }
  .dash-sidebar-item { flex-direction: column; gap: 3px; padding: 10px 14px; font-size: 11px; border-left: none; border-bottom: 3px solid transparent; white-space: nowrap; min-width: 70px; align-items: center; flex-shrink: 0; }
  .dash-sidebar-item.active { border-left-color: transparent; border-bottom-color: var(--orange); background: var(--orange-light); color: var(--orange); }
  .dash-sidebar-item span:first-child { font-size: 20px; }
  .dash-logout-btn-wrap { padding: 8px 10px !important; margin-top: 0 !important; display: flex; align-items: center; flex-shrink: 0; }
  .dash-logout-btn-wrap button { padding: 8px 12px !important; font-size: 11px !important; white-space: nowrap; border-radius: 6px !important; }
  .dash-content { padding: 14px; padding-bottom: calc(var(--bottom-nav-height) + 16px); }

  /* Tables → hidden or scrollable */
  .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* Sort filter row → full width, scrollable on mobile */
  .sort-row { flex-direction: column; align-items: flex-start !important; gap: 8px !important; }
  .sort-row .sort-buttons { overflow-x: auto; display: flex; gap: 6px; padding-bottom: 2px; width: 100%; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .sort-row .sort-buttons::-webkit-scrollbar { display: none; }

  /* Product card on mobile */
  .product-card .product-meta { font-size: 10px; gap: 4px; }
  .product-card .product-name { font-size: 12px; line-height: 1.35; -webkit-line-clamp: 2; }
  .product-card .product-price { font-size: 13px; font-weight: 700; }

  /* Stat cards — 2 columns on mobile */
  .stat-grid-mobile { grid-template-columns: repeat(2, 1fr) !important; }

  /* Form card on mobile */
  .form-card-mobile { padding: 24px 16px !important; }

  /* Login/register centering on mobile */
  .auth-container { padding: 16px !important; align-items: flex-start !important; padding-top: 24px !important; }

  /* Modal wider on mobile */
  .modal { border-radius: 20px 20px 0 0; }

  /* Hero buttons wrap neatly */
  .hero-cta { gap: 10px !important; }
  .hero-cta button { flex: 1; min-width: 120px; justify-content: center; }

  /* Section title */
  .section-title { font-size: 15px; }

  /* Card */
  .card { padding: 14px; border-radius: 12px; }

  /* Buttons */
  .btn-primary, .btn-outline { padding: 12px 18px; font-size: 14px; }

  /* Category */
  .cat-item { padding: 10px 12px; min-width: 64px; }
  .cat-item .cat-icon { font-size: 22px; }

  /* Modal */
  .modal { border-radius: 20px 20px 0 0; max-height: 95vh; }
  .modal-body { padding: 14px 16px; }
  .modal-header { padding: 14px 16px; }
  .modal-footer { padding: 12px 16px 16px; }

  /* Stat cards on mobile */
  .stat-card { padding: 14px; }
  .stat-card .stat-value { font-size: 18px; }

  /* Product card */
  .product-card .product-info { padding: 8px 8px 10px; }
  .product-card .product-name { font-size: 11px; min-height: 28px; }
  .product-card .product-price { font-size: 13px; }

  /* Form inputs larger touch target */
  .form-input { padding: 13px 14px; font-size: 16px; }

  /* Loading */
  .loading-screen { font-size: 14px; }
}

/* Extra small (≤ 380px) */
@media (max-width: 380px) {
  .grid-5, .grid-4, .grid-3, .grid-2 { grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .hero-banner h1 { font-size: 18px; }
  .page-container { padding: 10px; padding-bottom: calc(var(--bottom-nav-height) + 14px); }
  .bottom-nav-item { font-size: 9px; }
  .bottom-nav-item .nav-icon { font-size: 20px; }
}

/* Hide footer on mobile (bottom nav replaces it) */
@media (max-width: 640px) {
  .footer-desktop { display: none; }
}

/* Cart drawer handle on mobile */
@media (max-width: 640px) {
  .cart-drawer::before {
    content: '';
    display: block;
    width: 40px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 12px auto -4px;
    flex-shrink: 0;
  }
}

/* Prevent iOS zoom on input focus */
@media (max-width: 640px) {
  input[type="text"],
  input[type="email"],
  input[type="password"],
  input[type="number"],
  input[type="tel"],
  select,
  textarea {
    font-size: 16px !important;
  }
}

/* Safe area for devices with notch/home indicator */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .bottom-nav {
    padding-bottom: env(safe-area-inset-bottom);
    height: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom));
  }
}

.link-button { background: none; border: none; padding: 0; color: var(--orange); font-weight: 800; cursor: pointer; text-decoration: underline; }
.link-button:hover { opacity: 0.82; }
.add-cart-btn:disabled, .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Chat responsive fix: kolom chat tetap terlihat di HP ── */
.chat-page { width: 100%; }
.chat-layout-wrap { align-items: stretch; }
.chat-list-card, .chat-room-card { min-width: 0; }
.chat-message-area { min-height: 0; }
.chat-input-row { background: #fff; flex-shrink: 0; }
.chat-input-row .form-input { min-width: 0; }

@media (max-width: 640px) {
  .chat-page {
    padding-left: 10px !important;
    padding-right: 10px !important;
    padding-bottom: calc(var(--bottom-nav-height) + 18px) !important;
  }
  .chat-layout-wrap {
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
    grid-template-columns: 1fr !important;
    width: 100% !important;
    max-width: 100% !important;
    overflow: visible !important;
  }
  .chat-list-card {
    width: 100% !important;
    max-height: 240px;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    flex-shrink: 0;
  }
  .chat-room-card {
    width: 100% !important;
    min-height: calc(100vh - 360px) !important;
    height: calc(100vh - 360px);
    max-height: 560px;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }
  .chat-message-area {
    flex: 1 1 auto !important;
    min-height: 180px;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 12px !important;
  }
  .chat-input-row {
    position: sticky;
    bottom: 0;
    z-index: 2;
    padding: 10px !important;
    gap: 8px !important;
    align-items: center;
  }
  .chat-input-row .form-input {
    flex: 1 1 auto !important;
    width: 100% !important;
    min-width: 0 !important;
    height: 44px;
  }
  .chat-input-row .btn-primary {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 14px !important;
    white-space: nowrap;
  }
}

@media (max-width: 380px) {
  .chat-list-card { max-height: 210px; }
  .chat-room-card {
    min-height: calc(100vh - 335px) !important;
    height: calc(100vh - 335px);
  }
  .chat-input-row .btn-primary { padding: 0 11px !important; }
}

/* Push notification activation banner */
.push-notification-banner {
  position: sticky;
  top: 0;
  z-index: 9999;
  background: linear-gradient(135deg, #111827, #374151);
  border-bottom: 1px solid rgba(255,255,255,.12);
}
.push-notification-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 9px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.push-notification-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: rgba(255,255,255,.14);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.push-notification-btn {
  border: none;
  background: #fff;
  color: #111827;
  font-weight: 800;
  padding: 9px 14px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 8px 22px rgba(0,0,0,.18);
}
.push-notification-btn:disabled {
  opacity: .65;
  cursor: not-allowed;
}
@media (max-width: 640px) {
  .push-notification-inner {
    align-items: flex-start;
    padding: 8px 12px;
  }
  .push-notification-btn {
    padding: 8px 12px;
    font-size: 12px;
  }
}

/* ============================================================
   PROFESSIONAL MARKETPLACE POLISH - SAFE ADDITIVE LAYER
   Fokus: UI rapi, cart selection, checkout premium, tanpa ubah search.
   ============================================================ */
:root {
  --market-shadow-soft: 0 10px 30px rgba(15, 23, 42, 0.08);
  --market-shadow-card: 0 6px 18px rgba(15, 23, 42, 0.06);
  --market-border-soft: 1px solid rgba(226, 232, 240, 0.9);
  --market-radius-xl: 18px;
}

button { touch-action: manipulation; }
button:disabled { opacity: 0.55; cursor: not-allowed !important; transform: none !important; }

.card, .product-card, .dash-card, .stat-card, .modal, .cart-drawer {
  border: var(--market-border-soft);
  box-shadow: var(--market-shadow-card);
}

.product-card {
  border-radius: 14px !important;
  overflow: hidden;
  background: #fff;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.product-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.12);
  border-color: rgba(238, 77, 45, .25);
}
.product-card img {
  background: linear-gradient(135deg, #fff7ed, #f8fafc);
}

.hero-banner {
  box-shadow: 0 18px 45px rgba(238, 77, 45, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.btn-primary, .btn-ghost, .btn-danger, .btn-sm, .add-cart-btn {
  border-radius: 10px !important;
  font-weight: 700;
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease, border-color .15s ease;
}
.btn-primary:hover:not(:disabled), .add-cart-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(238, 77, 45, .22);
}
.btn-ghost:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #fff7ed !important;
  border-color: rgba(238, 77, 45, .35) !important;
}

.cart-drawer {
  width: min(420px, 100vw);
  background: linear-gradient(180deg, #ffffff 0%, #fffefe 100%);
}
.cart-drawer-header {
  background: linear-gradient(180deg, #fff 0%, #fff7ed 100%);
}
.cart-select-row {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin: -2px 0 10px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
}
.cart-check-label, .cart-item-check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.cart-check-label input, .cart-item-check input {
  width: 18px;
  height: 18px;
  accent-color: var(--orange);
  cursor: pointer;
}
.cart-item {
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(226, 232, 240, .9);
  border-radius: 14px;
  margin-bottom: 10px;
  background: #fff;
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.cart-item-selected {
  border-color: rgba(238, 77, 45, .35);
  background: #fffaf7;
  box-shadow: 0 8px 20px rgba(238, 77, 45, .08);
}
.cart-item-img {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  background: #f8fafc;
}
.cart-item-info { flex: 1; min-width: 0; }
.cart-item-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 5px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cart-item-price {
  color: var(--orange);
  font-weight: 800;
  font-size: 15px;
}
.cart-remove-btn {
  margin-left: 8px;
  background: #fff1f2 !important;
  border: 1px solid #fecdd3 !important;
  color: #e11d48 !important;
  font-size: 12px !important;
  cursor: pointer;
  border-radius: 8px !important;
  padding: 0 9px !important;
  width: auto !important;
}
.cart-summary-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 14px;
}
.cart-summary-box div { display: flex; flex-direction: column; gap: 2px; }
.cart-summary-label { font-size: 12px; color: var(--text3); }
.cart-summary-price { font-weight: 900; color: var(--orange); font-size: 18px; }

.checkout-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.checkout-summary-card {
  background: linear-gradient(180deg, #fff 0%, #fff7ed 100%);
  border: 1px solid #fed7aa;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 8px 18px rgba(238, 77, 45, .07);
}
.checkout-summary-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 12px;
}
.checkout-item-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  align-items: center;
}
.checkout-item-row img {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  object-fit: cover;
  background: #f8fafc;
}
.checkout-item-info { flex: 1; min-width: 0; }
.checkout-item-info div {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.checkout-item-info span { font-size: 12px; color: var(--text3); }
.checkout-item-row strong { color: var(--orange); font-size: 13px; white-space: nowrap; }
.checkout-total-row {
  display: flex;
  justify-content: space-between;
  font-weight: 800;
  font-size: 15px;
}
.checkout-total-row span:last-child { color: var(--orange); font-size: 17px; }

.form-input {
  border-radius: 10px !important;
  border-color: #e2e8f0 !important;
  transition: box-shadow .15s ease, border-color .15s ease;
}
.form-input:focus {
  border-color: rgba(238, 77, 45, .7) !important;
  box-shadow: 0 0 0 3px rgba(238, 77, 45, .10);
  outline: none;
}

.bottom-nav {
  border-top: 1px solid rgba(226, 232, 240, .95);
  box-shadow: 0 -10px 28px rgba(15, 23, 42, 0.10);
}
.bottom-nav-item.active .nav-icon {
  transform: translateY(-1px);
}

@media (max-width: 640px) {
  .cart-drawer { height: 88vh; }
  .cart-item { gap: 9px; padding: 10px; }
  .cart-item-img { width: 64px; height: 64px; }
  .cart-select-row { font-size: 11px; }
  .checkout-item-row strong { font-size: 12px; }
  .modal { max-height: 94vh; }
}

/* Location product filter */
.location-filter-card {
  background: linear-gradient(135deg, #ffffff 0%, #fff7ed 100%);
  border: 1px solid rgba(251, 146, 60, .32);
  border-radius: 18px;
  padding: 16px;
  margin: 0 0 22px;
  box-shadow: 0 12px 28px rgba(238, 77, 45, .08);
}
.location-filter-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}
.location-filter-title {
  font-size: 16px;
  font-weight: 900;
  color: var(--text);
}
.location-filter-subtitle {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text2);
}
.location-active-badge {
  background: var(--orange);
  color: #fff;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  box-shadow: 0 8px 18px rgba(238, 77, 45, .22);
}
.location-filter-controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
}
.location-field label {
  display: block;
  font-size: 12px;
  font-weight: 800;
  color: var(--text2);
  margin-bottom: 6px;
}
.location-field select.form-input {
  min-height: 42px;
  background: #fff;
}
.location-reset-btn {
  min-height: 42px;
  border: 1.5px solid var(--orange);
  background: #fff;
  color: var(--orange);
  font-weight: 800;
  padding: 0 14px;
  border-radius: 12px;
  cursor: pointer;
  transition: .15s ease;
}
.location-reset-btn:hover:not(:disabled) {
  background: var(--orange-light);
  transform: translateY(-1px);
}
.location-reset-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}
.location-filter-result {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text3);
  font-weight: 700;
}

@media (max-width: 768px) {
  .location-filter-head { flex-direction: column; }
  .location-active-badge { align-self: flex-start; }
  .location-filter-controls { grid-template-columns: 1fr; }
  .location-reset-btn { width: 100%; }
}
