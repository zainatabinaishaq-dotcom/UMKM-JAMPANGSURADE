/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

const firebaseConfig = {
  "apiKey": "AIzaSyDRNzXPlIHiyI_ESkx2pul9vRWn9cwYNic",
  "authDomain": "umkmjampangsurade.firebaseapp.com",
  "projectId": "umkmjampangsurade",
  "storageBucket": "umkmjampangsurade.firebasestorage.app",
  "messagingSenderId": "780437005999",
  "appId": "1:780437005999:web:e1ad2610cdf9f55ade165a"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || payload?.data?.title || "Notifikasi Baru";
  const options = {
    body: payload?.notification?.body || payload?.data?.body || payload?.data?.message || "Ada aktivitas baru di UMKM Digital.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload?.data?.tag || payload?.messageId || `umkm-${Date.now()}`,
    renotify: true,
    data: {
      page: payload?.data?.page || (payload?.data?.chatId ? "chat" : "notif"),
      chatId: payload?.data?.chatId || null,
      url: payload?.data?.url || "/",
    },
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const page = event.notification?.data?.page || "notif";
  const targetUrl = new URL(`/?page=${encodeURIComponent(page)}`, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.focus();
          client.postMessage({ type: "UMKM_OPEN_PAGE", page });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
