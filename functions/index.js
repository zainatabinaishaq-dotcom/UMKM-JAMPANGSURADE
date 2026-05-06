const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

async function getUserTokensByIds(userIds = []) {
  const tokens = [];
  for (const uid of userIds.filter(Boolean)) {
    const snap = await db.collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() : null;
    if (data?.notificationEnabled !== false && data?.fcmToken) tokens.push(data.fcmToken);
  }
  return tokens;
}

async function getAdminTokens() {
  const tokens = [];
  const snap = await db.collection("users").where("role", "in", ["admin", "sub_admin"]).get();
  snap.forEach((doc) => {
    const data = doc.data();
    if (data?.notificationEnabled !== false && data?.fcmToken) tokens.push(data.fcmToken);
  });
  return tokens;
}

exports.sendPushOnNotificationCreate = onDocumentCreated("notifications/{notifId}", async (event) => {
  const notif = event.data?.data();
  if (!notif) return;

  let tokens = [];
  if (notif.userId) tokens = await getUserTokensByIds([notif.userId]);
  else if (notif.role === "admin") tokens = await getAdminTokens();

  tokens = [...new Set(tokens)].filter(Boolean);
  if (!tokens.length) return;

  const payload = {
    notification: {
      title: notif.title || "Notifikasi Baru",
      body: notif.message || "Ada aktivitas baru di UMKM Digital.",
    },
    data: {
      notificationId: event.params.notifId,
      type: String(notif.type || "notification"),
      chatId: String(notif.chatId || ""),
      orderId: String(notif.orderId || ""),
      page: notif.type === "chat_message" ? "chat" : "notif",
    },
    webpush: {
      fcmOptions: {
        link: notif.type === "chat_message" ? "/?page=chat" : "/?page=notif",
      },
    },
    tokens,
  };

  const result = await admin.messaging().sendEachForMulticast(payload);

  const invalidTokens = [];
  result.responses.forEach((response, index) => {
    const code = response.error?.code || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (invalidTokens.length && notif.userId) {
    const userRef = db.collection("users").doc(notif.userId);
    const userSnap = await userRef.get();
    if (userSnap.data()?.fcmToken && invalidTokens.includes(userSnap.data().fcmToken)) {
      await userRef.set({ notificationEnabled: false, fcmToken: admin.firestore.FieldValue.delete() }, { merge: true });
    }
  }
});
