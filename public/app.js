import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getDatabase, ref, set, update, get, onValue, onDisconnect,
  runTransaction, push, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, collection, query, where,
  onSnapshot, serverTimestamp as fsServerTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const fs = getFirestore(app);

const $ = id => document.getElementById(id);
const authView = $("authView"), lobbyView = $("lobbyView"), gameView = $("gameView");
let currentUser = null, currentMatch = null, myRole = null, matchUnsub = null;
let queueKey = null, challengeUnsub = null;
let localClashStart = 0, lastRenderedTurn = 0;
let guestMode = false;
let localGame = null;

function enterGuestMode(reason) {
  guestMode = true;
  const saved = JSON.parse(localStorage.getItem("wow-local-record") || "{\"wins\":0,\"losses\":0}");
  $("wins").textContent = saved.wins || 0;
  $("losses").textContent = saved.losses || 0;
  $("userLabel").textContent = "Guest mode — record saved in this browser";
  $("randomBtn").textContent = "Play Local Match";
  $("opponentEmail").disabled = true;
  $("challengeBtn").disabled = true;
  $("queueMsg").textContent = reason || "Playing without an account.";
  show(lobbyView);
}
function saveGuestRecord(wins, losses) {
  localStorage.setItem("wow-local-record", JSON.stringify({wins, losses}));
  $("wins").textContent = wins; $("losses").textContent = losses;
}

function show(view){ [authView,lobbyView,gameView].forEach(v=>v.classList.add("hidden")); view.classList.remove("hidden"); }
function msg(text){ $("authMsg").textContent=text; }
function queueMsg(text){ $("queueMsg").textContent=text; }
function emailKey(email){ return email.trim().toLowerCase().replace(/[.#$[\]/]/g, "_"); }

async function ensureProfile(user){
  const profile = doc(fs, "profiles", user.uid);
  const snap = await getDoc(profile);
  const base = { uid:user.uid, email:(user.email||"").toLowerCase(), wins:0, losses:0, updatedAt:fsServerTimestamp() };
  if(!snap.exists()) await setDoc(profile, base);
  else {
    const old=snap.data();
    await updateDoc(profile,{email:(user.email||old.email||"").toLowerCase(),updatedAt:fsServerTimestamp()});
  }
  const r = await get(ref(db, `users/${user.uid}`));
  if(!r.exists()) await set(ref(db, `users/${user.uid}`), {email:(user.email||"").toLowerCase(),online:true});
  else await update(ref(db, `users/${user.uid}`), {email:(user.email||"").toLowerCase(),online:true});
}

try {
  onAuthStateChanged(auth, async user=>{
    if(guestMode) return;
    if(!user){ currentUser=null; show(authView); if(challengeUnsub)challengeUnsub(); return; }
    currentUser=user;
    try{ await ensureProfile(user); await loadRecord(); setupChallenges(); show(lobbyView); }
    catch(e){ console.error(e); enterGuestMode("Firebase could not load your account. Continuing in guest mode."); }
  });
} catch(e) {
  console.error(e);
  enterGuestMode("Firebase is unavailable. Continuing in guest mode.");
}

async function loadRecord(){
  const snap=await getDoc(doc(fs,"profiles",currentUser.uid));
  const d=snap.data()||{};
  $("wins").textContent=d.wins||0; $("losses").textContent=d.losses||0;
  $("userLabel").textContent=currentUser.email||currentUser.displayName||"Signed in";
}

$("googleBtn").onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){enterGuestMode("Google sign-in is unavailable. Continuing in guest mode.")}};
$("emailSignInBtn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,$("emailInput").value,$("passwordInput").value)}catch(e){enterGuestMode("Account sign-in is unavailable. Continuing in guest mode.")}};
$("emailSignUpBtn").onclick=async()=>{try{await createUserWithEmailAndPassword(auth,$("emailInput").value,$("passwordInput").value)}catch(e){enterGuestMode("Account creation is unavailable. Continuing in guest mode.")}};
$("signOutBtn").onclick=()=>signOut(auth);

async function randomMatch(){
  if(guestMode){ startLocalMatch(); return; }
  if(!currentUser)return;
  $("randomBtn").disabled=true; queueMsg("Looking for an opponent…");
  const qref=ref(db,"matchQueue");
  const token=push(qref).key;
  queueKey=token;
  await set(ref(db,`matchQueue/${token}`),{uid:currentUser.uid,email:currentUser.email.toLowerCase(),createdAt:serverTimestamp()});
  onDisconnect(ref(db,`matchQueue/${token}`)).remove();
  const stop=onValue(qref,async snap=>{
    const entries=[];
    snap.forEach(c=>entries.push({key:c.key,...c.val()}));
    const other=entries.find(x=>x.uid!==currentUser.uid);
    if(!other)return;
    const first=other.createdAt<= (entries.find(x=>x.uid===currentUser.uid)?.createdAt || Infinity);
    const winnerRole=first?"p1":"p2";
    const matchRef=push(ref(db,"matches"));
    const matchId=matchRef.key;
    await set(matchRef,{
      status:"active",turn:1,createdAt:serverTimestamp(),
      p1:{uid:first?other.uid:currentUser.uid,email:first?other.email:currentUser.email.toLowerCase(),living:true,ammo:0,mana:0,move:null,clashTime:null},
      p2:{uid:first?currentUser.uid:other.uid,email:first?currentUser.email.toLowerCase():other.email,living:true,ammo:0,mana:0,move:null,clashTime:null},
      result:null
    });
    await remove(ref(db,`matchQueue/${other.key}`));
    if(queueKey)await remove(ref(db,`matchQueue/${queueKey}`));
    stop(); queueKey=null;
    enterMatch(matchId,winnerRole);
  });
}

$("randomBtn").onclick=randomMatch;

async function findUserByEmail(email){
  // Profiles are indexed by lowercase email for simple static-host deployment.
  // Realtime Database rules below restrict what is exposed to signed-in users.
  const snap=await get(ref(db,"emailIndex/"+emailKey(email)));
  return snap.exists()?snap.val():null;
}

async function challengeOpponent(){
  if(guestMode){ $("queueMsg").textContent="Email challenges require an account."; return; }
  const email=$("opponentEmail").value.trim().toLowerCase();
  if(!email)return queueMsg("Enter an email address.");
  if(email===currentUser.email.toLowerCase())return queueMsg("You cannot challenge yourself.");
  const target=await findUserByEmail(email);
  if(!target)return queueMsg("No account was found for that email.");
  const id=push(ref(db,"challenges")).key;
  await set(ref(db,`challenges/${id}`),{
    fromUid:currentUser.uid,fromEmail:currentUser.email.toLowerCase(),
    toUid:target.uid,toEmail:email,status:"pending",createdAt:serverTimestamp()
  });
  queueMsg("Challenge sent.");
  $("opponentEmail").value="";
}
$("challengeBtn").onclick=challengeOpponent;

function setupChallenges(){
  if(challengeUnsub)challengeUnsub();
  const qref=ref(db,"challenges");
  challengeUnsub=onValue(qref,snap=>{
    const list=[];
    snap.forEach(c=>{const x={key:c.key,...c.val()};if(x.toUid===currentUser.uid&&x.status==="pending")list.push(x)});
    const box=$("challengeList"), panel=$("challengePanel");
    box.innerHTML="";
    panel.classList.toggle("hidden",list.length===0);
    list.forEach(x=>{
      const row=document.createElement("div"); row.className="row";
      const label=document.createElement("span"); label.textContent=x.fromEmail; label.style.flex="1";
      const accept=document.createElement("button"); accept.textContent="Accept"; accept.onclick=()=>acceptChallenge(x);
      row.append(label,accept); box.appendChild(row);
    });
  });
}

async function acceptChallenge(ch){
  const matchRef=push(ref(db,"matches")), matchId=matchRef.key;
  await set(matchRef,{
    status:"active",turn:1,createdAt:serverTimestamp(),
    p1:{uid:ch.fromUid,email:ch.fromEmail,living:true,ammo:0,mana:0,move:null,clashTime:null},
    p2:{uid:currentUser.uid,email:currentUser.email.toLowerCase(),living:true,ammo:0,mana:0,move:null,clashTime:null},
    result:null
  });
  await update(ref(db,`challenges/${ch.key}`),{status:"accepted",matchId});
  enterMatch(matchId,"p2");
}

async function enterMatch(matchId,role){
  currentMatch=matchId; myRole=role; lastRenderedTurn=0; localClashStart=0;
  show(gameView); $("gameOpponent").textContent="Connecting…";
  if(matchUnsub)matchUnsub();
  matchUnsub=onValue(ref(db,`matches/${matchId}`),snap=>{
    const d=snap.val(); if(!d)return;
    renderGame(d);
    maybeResolve(d);
  });
}

function renderGame(d){
  const me=d[myRole], opp=d[myRole==="p1"?"p2":"p1"];
  $("gameOpponent").textContent=opp.email||"Opponent";
  $("turnTitle").textContent=`Turn ${d.turn} Commands & Rules`;
  $("playerAmmo").textContent=me.ammo; $("playerMana").textContent=me.mana;
  $("enemyAmmo").textContent=opp.ammo; $("enemyMana").textContent=opp.mana;
  $("playerStatus").textContent=me.living?"ALIVE":"DEFEATED";
  $("enemyStatus").textContent=opp.living?"ALIVE":"DEFEATED";
  $("playerReady").textContent=me.move?"LOCKED IN":"CHOOSING...";
  $("enemyReady").textContent=opp.move?"LOCKED IN":"CHOOSING...";
  $("playerMove").textContent=me.move||"None"; $("enemyMove").textContent=opp.move||"None";
  document.querySelectorAll("[data-move]").forEach(b=>b.disabled=!!me.move||!me.living||!canUse(me,b.dataset.move));
  if(d.turn!==lastRenderedTurn){lastRenderedTurn=d.turn;localClashStart=0;$("clashBanner").classList.add("hidden")}
  const clash=me.move&&opp.move&&((me.move==="shoot"&&opp.move==="shoot")||(me.move==="mana_shoot"&&opp.move==="mana_shoot"));
  if(clash){
    if(!localClashStart)localClashStart=performance.now();
    const pressed=me.clashTime!=null;
    $("clashBanner").classList.remove("hidden");
    $("clashBanner").textContent=pressed?"LOCKED IN! WAITING…":`SPEED CLASH! PRESS [${me.move==="shoot"?"H":"J"}] NOW!`;
  }
  if(d.status==="finished") showResult(d.result);
}

function canUse(me,move){return move==="shoot"?me.ammo>=1:move==="mana_shoot"?me.mana>=2:true}

function startLocalMatch(){
  localGame={status:"active",turn:1,result:null,
    p1:{uid:"guest",email:"You",living:true,ammo:0,mana:0,move:null,clashTime:null},
    p2:{uid:"cpu",email:"Computer Wizard",living:true,ammo:0,mana:0,move:null,clashTime:null}};
  currentMatch="local"; myRole="p1"; recordedMatch=null; show(gameView); renderGame(localGame);
}
function localComputerMove(){
  const e=localGame.p2, choices=["rel","mana_rel","block","trash"];
  if(e.ammo>0) choices.push("shoot"); if(e.mana>=2) choices.push("mana_shoot");
  return choices[Math.floor(Math.random()*choices.length)];
}
function resolveLocal(){
  const d=localGame,p=d.p1,e=d.p2;e.move=localComputerMove();
  const clash=(p.move==="shoot"&&e.move==="shoot")||(p.move==="mana_shoot"&&e.move==="mana_shoot");
  p.ammo-=p.move==="shoot"?1:0;p.mana-=p.move==="mana_shoot"?2:0;
  e.ammo-=e.move==="shoot"?1:0;e.mana-=e.move==="mana_shoot"?2:0;
  if(p.move==="rel")p.ammo++;if(p.move==="mana_rel")p.mana++;if(e.move==="rel")e.ammo++;if(e.move==="mana_rel")e.mana++;
  if(clash){const pt=Math.random(),et=Math.random();if(pt<et)e.living=false;else if(et<pt)p.living=false;else{p.living=false;e.living=false;}}
  else{if((e.move==="shoot"&&p.move!=="block")||(e.move==="trash"&&p.move==="block")||(e.move==="mana_shoot"&&p.move!=="shoot"))p.living=false;if((p.move==="shoot"&&e.move!=="block")||(p.move==="trash"&&e.move==="block")||(p.move==="mana_shoot"&&e.move!=="shoot"))e.living=false;}
  if(!p.living||!e.living){d.status="finished";d.result=p.living&&!e.living?"p1":e.living&&!p.living?"p2":"draw";renderGame(d);showResult(d.result);}
  else{d.turn++;p.move=null;e.move=null;renderGame(d);}
}
async function chooseMove(move){
  if(guestMode){const me=localGame.p1;if(!me.move&&me.living&&canUse(me,move)){me.move=move;resolveLocal();}return;}
  const snap=await get(ref(db,`matches/${currentMatch}`)); const d=snap.val(); if(!d)return;
  const me=d[myRole]; if(me.move||!me.living||!canUse(me,move))return;
  await update(ref(db,`matches/${currentMatch}/${myRole}`),{move});
}
document.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>chooseMove(b.dataset.move));

window.addEventListener("keydown",e=>{
  if(gameView.classList.contains("hidden"))return;
  const map={w:"rel",s:"mana_rel",a:"block",d:"trash",h:"shoot",j:"mana_shoot"};
  if(map[e.key.toLowerCase()]) {
    e.preventDefault();
    const key=map[e.key.toLowerCase()];
    const banner=!$("clashBanner").classList.contains("hidden");
    if(banner)pressClash(key); else chooseMove(key);
  }
});

async function pressClash(move){
  const snap=await get(ref(db,`matches/${currentMatch}`));const d=snap.val();if(!d)return;
  const me=d[myRole],opp=d[myRole==="p1"?"p2":"p1"];
  if(!me.move||me.clashTime!=null)return;
  const wanted=me.move==="shoot"?"shoot":"mana_shoot";
  if(move!==wanted)return;
  const reaction=Math.max(0,Math.round(performance.now()-localClashStart));
  await update(ref(db,`matches/${currentMatch}/${myRole}`),{clashTime:reaction});
}

async function maybeResolve(d){
  if(d.status!=="active")return;
  const a=d.p1,b=d.p2;
  if(!a.move||!b.move)return;
  const clash=(a.move==="shoot"&&b.move==="shoot")||(a.move==="mana_shoot"&&b.move==="mana_shoot");
  if(clash&& (a.clashTime==null||b.clashTime==null))return;
  // Only p1 resolves. A transaction makes the resolution idempotent.
  if(myRole!=="p1")return;
  const mref=ref(db,`matches/${currentMatch}`);
  await runTransaction(mref,current=>{
    if(!current||current.status!=="active")return current;
    const p=current.p1,e=current.p2;
    if(!p.move||!e.move)return current;
    const isClash=(p.move==="shoot"&&e.move==="shoot")||(p.move==="mana_shoot"&&e.move==="mana_shoot");
    if(isClash&&(p.clashTime==null||e.clashTime==null))return current;

    p.ammo-=p.move==="shoot"?1:0; p.mana-=p.move==="mana_shoot"?2:0;
    e.ammo-=e.move==="shoot"?1:0; e.mana-=e.move==="mana_shoot"?2:0;
    let pDies=false,eDies=false;
    if(isClash){
      if(p.clashTime<e.clashTime)eDies=true;
      else if(e.clashTime<p.clashTime)pDies=true;
      else{pDies=true;eDies=true;}
    }else{
      pDies=(e.move==="shoot"&&p.move!=="block")||(e.move==="trash"&&p.move==="block")||(e.move==="mana_shoot"&&p.move!=="shoot");
      eDies=(p.move==="shoot"&&e.move!=="block")||(p.move==="trash"&&e.move==="block")||(p.move==="mana_shoot"&&e.move!=="shoot");
    }
    p.living=!pDies&&p.living; e.living=!eDies&&e.living;
    const done=!p.living||!e.living;
    if(done){
      current.status="finished";
      current.result=p.living&& !e.living?"p1":e.living&&!p.living?"p2":"draw";
    }else{
      current.turn++;
      p.move=null;p.clashTime=null;e.move=null;e.clashTime=null;
    }
    return current;
  });
}

async function finishRecord(result){
  if(guestMode){const old=JSON.parse(localStorage.getItem("wow-local-record")||"{\"wins\":0,\"losses\":0}");if(result==="p1")old.wins++;else old.losses++;saveGuestRecord(old.wins,old.losses);return;}
  if(!currentUser||!result)return;
  const outcome=result==="draw"?"loss":(result===myRole?"win":"loss");
  const p=doc(fs,"profiles",currentUser.uid);
  const snap=await getDoc(p);const d=snap.data()||{};
  await updateDoc(p,{wins:(d.wins||0)+(outcome==="win"?1:0),losses:(d.losses||0)+(outcome==="loss"?1:0),updatedAt:fsServerTimestamp()});
  await loadRecord();
}

let recordedMatch=null;
function showResult(result){
  if(recordedMatch!==currentMatch){recordedMatch=currentMatch;finishRecord(result)}
  $("resultTitle").textContent=result==="draw"?"Double Knockout!":result===myRole?"Victory!":"Defeat!";
  $("resultText").textContent=result==="draw"?"Both wizards fell.":result===myRole?"You won the duel.":"Your wizard was defeated.";
  $("resultModal").classList.remove("hidden");
}
$("backLobbyBtn").onclick=()=>{ $("resultModal").classList.add("hidden"); if(matchUnsub)matchUnsub(); currentMatch=null; myRole=null; show(lobbyView); };

$("leaveGameBtn").onclick=async()=>{
  if(guestMode){currentMatch=null;localGame=null;show(lobbyView);return;}
  if(currentMatch){
    const snap=await get(ref(db,`matches/${currentMatch}`));const d=snap.val();
    if(d&&d.status==="active"&&d[myRole]?.living){
      // Leaving counts as a loss; the opponent wins.
      const winner=myRole==="p1"?"p2":"p1";
      await update(ref(db,`matches/${currentMatch}`),{status:"finished",result:winner});
    }
  }
  $("resultModal").classList.add("hidden"); if(matchUnsub)matchUnsub(); currentMatch=null;show(lobbyView);
};

// Keep a small online flag updated.
onAuthStateChanged(auth,user=>{
  if(user){
    const uref=ref(db,`users/${user.uid}/online`);
    onDisconnect(uref).set(false);
    set(uref,true);
  }
});

$("guestBtn").onclick = () => enterGuestMode("Guest mode enabled. Online play requires an account.");
