import { firebaseEnabled, firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const SDK_VERSION = "12.19.0";

const initialState = (uid = null) => ({
  uid,
  ammo: 1,
  mana: 2,
  living: true,
  move: null,
  submittedAt: null,
  turn: 0
});

let online = false;
let user = null;
let auth = null;
let db = null;
let fs = null;

let roomId = null;
let role = null;
let roomRef = null;
let roomUnsub = null;
let queueUnsub = null;
let stats = { wins: 0, losses: 0 };
let guestStats = loadGuestStats();
let currentRoom = null;
let currentChallenge = null;
let currentChallengeUnsub = null;
let guestResolving = false;
let resolvingRoomTurn = null;

function loadGuestStats() {
  try {
    return JSON.parse(localStorage.getItem("wow_guest_stats_v2")) || {wins: 0, losses: 0};
  } catch {
    return {wins: 0, losses: 0};
  }
}
function saveGuestStats() {
  localStorage.setItem("wow_guest_stats_v2", JSON.stringify(guestStats));
}
function renderStats() {
  $("wins").textContent = stats.wins;
  $("losses").textContent = stats.losses;
}
function setPanel(id, on) { $(id).hidden = !on; }
function lobby(t) { $("lobbyStatus").textContent = t; }
function gameStatus(t) { $("gameStatus").textContent = t; }

function setMenu() {
  setPanel("menuPanel", true);
  setPanel("gamePanel", false);
  setPanel("challengePanel", false);
  setPanel("incomingPanel", false);
}
function setGame() {
  setPanel("menuPanel", false);
  setPanel("gamePanel", true);
  setPanel("challengePanel", false);
  setPanel("incomingPanel", false);
}

function renderRoom(r) {
  if (!r) return;
  const me = r.state?.[role] || initialState();
  const other = role === "a" ? "b" : "a";
  const op = r.state?.[other] || initialState();

  $("myAmmo").textContent = me.ammo;
  $("myMana").textContent = me.mana;
  $("enemyAmmo").textContent = op.ammo;
  $("enemyMana").textContent = op.mana;
  $("myHp").style.width = me.living ? "100%" : "0%";
  $("enemyHp").style.width = op.living ? "100%" : "0%";
  $("turnLabel").textContent = `Turn ${(r.state?.turn || 0) + 1}`;

  document.querySelectorAll("#moves button").forEach(b => {
    b.disabled =
      !me.living ||
      !!me.move ||
      r.status !== "active" ||
      !legal(me, b.dataset.move);
  });
}

function showFirebaseError(where, e) {
  console.error(`[Firebase ${where}]`, e);
  const code = e?.code ? ` (${e.code})` : "";
  const message = e?.message || String(e);
  $("systemStatus").textContent = `Firebase error${code}: ${message}`;
}

async function init() {
  renderStats();

  if (!firebaseEnabled) {
    online = false;
    $("systemStatus").textContent =
      "Guest mode: firebaseEnabled is false in firebase-config.js.";
    return;
  }

  try {
    const [appMod, authMod, dbMod, fsMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-database.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
    ]);

    const app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = dbMod.getDatabase(app);
    fs = fsMod.getFirestore(app);

    window.FB = {appMod, authMod, dbMod, fsMod};
    online = true;

    $("systemStatus").textContent =
      "Firebase SDK loaded. Checking Realtime Database connection…";

    // This is a real connection check, unlike the old version which only
    // assumed initialization meant Firebase was reachable.
    const connectedRef = dbMod.ref(db, ".info/connected");
    dbMod.onValue(connectedRef, snap => {
      if (snap.val() === true) {
        $("systemStatus").textContent =
          "Firebase connected. Guest mode is also available.";
      } else {
        $("systemStatus").textContent =
          "Firebase SDK is loaded, but Realtime Database is offline. Check the database URL, rules, and network.";
      }
    });

    authMod.onAuthStateChanged(auth, async u => {
      user = u;
      $("authStatus").textContent =
        u ? `Signed in as ${u.email || u.displayName || "Google user"}.`
          : "Playing as a guest.";
      $("googleBtn").textContent = u ? "Sign out" : "Sign in with Google";
      $("emailBtn").hidden = !!u;

      if (u) {
        try {
          await ensurePlayer();
          listenChallenges();
        } catch (e) {
          showFirebaseError("player setup", e);
        }
      } else {
        stats = {wins: 0, losses: 0};
        renderStats();
      }
    });
  } catch (e) {
    online = false;
    showFirebaseError("initialization", e);
  }
}

async function ensurePlayer() {
  const {doc, getDoc, setDoc} = window.FB.fsMod;
  const ref = doc(fs, "players", user.uid);
  const s = await getDoc(ref);

  if (!s.exists()) {
    stats = {wins: 0, losses: 0};
    await setDoc(ref, {
      email: (user.email || "").toLowerCase(),
      wins: 0,
      losses: 0,
      createdAt: Date.now()
    });
  } else {
    const d = s.data();
    stats = {wins: d.wins || 0, losses: d.losses || 0};
    renderStats();
  }
}

async function saveStats() {
  if (!user) return;
  const {doc, setDoc} = window.FB.fsMod;
  await setDoc(
    doc(fs, "players", user.uid),
    {
      email: (user.email || "").toLowerCase(),
      wins: stats.wins,
      losses: stats.losses
    },
    {merge: true}
  );
}

async function google() {
  if (!online) {
    alert("Firebase is not connected. Check the Firebase error shown at the bottom of the page.");
    return;
  }
  try {
    await window.FB.authMod.signInWithPopup(
      auth,
      new window.FB.authMod.GoogleAuthProvider()
    );
  } catch (e) {
    alert(e.message || String(e));
    console.error(e);
  }
}

async function emailAuth() {
  if (!online) {
    alert("Firebase is not connected. Check the Firebase error shown at the bottom of the page.");
    return;
  }

  const email = prompt("Email address:");
  if (!email) return;
  const password = prompt("Password (6+ characters):");
  if (!password) return;

  const {signInWithEmailAndPassword, createUserWithEmailAndPassword} = window.FB.authMod;

  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (e) {
    // Only try registration when the account truly does not exist.
    if (e.code === "auth/user-not-found") {
      try {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } catch (x) {
        alert(x.message || String(x));
      }
    } else {
      alert(e.message || String(e));
    }
  }
}

async function authButton() {
  if (user) await window.FB.authMod.signOut(auth);
  else await google();
}

function legal(s, m) {
  if (m === "shoot" && s.ammo < 1) return false;
  if (m === "mana_shoot" && s.mana < 2) return false;
  return true;
}

function spend(s, m) {
  if (m === "rel") s.ammo++;
  if (m === "mana_rel") s.mana++;
  if (m === "shoot") s.ammo--;
  if (m === "mana_shoot") s.mana -= 2;
}

function resolve(a, b) {
  if (
    (a === "shoot" && b === "shoot") ||
    (a === "mana_shoot" && b === "mana_shoot")
  ) return "clash";

  if (a === "shoot") return b === "block" ? "blocked" : "hit";
  if (a === "mana_shoot") return b === "shoot" ? "blocked" : "hit";
  if (a === "trash") return b === "block" ? "hit" : "none";
  return "none";
}

function resolveStates(a, b) {
  const am = a.move;
  const bm = b.move;

  if (!am || !bm) return {a, b, finished: false};

  const nextA = {...a};
  const nextB = {...b};

  const outcomeAB = resolve(am, bm);
  const outcomeBA = resolve(bm, am);

  if (outcomeAB === "clash") {
    // submittedAt is assigned by Firebase's server when each move is written.
    // Lower time means the move reached the server first.
    const at = Number(nextA.submittedAt);
    const bt = Number(nextB.submittedAt);

    if (!Number.isFinite(at) || !Number.isFinite(bt)) {
      return {a, b, finished: false};
    }

    if (at === bt) {
      nextA.living = false;
      nextB.living = false;
    } else if (at < bt) {
      nextB.living = false;
    } else {
      nextA.living = false;
    }
  } else {
    if (outcomeAB === "hit") nextB.living = false;
    if (outcomeBA === "hit") nextA.living = false;
  }

  if (!nextA.living && !nextB.living)
    return {a: nextA, b: nextB, finished: true, winner: "draw"};

  if (!nextA.living)
    return {a: nextA, b: nextB, finished: true, winner: nextB.uid};

  if (!nextB.living)
    return {a: nextA, b: nextB, finished: true, winner: nextA.uid};

  nextA.move = null;
  nextB.move = null;
  nextA.submittedAt = null;
  nextB.submittedAt = null;
  nextA.turn = (a.turn || 0) + 1;
  nextB.turn = (b.turn || 0) + 1;

  return {a: nextA, b: nextB, finished: false};
}

function finishGuestBattle(a, b) {
  guestMe = a;
  guestEnemy = b;
  stats = guestStats;

  if (!a.living && !b.living) {
    guestStats.losses++;
    guestStats.wins++;
    gameStatus("Double KO.");
  } else if (!b.living) {
    guestStats.wins++;
    gameStatus("You won!");
  } else if (!a.living) {
    guestStats.losses++;
    gameStatus("You lost!");
  } else {
    gameStatus("Both moves executed. Next turn.");
  }

  saveGuestStats();
  renderStats();
  renderRoom({state: {a: guestMe, b: guestEnemy}, status: "active"});
}

let guestMe = initialState("guest");
let guestEnemy = initialState("computer");

function guestBattle(myMove) {
  if (guestResolving || !legal(guestMe, myMove)) {
    if (!legal(guestMe, myMove)) gameStatus("Not enough ammo or mana.");
    return;
  }

  guestResolving = true;
  const aiMoves = ["rel", "mana_rel", "block", "trash", "shoot", "mana_shoot"];
  let aiMove = aiMoves[Math.floor(Math.random() * aiMoves.length)];

  while (!legal(guestEnemy, aiMove))
    aiMove = aiMoves[Math.floor(Math.random() * aiMoves.length)];

  // Both moves are locked first. They are then resolved together, rather
  // than allowing the computer's action to happen before the player's turn.
  const a = {...guestMe};
  const b = {...guestEnemy};
  spend(a, myMove);
  spend(b, aiMove);
  a.move = myMove;
  b.move = aiMove;

  gameStatus("Both moves locked…");
  renderRoom({state: {a, b}, status: "active"});

  setTimeout(() => {
    const result = resolveStates(a, b);
    guestResolving = false;
    finishGuestBattle(result.a, result.b);
  }, 250);
}

function startGuest() {
  online = false;
  roomId = null;
  role = "a";
  guestMe = initialState("guest");
  guestEnemy = initialState("computer");
  stats = guestStats;
  renderStats();
  setGame();
  renderRoom({state: {a: guestMe, b: guestEnemy}, status: "active"});
  gameStatus("Guest battle: local computer opponent.");
}

async function makeRoom(playerA, playerB) {
  const {ref, set} = window.FB.dbMod;
  const ids = [playerA, playerB].sort();
  const id = ids.join("_");

  const room = {
    status: "active",
    createdAt: Date.now(),
    players: {
      a: {uid: ids[0]},
      b: {uid: ids[1]}
    },
    state: {
      turn: 0,
      a: initialState(ids[0]),
      b: initialState(ids[1])
    }
  };

  await set(ref(db, `rooms/${id}`), room);
  return id;
}

function watchRoom(id) {
  if (roomUnsub) roomUnsub();

  const {ref, onValue} = window.FB.dbMod;
  roomId = id;
  roomRef = ref(db, `rooms/${id}`);

  roomUnsub = onValue(roomRef, snap => {
    const r = snap.val();
    if (!r) return;

    currentRoom = r;
    setGame();
    renderRoom(r);

    const me = r.state?.[role];
    const op = r.state?.[role === "a" ? "b" : "a"];

    if (r.status === "waiting") {
      gameStatus("Waiting for opponent…");
    } else if (r.status === "active") {
      if (me?.move && op?.move)
        gameStatus("Both moves locked. Resolving…");
      else if (me?.move)
        gameStatus("Move locked. Waiting for opponent…");
      else if (op?.move)
        gameStatus("Opponent has locked a move. Choose yours!");
      else
        gameStatus("Choose a move.");

      resolveTurnIfNeeded(r).catch(e => showFirebaseError("turn resolution", e));
    } else if (r.status === "finished") {
      const w = r.result?.winner;
      gameStatus(
        w === "draw" ? "Double KO."
        : w === user?.uid ? "You won!"
        : "You lost!"
      );
    } else if (r.status === "abandoned") {
      gameStatus("The match was abandoned.");
    }
  });
}

async function resolveTurnIfNeeded(r) {
  if (r.status !== "active") return;

  const st = r.state;
  if (!st?.a?.move || !st?.b?.move) return;

  const turn = Number(st.turn || 0);
  if (resolvingRoomTurn === turn) return;
  resolvingRoomTurn = turn;

  const {ref, runTransaction} = window.FB.dbMod;

  try {
    // One atomic transaction owns the entire resolution. Either player can
    // trigger it, but only one transaction can successfully resolve the turn.
    const result = await runTransaction(ref(db, `rooms/${roomId}`), room => {
      if (!room || room.status !== "active") return;

      const state = room.state;
      if (!state?.a?.move || !state?.b?.move) return room;

      const resolved = resolveStates(state.a, state.b);

      if (!resolved.finished) {
        room.state = {
          ...state,
          a: resolved.a,
          b: resolved.b,
          turn: turn + 1
        };
        return room;
      }

      room.state = {
        ...state,
        a: resolved.a,
        b: resolved.b
      };
      room.status = "finished";
      room.result = {winner: resolved.winner};
      return room;
    });

    const finalRoom = result.snapshot.val();
    if (finalRoom?.status === "finished" && finalRoom.result?.winner && user) {
      await updateStatsForFinishedRoom(finalRoom);
    }
  } finally {
    resolvingRoomTurn = null;
  }
}

let scoredRooms = new Set();

async function updateStatsForFinishedRoom(r) {
  const key = roomId;
  if (scoredRooms.has(key)) return;
  scoredRooms.add(key);

  const winner = r.result?.winner;
  if (winner === user.uid) {
    stats.wins++;
    await saveStats();
    renderStats();
  } else if (winner && winner !== "draw") {
    stats.losses++;
    await saveStats();
    renderStats();
  } else if (winner === "draw") {
    // Draws do not count as either a win or loss.
  }
}

async function submitMove(m) {
  if (!online || !user || !roomId) {
    guestBattle(m);
    return;
  }

  const me = currentRoom?.state?.[role];
  if (!me?.living || me.move) return;

  if (!legal(me, m)) {
    gameStatus("Not enough ammo or mana.");
    return;
  }

  const next = {...me};
  spend(next, m);
  next.move = m;

  const {ref, update, serverTimestamp} = window.FB.dbMod;
  next.submittedAt = serverTimestamp();

  try {
    await update(ref(db, `rooms/${roomId}/state/${role}`), next);
    gameStatus("Move locked. Waiting for opponent…");
  } catch (e) {
    showFirebaseError("sending move", e);
  }
}

async function quickMatch() {
  if (!user) {
    startGuest();
    return;
  }

  const {ref, set, remove, runTransaction, onValue} = window.FB.dbMod;
  const myRef = ref(db, `matchmaking/${user.uid}`);

  try {
    await set(myRef, {
      uid: user.uid,
      email: user.email || "",
      createdAt: Date.now()
    });

    $("quickBtn").disabled = true;
    $("cancelBtn").hidden = false;
    lobby("Searching for an opponent…");

    if (queueUnsub) queueUnsub();

    queueUnsub = onValue(ref(db, "matchmaking"), async snap => {
      const q = snap.val() || {};
      const candidates = Object.values(q)
        .filter(x => x?.uid && x.uid !== user.uid)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      if (!candidates.length) return;

      const op = candidates[0];
      const ids = [user.uid, op.uid].sort();
      const id = ids.join("_");

      // The lexicographically smaller UID is the only client allowed to
      // create the room. This avoids both clients racing to create it.
      if (user.uid !== ids[0]) return;

      const roomRefLocal = ref(db, `rooms/${id}`);
      const claim = await runTransaction(roomRefLocal, existing => {
        if (existing) return existing;
        return {
          status: "active",
          createdAt: Date.now(),
          players: {a: {uid: ids[0]}, b: {uid: ids[1]}},
          state: {
            turn: 0,
            a: initialState(ids[0]),
            b: initialState(ids[1])
          }
        };
      });

      if (!claim.committed && !claim.snapshot.exists()) return;

      await remove(ref(db, `matchmaking/${user.uid}`));
      await remove(ref(db, `matchmaking/${op.uid}`));

      role = user.uid === ids[0] ? "a" : "b";
      watchRoom(id);
      $("quickBtn").disabled = false;
      $("cancelBtn").hidden = true;
      lobby("Opponent found!");
    });
  } catch (e) {
    showFirebaseError("matchmaking", e);
    $("quickBtn").disabled = false;
    $("cancelBtn").hidden = true;
  }
}

async function cancelMatch() {
  if (user && online) {
    await window.FB.dbMod.remove(
      window.FB.dbMod.ref(db, `matchmaking/${user.uid}`)
    );
  }
  $("quickBtn").disabled = false;
  $("cancelBtn").hidden = true;
  lobby("Matchmaking cancelled.");
}

function listenChallenges() {
  if (currentChallengeUnsub) currentChallengeUnsub();

  const {collection, query, where, onSnapshot} = window.FB.fsMod;

  currentChallengeUnsub = onSnapshot(
    query(
      collection(fs, "challenges"),
      where("toUid", "==", user.uid),
      where("status", "==", "pending")
    ),
    snap => {
      const d = snap.docs[0];
      if (!d) return;

      currentChallenge = {id: d.id, ...d.data()};
      $("incomingText").textContent =
        `${currentChallenge.fromEmail || "A player"} challenged you.`;
      setPanel("incomingPanel", true);
    },
    e => showFirebaseError("challenge listener", e)
  );
}

async function sendChallenge() {
  if (!user) {
    alert("Sign in first.");
    return;
  }

  const email = $("challengeEmail").value.trim().toLowerCase();
  if (!email) return;

  try {
    const {collection, query, where, getDocs, addDoc} = window.FB.fsMod;
    const s = await getDocs(
      query(collection(fs, "players"), where("email", "==", email))
    );

    if (s.empty) {
      $("challengeStatus").textContent =
        "No Firebase account was found for that email.";
      return;
    }

    const target = s.docs[0];
    if (target.id === user.uid) {
      $("challengeStatus").textContent =
        "You cannot challenge yourself.";
      return;
    }

    await addDoc(collection(fs, "challenges"), {
      fromUid: user.uid,
      fromEmail: user.email || "",
      toUid: target.id,
      toEmail: email,
      status: "pending",
      createdAt: Date.now()
    });

    $("challengeStatus").textContent = "Challenge sent.";
  } catch (e) {
    showFirebaseError("sending challenge", e);
  }
}

async function acceptChallenge() {
  if (!currentChallenge || !user) return;

  try {
    const ids = [user.uid, currentChallenge.fromUid].sort();
    const id = await makeRoom(ids[0], ids[1]);
    role = user.uid === ids[0] ? "a" : "b";

    await window.FB.fsMod.updateDoc(
      window.FB.fsMod.doc(fs, "challenges", currentChallenge.id),
      {status: "accepted"}
    );

    currentChallenge = null;
    setPanel("incomingPanel", false);
    watchRoom(id);
  } catch (e) {
    showFirebaseError("accepting challenge", e);
  }
}

async function declineChallenge() {
  if (!currentChallenge) return;

  try {
    await window.FB.fsMod.updateDoc(
      window.FB.fsMod.doc(fs, "challenges", currentChallenge.id),
      {status: "declined"}
    );
    setPanel("incomingPanel", false);
    currentChallenge = null;
  } catch (e) {
    showFirebaseError("declining challenge", e);
  }
}

$("googleBtn").onclick = authButton;
$("emailBtn").onclick = emailAuth;
$("guestBtn").onclick = startGuest;
$("quickBtn").onclick = quickMatch;
$("cancelBtn").onclick = cancelMatch;

$("challengeBtn").onclick = () => {
  if (!user) {
    alert("Sign in first.");
    return;
  }
  setPanel("menuPanel", false);
  setPanel("challengePanel", true);
};

$("closeChallengeBtn").onclick = setMenu;
$("sendChallengeBtn").onclick = sendChallenge;
$("acceptBtn").onclick = acceptChallenge;
$("declineBtn").onclick = declineChallenge;

$("leaveBtn").onclick = async () => {
  if (roomRef && user && online) {
    try {
      await window.FB.dbMod.update(roomRef, {status: "abandoned"});
    } catch (e) {
      showFirebaseError("leaving match", e);
    }
  }
  if (queueUnsub) {
    queueUnsub();
    queueUnsub = null;
  }
  roomId = null;
  role = null;
  currentRoom = null;
  setMenu();
};

document.querySelectorAll("#moves button").forEach(b => {
  b.onclick = () => submitMove(b.dataset.move);
});

addEventListener("keydown", e => {
  if (e.repeat || $("gamePanel").hidden) return;

  const m = {
    w: "rel",
    s: "mana_rel",
    a: "block",
    d: "trash",
    h: "shoot",
    j: "mana_shoot"
  }[e.key.toLowerCase()];

  if (m) {
    e.preventDefault();
    submitMove(m);
  }
});

init();
