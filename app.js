import { firebaseEnabled, firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const initialState = () => ({ ammo: 1, mana: 2, living: true, move: null, clashTime: null, turn: 0 });

let online = false, user = null, auth = null, db = null, fs = null;
let roomId = null, role = null, roomRef = null, roomUnsub = null, queueUnsub = null;
let stats = { wins: 0, losses: 0 }, guestStats = loadGuestStats();
let currentRoom = null, currentChallenge = null, currentChallengeUnsub = null;
let resolving = false, recordedResults = new Set();

function loadGuestStats(){ try { return JSON.parse(localStorage.getItem("wow_guest_stats_v3")) || {wins:0,losses:0}; } catch { return {wins:0,losses:0}; } }
function saveGuestStats(){ localStorage.setItem("wow_guest_stats_v3", JSON.stringify(guestStats)); }
function renderStats(){ $("wins").textContent=stats.wins; $("losses").textContent=stats.losses; }
function setPanel(id,on){ $(id).hidden=!on; }
function lobby(t){ $("lobbyStatus").textContent=t; }
function gameStatus(t){ $("gameStatus").textContent=t; }
function setMenu(){ setPanel("menuPanel",true); setPanel("gamePanel",false); setPanel("challengePanel",false); setPanel("incomingPanel",false); }
function setGame(){ setPanel("menuPanel",false); setPanel("gamePanel",true); setPanel("challengePanel",false); setPanel("incomingPanel",false); }

function renderRoom(r){
  if(!r) return;
  const me=r.state?.[role]||initialState(), other=role==="a"?"b":"a", op=r.state?.[other]||initialState();
  $("myAmmo").textContent=me.ammo; $("myMana").textContent=me.mana;
  $("enemyAmmo").textContent=op.ammo; $("enemyMana").textContent=op.mana;
  $("myHp").style.width=me.living?"100%":"0%"; $("enemyHp").style.width=op.living?"100%":"0%";
  $("turnLabel").textContent=`Turn ${(r.state?.turn||0)+1}`;
  document.querySelectorAll("#moves button").forEach(b=>b.disabled=!!me.move || !me.living || r.status!=="active");
}

async function init(){
  stats=guestStats; renderStats();
  if(!firebaseEnabled){ online=false; $("systemStatus").textContent="Guest mode: Firebase is disabled in firebase-config.js."; return; }
  try{
    const v="12.2.1";
    const [appMod,authMod,dbMod,fsMod]=await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-database.js`),
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`)
    ]);
    const app=appMod.initializeApp(firebaseConfig);
    auth=authMod.getAuth(app); db=dbMod.getDatabase(app); fs=fsMod.getFirestore(app);
    window.FB={appMod,authMod,dbMod,fsMod}; online=true;
    $("systemStatus").textContent="Firebase SDK loaded; checking database connection…";
    const {ref,onValue}=dbMod;
    onValue(ref(db,".info/connected"),snap=>{
      const connected=snap.val()===true;
      $("systemStatus").textContent=connected ? "Firebase connected. Guest mode is also available." : "Firebase Authentication loaded; Realtime Database is offline/not connected.";
    },err=>$("systemStatus").textContent=`Realtime Database error: ${err.message||err}`);
    authMod.onAuthStateChanged(auth, async u=>{
      user=u;
      $("authStatus").textContent=u?`Signed in as ${u.email||u.displayName||"Google user"}.`:"Playing as a guest.";
      $("googleBtn").textContent=u?"Sign out":"Sign in with Google";
      $("emailBtn").hidden=!!u;
      if(u){ try{ await ensurePlayer(); listenChallenges(); } catch(e){ console.error(e); $("authStatus").textContent=`Signed in, but profile setup failed: ${friendlyError(e)}`; } }
      else { stats=guestStats; renderStats(); if(currentChallengeUnsub) currentChallengeUnsub(); }
    });
  }catch(e){ console.error(e); online=false; $("systemStatus").textContent=`Firebase setup error: ${friendlyError(e)}`; }
}

function friendlyError(e){
  const c=e?.code||"", m=e?.message||String(e);
  if(c.includes("permission-denied")) return "permission denied by Firebase security rules.";
  if(c==="auth/invalid-credential") return "incorrect email or password.";
  if(c==="auth/email-already-in-use") return "that email already has an account.";
  if(c==="auth/weak-password") return "password must be at least 6 characters.";
  if(c==="auth/operation-not-allowed") return "this sign-in method is disabled in Firebase Authentication.";
  if(c==="auth/popup-blocked") return "Google sign-in popup was blocked by the browser.";
  if(c==="auth/unauthorized-domain") return "this GitHub Pages domain is not authorized in Firebase Authentication.";
  return m;
}

async function emailKey(email){
  const bytes=new TextEncoder().encode(email.trim().toLowerCase());
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function ensurePlayer(){
  const {doc,getDoc,setDoc}=window.FB.fsMod;
  const email=(user.email||"").trim().toLowerCase();
  const ref=doc(fs,"players",user.uid), s=await getDoc(ref);
  if(!s.exists()) await setDoc(ref,{email,wins:0,losses:0,createdAt:Date.now()});
  else { const d=s.data(); stats={wins:d.wins||0,losses:d.losses||0}; renderStats(); }
  if(email){
    const key=await emailKey(email);
    await setDoc(doc(fs,"playerLookup",key),{uid:user.uid,email},{merge:true});
  }
}
async function saveStats(){
  if(!user)return;
  const {doc,setDoc}=window.FB.fsMod;
  await setDoc(doc(fs,"players",user.uid),{email:(user.email||"").toLowerCase(),wins:stats.wins,losses:stats.losses},{merge:true});
}

async function google(){
  if(!online){ alert("Firebase is not loaded. Check the system message below the lobby."); return; }
  try{ await window.FB.authMod.signInWithPopup(auth,new window.FB.authMod.GoogleAuthProvider()); }
  catch(e){ alert(`Google sign-in failed: ${friendlyError(e)}`); }
}
async function signInEmail(){
  if(!online){ alert("Firebase is not loaded."); return; }
  const email=prompt("Email address:"); if(!email)return;
  const password=prompt("Password:"); if(!password)return;
  try{ await window.FB.authMod.signInWithEmailAndPassword(auth,email.trim(),password); }
  catch(e){ alert(`Email sign-in failed: ${friendlyError(e)}`); }
}
async function createEmail(){
  if(!online){ alert("Firebase is not loaded."); return; }
  const email=prompt("New account email address:"); if(!email)return;
  const password=prompt("New password (at least 6 characters):"); if(!password)return;
  try{ await window.FB.authMod.createUserWithEmailAndPassword(auth,email.trim(),password); }
  catch(e){ alert(`Account creation failed: ${friendlyError(e)}`); }
}
async function authButton(){ if(user) await window.FB.authMod.signOut(auth); else await google(); }

function legal(s,m){ return !(m==="shoot"&&s.ammo<1) && !(m==="mana_shoot"&&s.mana<2); }
function spend(s,m){ if(m==="rel")s.ammo++; if(m==="mana_rel")s.mana++; if(m==="shoot")s.ammo--; if(m==="mana_shoot")s.mana-=2; }
function resolve(a,b){
  if((a==="shoot"&&b==="shoot")||(a==="mana_shoot"&&b==="mana_shoot"))return "clash";
  if(a==="shoot")return b==="block"?"blocked":"hit";
  if(a==="mana_shoot")return b==="shoot"?"blocked":"hit";
  if(a==="trash")return b==="block"?"hit":"none";
  return "none";
}

let guestMe=initialState(),guestEnemy=initialState();
function startGuest(){
  online=false; guestMe=initialState(); guestEnemy=initialState(); setGame(); renderRoom({state:{a:guestMe,b:guestEnemy},status:"active"}); gameStatus("Guest battle: choose a move. The computer will lock its move too.");
}
function guestBattle(myMove){
  if(!legal(guestMe,myMove)){gameStatus("Not enough ammo or mana.");return;}
  document.querySelectorAll("#moves button").forEach(b=>b.disabled=true); gameStatus("Your move is locked. Computer is choosing…");
  const playerMove=myMove;
  setTimeout(()=>{
    const moves=["rel","mana_rel","block","trash","shoot","mana_shoot"];
    let em=moves[Math.floor(Math.random()*moves.length)]; while(!legal(guestEnemy,em))em=moves[Math.floor(Math.random()*moves.length)];
    const a={...guestMe},b={...guestEnemy}; spend(a,playerMove); spend(b,em);
    const result=resolve(playerMove,em);
    if(result==="clash"){
      const pt=performance.now(), ai=performance.now()+40+Math.random()*220;
      if(Math.abs(pt-ai)<4){a.living=false;b.living=false}else if(pt<ai)b.living=false;else a.living=false;
    }else{ if(resolve(playerMove,em)==="hit")b.living=false; if(resolve(em,playerMove)==="hit")a.living=false; }
    guestMe={...a,turn:guestMe.turn+1}; guestEnemy={...b,turn:guestEnemy.turn+1};
    renderRoom({state:{a:guestMe,b:guestEnemy},status:"active"});
    if(!guestMe.living&&!guestEnemy.living){guestStats.losses++;guestStats.wins++;gameStatus("Double KO.");}
    else if(!guestEnemy.living){guestStats.wins++;gameStatus("You won!");}
    else if(!guestMe.living){guestStats.losses++;gameStatus("You lost!");}
    else gameStatus(`Turn resolved. Computer used ${em.replace("mana_","mana ")}.`);
    saveGuestStats(); stats=guestStats; renderStats();
  },350);
}

function makeRoomObject(aUid,bUid){
  const ids=[aUid,bUid].sort(); return {status:"active",createdAt:Date.now(),players:{a:{uid:ids[0]},b:{uid:ids[1]}},state:{turn:0,a:initialState(),b:initialState(),resolvedTurn:-1}};
}
async function makeRoom(aUid,bUid){
  const {ref,set}=window.FB.dbMod, ids=[aUid,bUid].sort(), id=ids.join("_");
  await set(ref(db,`rooms/${id}`),makeRoomObject(ids[0],ids[1])); return id;
}
function watchRoom(id){
  if(roomUnsub)roomUnsub(); roomId=id; const {ref,onValue}=window.FB.dbMod; roomRef=ref(db,`rooms/${id}`);
  roomUnsub=onValue(roomRef,s=>{
    const r=s.val(); if(!r)return; currentRoom=r; setGame(); renderRoom(r);
    const me=r.state?.[role], op=r.state?.[role==="a"?"b":"a"];
    if(r.status==="waiting")gameStatus("Waiting for opponent…");
    else if(r.status==="active"){
      if(me?.move&&op?.move&&r.state.resolvedTurn!==r.state.turn)gameStatus("Both moves locked — resolving…");
      else gameStatus(me?.move?"Move locked. Waiting for opponent…":"Choose a move.");
      resolveTurnIfNeeded(r).catch(e=>{console.error(e);gameStatus(`Turn error: ${friendlyError(e)}`);});
    }else if(r.status==="finished"){
      const w=r.result?.winner; gameStatus(w==="draw"?"Double KO.":w===user.uid?"You won!":"You lost!");
    }else if(r.status==="abandoned")gameStatus("The match was abandoned.");
  },e=>{console.error(e);gameStatus(`Room error: ${friendlyError(e)}`);});
}

async function resolveTurnIfNeeded(r){
  if(resolving)return; const st=r.state; if(!st?.a?.move||!st?.b?.move||st.resolvedTurn===st.turn)return; resolving=true;
  try{
    const {ref,runTransaction,update}=window.FB.dbMod, stateRef=ref(db,`rooms/${roomId}/state`);
    let outcome=null;
    await runTransaction(stateRef,state=>{
      if(!state?.a?.move||!state?.b?.move||state.resolvedTurn===state.turn)return state;
      const a={...state.a},b={...state.b},am=a.move,bm=b.move;
      const clash=resolve(am,bm)==="clash";
      if(clash){ const at=a.clashTime,bt=b.clashTime; if(at==null||bt==null)return state; if(at===bt){a.living=false;b.living=false;outcome="draw"} else if(at<bt){b.living=false;outcome=a.uid} else {a.living=false;outcome=b.uid} }
      else { if(resolve(am,bm)==="hit")b.living=false; if(resolve(bm,am)==="hit")a.living=false; if(!a.living&&!b.living)outcome="draw"; else if(!a.living)outcome=b.uid; else if(!b.living)outcome=a.uid; }
      if(!a.living||!b.living)return {...state,a,b,resolvedTurn:state.turn,resultWinner:outcome};
      a.move=null;b.move=null;a.clashTime=null;b.clashTime=null;a.turn=(state.turn||0)+1;b.turn=(state.turn||0)+1;
      return {...state,a,b,turn:(state.turn||0)+1,resolvedTurn:state.turn};
    });
    const fresh=currentRoom?.state;
    if(fresh?.resultWinner){
      await update(roomRef,{status:"finished",result:{winner:fresh.resultWinner}});
      if(!recordedResults.has(roomId)){
        recordedResults.add(roomId);
        if(fresh.resultWinner===user.uid){stats.wins++;await saveStats();renderStats();}
        else if(fresh.resultWinner!=="draw"){stats.losses++;await saveStats();renderStats();}
      }
    }
  } finally { resolving=false; }
}

async function submitMove(m){
  if(!online||!user||!roomId){guestBattle(m);return;}
  const me=currentRoom?.state?.[role]; if(!me?.living||me.move||currentRoom?.status!=="active")return;
  if(!legal(me,m)){gameStatus("Not enough ammo or mana.");return;}
  const next={...me,move:m}; spend(next,m); if(m==="shoot"||m==="mana_shoot")next.clashTime=Date.now();
  try{ await window.FB.dbMod.update(window.FB.dbMod.ref(db,`rooms/${roomId}/state/${role}`),next); gameStatus("Move locked. Waiting for opponent…"); }
  catch(e){gameStatus(`Move failed: ${friendlyError(e)}`);}
}

async function quickMatch(){
  if(!user){startGuest();return;}
  const {ref,set,remove,runTransaction,onValue}=window.FB.dbMod, qref=ref(db,`matchmaking/${user.uid}`);
  try{ await set(qref,{uid:user.uid,email:user.email||"",createdAt:Date.now()}); }catch(e){lobby(`Matchmaking error: ${friendlyError(e)}`);return;}
  $("quickBtn").disabled=true; $("cancelBtn").hidden=false; lobby("Searching for an opponent…");
  if(queueUnsub)queueUnsub();
  queueUnsub=onValue(ref(db,"matchmaking"),async snap=>{
    const q=snap.val()||{}, mine=q[user.uid];
    const matchedBy=Object.values(q).find(x=>x?.matchedWith===user.uid);
    const partner=mine?.matchedWith || matchedBy?.uid;
    if(partner){
      const ids=[user.uid,partner].sort(), id=ids.join("_");
      try{ await set(ref(db,`rooms/${id}`),makeRoomObject(ids[0],ids[1])); await remove(qref); role=user.uid===ids[0]?"a":"b"; watchRoom(id); $("quickBtn").disabled=false; $("cancelBtn").hidden=true; lobby("Opponent found!"); }catch(e){lobby(`Match found, but room creation failed: ${friendlyError(e)}`);}
      return;
    }
    const candidates=Object.values(q).filter(x=>x.uid&&x.uid!==user.uid&&!x.matchedWith).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    if(!candidates.length)return;
    const op=candidates[0];
    const claim=await runTransaction(ref(db,`matchmaking/${op.uid}`),current=>{
      if(!current||current.matchedWith||current.uid!==op.uid)return current;
      return {...current,matchedWith:user.uid};
    });
    if(!claim.committed)return;
  });
}
async function cancelMatch(){ if(user&&online)try{await window.FB.dbMod.remove(window.FB.dbMod.ref(db,`matchmaking/${user.uid}`));}catch{} $("quickBtn").disabled=false;$("cancelBtn").hidden=true;lobby("Matchmaking cancelled."); }

function listenChallenges(){
  if(currentChallengeUnsub)currentChallengeUnsub(); const {collection,query,where,onSnapshot}=window.FB.fsMod;
  currentChallengeUnsub=onSnapshot(query(collection(fs,"challenges"),where("toUid","==",user.uid),where("status","==","pending")),snap=>{
    const d=snap.docs[0]; if(!d){setPanel("incomingPanel",false);return;} currentChallenge={id:d.id,...d.data()}; $("incomingText").textContent=`${currentChallenge.fromEmail||"A player"} challenged you.`; setPanel("incomingPanel",true);
  },e=>console.error("Challenge listener:",e));
}
async function sendChallenge(){
  if(!user){alert("Sign in first.");return;} const email=$("challengeEmail").value.trim().toLowerCase(); if(!email)return;
  try{
    const {doc,getDoc,collection,addDoc}=window.FB.fsMod, key=await emailKey(email), lookup=await getDoc(doc(fs,"playerLookup",key));
    if(!lookup.exists()){$("challengeStatus").textContent="No Firebase account was found for that email.";return;}
    const target=lookup.data(); if(target.uid===user.uid){$("challengeStatus").textContent="You cannot challenge yourself.";return;}
    await addDoc(collection(fs,"challenges"),{fromUid:user.uid,fromEmail:user.email||"",toUid:target.uid,toEmail:email,status:"pending",createdAt:Date.now()}); $("challengeStatus").textContent="Challenge sent.";
  }catch(e){$("challengeStatus").textContent=`Challenge failed: ${friendlyError(e)}`;}
}
async function acceptChallenge(){
  if(!currentChallenge||!user)return;
  const challenge=currentChallenge;
  try{
    const ids=[user.uid,challenge.fromUid].sort(), id=await makeRoom(ids[0],ids[1]); role=user.uid===ids[0]?"a":"b";
    await window.FB.fsMod.updateDoc(window.FB.fsMod.doc(fs,"challenges",challenge.id),{status:"accepted"});
    currentChallenge=null; setPanel("incomingPanel",false); watchRoom(id);
  }catch(e){ alert(`Accept failed: ${friendlyError(e)}`); console.error(e); }
}
async function declineChallenge(){ if(!currentChallenge)return; try{await window.FB.fsMod.updateDoc(window.FB.fsMod.doc(fs,"challenges",currentChallenge.id),{status:"declined"});setPanel("incomingPanel",false);currentChallenge=null;}catch(e){alert(`Decline failed: ${friendlyError(e)}`);} }

function showEmailMenu(){
  const choice=prompt("Type 1 to sign in, or 2 to create a new account:");
  if(choice==="1")signInEmail(); else if(choice==="2")createEmail();
}

$("googleBtn").onclick=authButton; $("emailBtn").onclick=showEmailMenu; $("guestBtn").onclick=startGuest;
$("quickBtn").onclick=quickMatch; $("cancelBtn").onclick=cancelMatch;
$("challengeBtn").onclick=()=>{if(!user){alert("Sign in first.");return;}setPanel("menuPanel",false);setPanel("challengePanel",true)};
$("closeChallengeBtn").onclick=setMenu; $("sendChallengeBtn").onclick=sendChallenge; $("acceptBtn").onclick=acceptChallenge; $("declineBtn").onclick=declineChallenge;
$("leaveBtn").onclick=async()=>{if(roomRef&&user)try{await window.FB.dbMod.update(roomRef,{status:"abandoned"});}catch(e){console.error(e)}roomId=null;role=null;setMenu();};
document.querySelectorAll("#moves button").forEach(b=>b.onclick=()=>submitMove(b.dataset.move));
addEventListener("keydown",e=>{if(e.repeat||$("gamePanel").hidden)return;const m={w:"rel",s:"mana_rel",a:"block",d:"trash",h:"shoot",j:"mana_shoot"}[e.key.toLowerCase()];if(m){e.preventDefault();submitMove(m);}});
init();
