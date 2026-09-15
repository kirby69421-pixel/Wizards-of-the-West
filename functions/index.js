const {onUserCreated} = require("firebase-functions/v2/identity");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");

initializeApp();

function emailKey(email) {
  return (email || "").trim().toLowerCase().replace(/[.#$[\]/]/g, "_");
}

exports.indexUserEmail = onUserCreated(async (event) => {
  const user = event.data;
  if (!user.email) return;
  await getDatabase().ref(`emailIndex/${emailKey(user.email)}`).set({
    uid: user.uid,
    email: user.email.toLowerCase()
  });
});
