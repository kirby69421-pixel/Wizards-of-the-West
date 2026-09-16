import { firebaseEnabled, firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const SDK = "12.19.0";
const initialState = uid => ({ uid, ammo: 1, mana: 2, living: true, move: null, clashTime: null, turn: 0 });

let online = false, user = null, auth = null, db = null, fs = null;
let roomId = null, role = null, roomRef = null, roomUnsub = null, queueUnsub = null;
let challengeUnsub = null, currentChallenge = null, currentRoom = null;
let stats = { wins: 0, losses: 0 };
let guestStats = loadGuestStats();
let guestMe, guestEnemy;
let resolving = false;

function loadGuestStats() { try { return JSON.parse(localStorage.getItem("wow_guest_stats_v3")) || {wins:0,losses:0}; } catch { return {wins:0,losses:0}; } }
function saveGuestStats() { localStorage.setItem("wow_guest_stats_v3", JSON.stringify(guestStats)); }
function renderStats() { $("wins").textContent = stats.wins; $("losses").textContent = stats.losses; }
function setPanel(id, on) { $(id).hidden = !on; }
function lobby(t) { $("lobbyStatus").textContent = t; }
function gameStatus(t) { $("gameStatus").textContent = t; }
function setMenu() { setPanel("menuPanel", true); setPanel("gamePanel", false); setPanel("challengePanel", false); }
function setGame() { setPanel("menuPanel", false); setPanel("gamePanel", true); setPanel("challengePanel", false); }
function setAuthStatus(t) { $("authStatus").textContent = t; }
function normalizeEmail(email) { return email.trim().toLowerCase(); }
function emailDocId(email) { return encodeURIComponent(normalizeEmail(email)); }
function prettyAuthError(e) {
  const c = e?.code || "";
  if (c === "auth/invalid-credential") return "Incorrect email or password.";
  if (c === "auth/user-not-found") return "No account exists with that email.";
  if (c === "auth/wrong-password") return "Incorrect password.";
  if (c === "auth/email-already-in-use") return "An account already exists with that email. Use Sign In instead.";
  if (c === "auth/weak-password") return "That password is too weak. Use at least 6 characters.";
  if (c === "auth/invalid-email") return "That email address is not valid.";
  if (c === "auth/operation-not-allowed") return "Email/password authentication is disabled in Firebase. Enable it under Authentication → Sign-in method.";
  if (c === "auth/popup-blocked") return "Google sign-in was blocked by the browser. Allow pop-ups for this site and try again.";
  if (c === "auth/popup-closed-by-user") return "Google sign-in was cancelled.";
  if (c === "permission-denied") return "Firebase denied this operation. Check the Firestore/Realtime Database rules from the setup guide.";
  return e?.message || String(e);
}

function renderRoom(r) {
  if (!r || !role) return;
  const me = r.state?.[role] || initialState(user?.uid);
  const other = role === "a" ? "b" : "a";
  const op = r.state?.[other] || initialState();
  $("myAmmo").textContent = me.ammo;
  $("myMana").textContent = me.mana;
  $("enemyAmmo").textContent = op.ammo;
  $("enemyMana").textContent = op.mana;
  $("myHp").style.width = me.living ? "100%" : "0%";
  $("enemyHp").style.width = op.living ? "100%" : "0%";
  $("turnLabel").textContent = `Turn ${(r.state?.turn || 0) + 1}`;
  document.querySelectorAll("#moves button").forEach(b => b.disabled = !!me.move || !me.living || r.status !== "active");
}

async function init() {
  stats = guestStats;
  renderStats();
  if (!firebaseEnabled) {
    online = false;
    $("systemStatus").textContent = "Guest mode: Firebase is disabled in firebase-config.js.";
    return;
  }
  try {
    const [appMod, authMod, dbMod, fsMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-database.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`)
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = dbMod.getDatabase(app);
    fs = fsMod.getFirestore(app);
    window.FB = { appMod, authMod, dbMod, fsMod };
    online = true;
    $("systemStatus").textContent = "Firebase SDK loaded. Checking Realtime Database connection…";
    const connectedRef = dbMod.ref(db, ".info/connected");
    dbMod.onValue(connectedRef, snap => {
      const connected = snap.val() === true;
      $("systemStatus").textContent = connected
        ? "Firebase connected."
        : "Firebase is configured, but Realtime Database is offline/unreachable.";
    });
    authMod.onAuthStateChanged(auth, async u => {
      user = u;
      if (u) {
        setAuthStatus(`Signed in as ${u.email || u.displayName || "Google user"}.`);
        $("googleBtn").textContent = "Sign out";
        $("emailBtn").hidden = true;
        $("signupBtn").hidden = true;
        try { await ensurePlayer(); listenChallenges(); } catch (e) { console.error(e); setAuthStatus(`Signed in, but profile setup failed: ${prettyAuthError(e)}`); }
      } else {
        setAuthStatus("Playing as a guest.");
        $("googleBtn").textContent = "Sign in with Google";
        $("emailBtn").hidden = false;
        $("signupBtn").hidden = false;
        stats = guestStats;
        renderStats();
        if (challengeUnsub) { challengeUnsub(); challengeUnsub = null; }
      }
    });
  } catch (e) {
    console.error("Firebase initialization failed:", e);
    online = false;
    $("systemStatus").textContent = `Firebase initialization failed: ${prettyAuthError(e)} Guest mode is available.`;
  }
}

async function ensurePlayer() {
  const { doc, getDoc, setDoc } = window.FB.fsMod;
  const ref = doc(fs, "players", user.uid);
  const snap = await getDoc(ref);
  const email = normalizeEmail(user.email || "");
  if (!snap.exists()) {
    stats = { wins: 0, losses: 0 };
    await setDoc(ref, { email, displayName: user.displayName || "", wins: 0, losses: 0, createdAt: Date.now() });
  } else {
    const d = snap.data();
    stats = { wins: d.wins || 0, losses: d.losses || 0 };
    await setDoc(ref, { email, displayName: user.displayName || "" }, { merge: true });
  }
  renderStats();
  if (email) {
    await setDoc(doc(fs, "playerLookup", emailDocId(email)), { uid: user.uid, email }, { merge: true });
  }
}

async function saveStats() {
  if (!user) return;
  const { doc, setDoc } = window.FB.fsMod;
  await setDoc(doc(fs, "players", user.uid), { email: normalizeEmail(user.email || ""), wins: stats.wins, losses: stats.losses }, { merge: true });
}

async function google() {
  if (!online) { alert("Firebase is not connected. Use guest mode."); return; }
  try { await window.FB.authMod.signInWithPopup(auth, new window.FB.authMod.GoogleAuthProvider()); }
  catch (e) { alert(prettyAuthError(e)); }
}

async function signInEmail() {
  if (!online) { alert("Firebase is not connected. Use guest mode."); return; }
  const email = prompt("Email address:"); if (!email) return;
  const password = prompt("Password:"); if (!password) return;
  try {
    await window.FB.authMod.signInWithEmailAndPassword(auth, normalizeEmail(email), password);
  } catch (e) { alert(prettyAuthError(e)); }
}

async function signUpEmail() {
  if (!online) { alert("Firebase is not connected. Use guest mode."); return; }
  const email = prompt("New account email address:"); if (!email) return;
  const password = prompt("New password (6+ characters):"); if (!password) return;
  const confirm = prompt("Enter the password again:");
  if (confirm !== password) { alert("The passwords did not match."); return; }
  try {
    await window.FB.authMod.createUserWithEmailAndPassword(auth, normalizeEmail(email), password);
  } catch (e) { alert(prettyAuthError(e)); }
}

async function authButton() {
  if (!user) return google();
  try { await window.FB.authMod.signOut(auth); } catch (e) { alert(prettyAuthError(e)); }
}

function legal(s, m) { return !(m === "shoot" && s.ammo < 1) && !(m === "mana_shoot" && s.mana < 2); }
function spend(s, m) {
  if (m === "rel") s.ammo++;
  if (m === "mana_rel") s.mana++;
  if (m === "shoot") s.ammo--;
  if (m === "mana_shoot") s.mana -= 2;
}
function resolve(a, b) {
  if ((a === "shoot" && b === "shoot") || (a === "mana_shoot" && b === "mana_shoot")) return "clash";
  if (a === "shoot") return b === "block" ? "blocked" : "hit";
  if (a === "mana_shoot") return b === "shoot" ? "blocked" : "hit";
  if (a === "trash") return b === "block" ? "hit" : "none";
  return "none";
}

function finishGuest(a, b) {
  guestMe = a; guestEnemy = b;
  if (!a.living && !b.living) { guestStats.losses++; guestStats.wins++; gameStatus("Double KO."); }
  else if (!b.living) { guestStats.wins++; gameStatus("You won!"); }
  else if (!a.living) { guestStats.losses++; gameStatus("You lost!"); }
  else { gameStatus("Turn resolved. Choose a move for the next turn."); return; }
  saveGuestStats(); stats = guestStats; renderStats(); document.querySelectorAll("#moves button").forEach(b => b.disabled = true);
}

async function guestBattle(myMove) {
  if (!legal(guestMe, myMove)) { gameStatus("Not enough ammo or mana."); return; }
  document.querySelectorAll("#moves button").forEach(b => b.disabled = true);
  gameStatus("Your move is locked. The computer is choosing…");
  await new Promise(r => setTimeout(r, 450));
  const moves = ["rel","mana_rel","block","trash","shoot","mana_shoot"];
  let em = moves[Math.floor(Math.random() * moves.length)];
  while (!legal(guestEnemy, em)) em = moves[Math.floor(Math.random() * moves.length)];
  const a = { ...guestMe }, b = { ...guestEnemy };
  spend(a, myMove); spend(b, em);
  gameStatus(`Both moves locked: ${labelMove(myMove)} vs ${labelMove(em)}. Resolving…`);
  await new Promise(r => setTimeout(r, 500));
  const resultA = resolve(myMove, em), resultB = resolve(em, myMove);
  if (resultA === "clash") {
    const playerTime = 80 + Math.random() * 260;
    const aiTime = 100 + Math.random() * 280;
    if (Math.abs(playerTime - aiTime) < 4) { a.living = false; b.living = false; }
    else if (playerTime < aiTime) b.living = false; else a.living = false;
  } else {
    if (resultA === "hit") b.living = false;
    if (resultB === "hit") a.living = false;
  }
  a.move = b.move = null; a.clashTime = b.clashTime = null; a.turn++; b.turn++;
  renderRoom({state:{a,b}});
  finishGuest(a,b);
}
function labelMove(m) { return ({rel:"Reload",mana_rel:"Mana Reload",block:"Block",trash:"Trash",shoot:"Shoot",mana_shoot:"Mana Shot"})[m] || m; }
function startGuest() {
  if (roomUnsub) { roomUnsub(); roomUnsub = null; }
  roomId = null; role = "a"; currentRoom = null;
  guestMe = initialState("guest"); guestEnemy = initialState("computer");
  setGame(); renderRoom({state:{a:guestMe,b:guestEnemy},status:"active"}); gameStatus("Guest battle: choose a move. Your move and the computer's move resolve together.");
}

async function createRoom(id, aUid, bUid) {
  const { ref, set } = window.FB.dbMod;
  const room = { status:"active", createdAt:Date.now(), players:{a:{uid:aUid},b:{uid:bUid}}, state:{turn:0,a:initialState(aUid),b:initialState(bUid)} };
  await set(ref(db, `rooms/${id}`), room);
}

function watchRoom(id) {
  if (roomUnsub) roomUnsub();
  const { ref, onValue } = window.FB.dbMod;
  roomId = id; roomRef = ref(db, `rooms/${id}`);
  roomUnsub = onValue(roomRef, snap => {
    const r = snap.val();
    if (!r) return;
    currentRoom = r; setGame(); renderRoom(r);
    const me = r.state?.[role], op = r.state?.[role === "a" ? "b" : "a"];
    if (r.status === "waiting") gameStatus("Waiting for opponent…");
    else if (r.status === "active") {
      if (me?.move && op?.move) gameStatus(`Both moves locked: ${labelMove(me.move)} vs ${labelMove(op.move)}. Resolving…`);
      else if (me?.move) gameStatus("Your move is locked. Waiting for opponent…");
      else gameStatus("Choose a move.");
      resolveTurnIfNeeded().catch(e => { console.error(e); gameStatus(`Turn error: ${prettyAuthError(e)}`); });
    } else if (r.status === "finished") {
      const w = r.result?.winner;
      gameStatus(w === "draw" ? "Double KO." : w === user.uid ? "You won!" : "You lost!");
      claimResult(r).catch(console.error);
    } else if (r.status === "abandoned") gameStatus("The match was abandoned.");
  });
}

function outcomeForMoves(am,bm,a,b) {
  const r1 = resolve(am,bm), r2 = resolve(bm,am);
  if (r1 === "clash") {
    const at = a.clashTime, bt = b.clashTime;
    if (at == null || bt == null) return null;
    if (at === bt) { a.living = false; b.living = false; }
    else if (at < bt) b.living = false; else a.living = false;
  } else {
    if (r1 === "hit") b.living = false;
    if (r2 === "hit") a.living = false;
  }
  return true;
}

async function resolveTurnIfNeeded() {
  if (!roomId || resolving || !currentRoom?.state) return;
  const { ref, runTransaction } = window.FB.dbMod;
  resolving = true;
  try {
    await runTransaction(ref(db, `rooms/${roomId}`), room => {
      if (!room || room.status !== "active") return room;
      const st = room.state;
      if (!st?.a?.move || !st?.b?.move) return room;
      const a = {...st.a}, b = {...st.b};
      const am = a.move, bm = b.move;
      const ready = outcomeForMoves(am,bm,a,b);
      if (!ready) return room;
      const nextTurn = (st.turn || 0) + 1;
      const result = (!a.living && !b.living) ? "draw" : !a.living ? b.uid : !b.living ? a.uid : null;
      if (result) {
        a.move = b.move = null; a.clashTime = b.clashTime = null;
        return {...room, status:"finished", result:{winner:result}, state:{...st,a,b,turn:nextTurn}};
      }
      a.move = b.move = null; a.clashTime = b.clashTime = null;
      a.turn = b.turn = nextTurn;
      return {...room, state:{...st,a,b,turn:nextTurn}};
    });
  } finally { resolving = false; }
}

async function claimResult(r) {
  if (!user || !r?.result || r.result.winner === undefined) return;
  const { ref, runTransaction } = window.FB.dbMod;
  const claimRef = ref(db, `rooms/${roomId}/claims/${user.uid}`);
  const tx = await runTransaction(claimRef, v => v || { claimedAt:Date.now() });
  if (!tx.committed || tx.snapshot.val()?.claimedAt === undefined) return;
  if (r.result.winner === user.uid) { stats.wins++; await saveStats(); renderStats(); }
  else if (r.result.winner !== "draw") { stats.losses++; await saveStats(); renderStats(); }
}

async function submitMove(m) {
  if (!online || !user || !roomId) { guestBattle(m); return; }
  const me = currentRoom?.state?.[role];
  if (!me?.living || me.move || currentRoom?.status !== "active") return;
  if (!legal(me,m)) { gameStatus("Not enough ammo or mana."); return; }
  const next = {...me}; spend(next,m); next.move = m;
  if (m === "shoot" || m === "mana_shoot") next.clashTime = Date.now() + performance.now() % 1;
  const { ref, update } = window.FB.dbMod;
  await update(ref(db, `rooms/${roomId}/state/${role}`), next);
  gameStatus("Your move is locked. Waiting for opponent…");
}

async function quickMatch() {
  if (!user) { startGuest(); return; }
  const { ref, onValue, set, remove, runTransaction } = window.FB.dbMod;
  const qref = ref(db, `matchmaking/${user.uid}`);
  await set(qref, {uid:user.uid,email:user.email||"",createdAt:Date.now()});
  $("quickBtn").disabled = true; $("cancelBtn").hidden = false; lobby("Searching for an opponent…");
  if (queueUnsub) queueUnsub();
  queueUnsub = onValue(ref(db,"matchmaking"), async snap => {
    const q = snap.val() || {};
    const candidates = Object.values(q).filter(x => x.uid && x.uid !== user.uid).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    if (!candidates.length) return;
    const op = candidates[0];
    const ids = [user.uid,op.uid].sort(), id = ids.join("_");
    const roomRefLocal = ref(db,`rooms/${id}`);
    const claimed = await runTransaction(roomRefLocal, room => room || {status:"active",createdAt:Date.now(),players:{a:{uid:ids[0]},b:{uid:ids[1]}},state:{turn:0,a:initialState(ids[0]),b:initialState(ids[1])}});
    if (!claimed.committed) return;
    await remove(ref(db,`matchmaking/${user.uid}`));
    await remove(ref(db,`matchmaking/${op.uid}`));
    role = user.uid === ids[0] ? "a" : "b";
    watchRoom(id);
    $("quickBtn").disabled = false; $("cancelBtn").hidden = true; lobby("Opponent found!");
  });
}
async function cancelMatch() {
  if (user) await window.FB.dbMod.remove(window.FB.dbMod.ref(db,`matchmaking/${user.uid}`));
  $("quickBtn").disabled = false; $("cancelBtn").hidden = true; lobby("Matchmaking cancelled.");
}

function listenChallenges() {
  if (challengeUnsub) challengeUnsub();
  const { collection, query, where, onSnapshot } = window.FB.fsMod;
  challengeUnsub = onSnapshot(query(collection(fs,"challenges"),where("toUid","==",user.uid),where("status","==","pending")), snap => {
    const d = snap.docs[0];
    if (!d) { setPanel("incomingPanel",false); return; }
    currentChallenge = {id:d.id,...d.data()};
    $("incomingText").textContent = `${currentChallenge.fromEmail || "A player"} challenged you.`;
    setPanel("incomingPanel",true);
  }, e => console.error("Challenge listener:", e));
}

async function sendChallenge() {
  if (!user) { alert("Sign in first."); return; }
  const email = normalizeEmail($("challengeEmail").value); if (!email) return;
  if (email === normalizeEmail(user.email || "")) { $("challengeStatus").textContent = "You cannot challenge yourself."; return; }
  try {
    const { doc, getDoc, collection, addDoc } = window.FB.fsMod;
    const lookup = await getDoc(doc(fs,"playerLookup",emailDocId(email)));
    if (!lookup.exists()) { $("challengeStatus").textContent = "No Firebase account was found for that email."; return; }
    const target = lookup.data();
    await addDoc(collection(fs,"challenges"), {fromUid:user.uid,fromEmail:user.email||"",toUid:target.uid,toEmail:email,status:"pending",createdAt:Date.now()});
    $("challengeStatus").textContent = "Challenge sent.";
  } catch (e) { $("challengeStatus").textContent = prettyAuthError(e); console.error(e); }
}

async function acceptChallenge() {
  if (!currentChallenge || !user) return;
  try {
    const ids = [user.uid,currentChallenge.fromUid].sort(), id = ids.join("_");
    const { ref, runTransaction } = window.FB.dbMod;
    await runTransaction(ref(db,`rooms/${id}`), room => room || {status:"active",createdAt:Date.now(),players:{a:{uid:ids[0]},b:{uid:ids[1]}},state:{turn:0,a:initialState(ids[0]),b:initialState(ids[1])}});
    role = user.uid === ids[0] ? "a" : "b";
    await window.FB.fsMod.updateDoc(window.FB.fsMod.doc(fs,"challenges",currentChallenge.id),{status:"accepted",acceptedAt:Date.now()});
    setPanel("incomingPanel",false); currentChallenge = null; watchRoom(id);
  } catch (e) { alert(prettyAuthError(e)); }
}
async function declineChallenge() {
  if (!currentChallenge) return;
  try { await window.FB.fsMod.updateDoc(window.FB.fsMod.doc(fs,"challenges",currentChallenge.id),{status:"declined",declinedAt:Date.now()}); } catch(e) { alert(prettyAuthError(e)); }
  setPanel("incomingPanel",false); currentChallenge=null;
}
async function leaveMatch() {
  if (roomUnsub) { roomUnsub(); roomUnsub=null; }
  roomId=null; role=null; currentRoom=null; setMenu(); lobby("Left the match.");
}

document.querySelectorAll("#moves button").forEach(b => b.onclick = () => submitMove(b.dataset.move));
$("googleBtn").onclick = authButton;
$("emailBtn").onclick = signInEmail;
$("signupBtn").onclick = signUpEmail;
$("guestBtn").onclick = startGuest;
$("quickBtn").onclick = quickMatch;
$("cancelBtn").onclick = cancelMatch;
$("challengeBtn").onclick = () => { if (!user) { alert("Sign in first."); return; } setPanel("menuPanel",false); setPanel("challengePanel",true); };
$("sendChallengeBtn").onclick = sendChallenge;
$("closeChallengeBtn").onclick = () => { setPanel("challengePanel",false); setPanel("menuPanel",true); };
$("acceptBtn").onclick = acceptChallenge;
$("declineBtn").onclick = declineChallenge;
$("leaveBtn").onclick = leaveMatch;

init();
