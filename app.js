import { firebaseEnabled, firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const initialState = () => ({ammo:1,mana:2,living:true,move:null,clashTime:null,turn:0});

let online=false, user=null, auth=null, db=null, fs=null;
let roomId=null, role=null, roomRef=null, roomUnsub=null, queueUnsub=null;
let stats={wins:0,losses:0};
let guestStats=loadGuestStats();
let currentRoom=null, currentChallenge=null, currentChallengeUnsub=null;

function loadGuestStats(){try{return JSON.parse(localStorage.getItem("wow_guest_stats_v2"))||{wins:0,losses:0}}catch{return {wins:0,losses:0}}}
function saveGuestStats(){localStorage.setItem("wow_guest_stats_v2",JSON.stringify(guestStats))}
function renderStats(){$("wins").textContent=stats.wins;$("losses").textContent=stats.losses}
function setPanel(id,on){$(id).hidden=!on}
function lobby(t){$("lobbyStatus").textContent=t}
function gameStatus(t){$("gameStatus").textContent=t}
function setMenu(){setPanel("menuPanel",true);setPanel("gamePanel",false);setPanel("challengePanel",false);setPanel("incomingPanel",false)}
function setGame(){setPanel("menuPanel",false);setPanel("gamePanel",true);setPanel("challengePanel",false);setPanel("incomingPanel",false)}

function renderRoom(r){
  if(!r)return;
  const me=r.state?.[role]||initialState();
  const other=role==="a"?"b":"a";
  const op=r.state?.[other]||initialState();
  $("myAmmo").textContent=me.ammo;$("myMana").textContent=me.mana;
  $("enemyAmmo").textContent=op.ammo;$("enemyMana").textContent=op.mana;
  $("myHp").style.width=me.living?"100%":"0%";
  $("enemyHp").style.width=op.living?"100%":"0%";
  $("turnLabel").textContent=`Turn ${(r.state?.turn||0)+1}`;
}

async function init(){
  renderStats();
  if(!firebaseEnabled){online=false;$("systemStatus").textContent="Guest mode: Firebase is disabled in firebase-config.js.";return}
  try{
    const [appMod,authMod,dbMod,fsMod]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js"),
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js")
    ]);
    const app=appMod.initializeApp(firebaseConfig);
    auth=authMod.getAuth(app);db=dbMod.getDatabase(app);fs=fsMod.getFirestore(app);
    window.FB={appMod,authMod,dbMod,fsMod};
    online=true;$("systemStatus").textContent="Firebase connected. Guest mode is also available.";
    authMod.onAuthStateChanged(auth, async u=>{
      user=u;
      $("authStatus").textContent=u?`Signed in as ${u.email||u.displayName||"Google user"}.`:"Playing as a guest.";
      $("googleBtn").textContent=u?"Sign out":"Sign in with Google";
      $("emailBtn").hidden=!!u;
      if(u){await ensurePlayer();listenChallenges();}else{stats={wins:0,losses:0};renderStats()}
    });
  }catch(e){
    console.error(e);online=false;$("systemStatus").textContent="Firebase could not connect. Guest mode is available.";
  }
}

async function ensurePlayer(){
  const {doc,getDoc,setDoc}=window.FB.fsMod;
  const ref=doc(fs,"players",user.uid);const s=await getDoc(ref);
  if(!s.exists())await setDoc(ref,{email:(user.email||"").toLowerCase(),wins:0,losses:0,createdAt:Date.now()});
  else {const d=s.data();stats={wins:d.wins||0,losses:d.losses||0};renderStats()}
}
async function saveStats(){
  if(!user)return;
  const {doc,setDoc}=window.FB.fsMod;
  await setDoc(doc(fs,"players",user.uid),{email:(user.email||"").toLowerCase(),wins:stats.wins,losses:stats.losses},{merge:true});
}

async function google(){
  if(!online){alert("Firebase is not connected. Use guest mode.");return}
  try{await window.FB.authMod.signInWithPopup(auth,new window.FB.authMod.GoogleAuthProvider())}catch(e){alert(e.message)}
}
async function emailAuth(){
  if(!online){alert("Firebase is not connected. Use guest mode.");return}
  const email=prompt("Email address:");if(!email)return;
  const password=prompt("Password (6+ characters):");if(!password)return;
  try{
    await window.FB.authMod.signInWithEmailAndPassword(auth,email,password);
  }catch(e){
    if(e.code==="auth/invalid-credential"||e.code==="auth/user-not-found"){
      try{await window.FB.authMod.createUserWithEmailAndPassword(auth,email,password)}
      catch(x){alert(x.message)}
    }else alert(e.message);
  }
}
async function authButton(){if(user)await window.FB.authMod.signOut(auth);else await google()}

function legal(s,m){
  if(m==="shoot"&&s.ammo<1)return false;
  if(m==="mana_shoot"&&s.mana<2)return false;
  return true;
}
function spend(s,m){
  if(m==="rel")s.ammo++;
  if(m==="mana_rel")s.mana++;
  if(m==="shoot")s.ammo--;
  if(m==="mana_shoot")s.mana-=2;
}
function resolve(a,b){
  if((a==="shoot"&&b==="shoot")||(a==="mana_shoot"&&b==="mana_shoot"))return "clash";
  if(a==="shoot")return b==="block"?"blocked":"hit";
  if(a==="mana_shoot")return b==="shoot"?"blocked":"hit";
  if(a==="trash")return b==="block"?"hit":"none";
  return "none";
}

function guestBattle(myMove){
  if(!legal(guestMe,myMove)){gameStatus("Not enough ammo or mana.");return}
  const moves=["rel","mana_rel","block","trash","shoot","mana_shoot"];
  let em=moves[Math.floor(Math.random()*moves.length)];
  while(!legal(guestEnemy,em))em=moves[Math.floor(Math.random()*moves.length)];
  const a={...guestMe},b={...guestEnemy};spend(a,myMove);spend(b,em);
  const clash=resolve(myMove,em)==="clash";
  if(clash){
    // Simulated reaction time; player gets a small human-like advantage from input timing.
    const playerTime=80+Math.random()*260, aiTime=100+Math.random()*280;
    if(Math.abs(playerTime-aiTime)<4){a.living=false;b.living=false}
    else if(playerTime<aiTime)b.living=false;else a.living=false;
  }else{
    if(resolve(myMove,em)==="hit")b.living=false;
    if(resolve(em,myMove)==="hit")a.living=false;
  }
  guestMe={...a,turn:guestMe.turn+1};guestEnemy={...b,turn:guestEnemy.turn+1};
  $("myAmmo").textContent=guestMe.ammo;$("myMana").textContent=guestMe.mana;
  $("enemyAmmo").textContent=guestEnemy.ammo;$("enemyMana").textContent=guestEnemy.mana;
  $("myHp").style.width=guestMe.living?"100%":"0%";$("enemyHp").style.width=guestEnemy.living?"100%":"0%";
  if(!guestMe.living&&!guestEnemy.living){guestStats.losses++;guestStats.wins++;saveGuestStats();stats=guestStats;renderStats();gameStatus("Double KO.");}
  else if(!guestEnemy.living){guestStats.wins++;saveGuestStats();stats=guestStats;renderStats();gameStatus("You won!");}
  else if(!guestMe.living){guestStats.losses++;saveGuestStats();stats=guestStats;renderStats();gameStatus("You lost!");}
  else gameStatus("Turn resolved.");
}
let guestMe=initialState(),guestEnemy=initialState();
function startGuest(){online=false;guestMe=initialState();guestEnemy=initialState();setGame();renderRoom({state:{a:guestMe,b:guestEnemy},status:"active"});gameStatus("Guest battle: local computer opponent.");}

async function makeRoom(playerA,playerB){
  const {ref,set}=window.FB.dbMod;
  const id=[playerA,playerB].sort().join("_");
  const room={status:"active",createdAt:Date.now(),players:{a:{uid:[playerA,playerB].sort()[0]},b:{uid:[playerA,playerB].sort()[1]}},state:{turn:0,a:{...initialState()},b:{...initialState()},resolvedTurn:-1}};
  await set(ref(db,`rooms/${id}`),room);
  return id;
}
function watchRoom(id){
  if(roomUnsub)roomUnsub();
  const {ref,onValue}=window.FB.dbMod;roomId=id;roomRef=ref(db,`rooms/${id}`);
  roomUnsub=onValue(roomRef,s=>{
    const r=s.val();if(!r)return;currentRoom=r;setGame();renderRoom(r);
    const me=r.state?.[role],op=r.state?.[role==="a"?"b":"a"];
    if(r.status==="waiting")gameStatus("Waiting for opponent…");
    else if(r.status==="active"){
      if(me?.move&&op?.move&&r.state.resolvedTurn!==r.state.turn)gameStatus("Resolving turn…");
      else gameStatus(me?.move?"Waiting for opponent…":"Choose a move.");
      resolveTurnIfNeeded(r).catch(console.error);
    }else if(r.status==="finished"){
      const w=r.result?.winner;
      gameStatus(w==="draw"?"Double KO.":w===user.uid?"You won!":"You lost!");
    }else if(r.status==="abandoned")gameStatus("The match was abandoned.");
  });
}

async function resolveTurnIfNeeded(r){
  const st=r.state;if(!st?.a?.move||!st?.b?.move)return;
  if(st.resolvedTurn===st.turn)return;
  const {ref,runTransaction}=window.FB.dbMod;
  await runTransaction(ref(db,`rooms/${roomId}/state`),state=>{
    if(!state||!state.a?.move||!state.b?.move||state.resolvedTurn===state.turn)return state;
    const a={...state.a},b={...state.b};
    const am=a.move,bm=b.move;
    const clash=resolve(am,bm)==="clash";
    if(clash){
      const at=a.clashTime,bt=b.clashTime;
      if(at==null||bt==null)return state;
      if(at===bt){a.living=false;b.living=false}
      else if(at<bt)b.living=false;else a.living=false;
    }else{
      if(resolve(am,bm)==="hit")b.living=false;
      if(resolve(bm,am)==="hit")a.living=false;
    }
    if(!a.living&&!b.living)return {...state,a,b,resolvedTurn:state.turn,resultWinner:"draw"};
    if(!a.living||!b.living)return {...state,a,b,resolvedTurn:state.turn,resultWinner:a.living?a.uid:b.uid};
    a.move=null;b.move=null;a.clashTime=null;b.clashTime=null;
    a.turn=(state.turn||0)+1;b.turn=(state.turn||0)+1;
    return {...state,a,b,turn:(state.turn||0)+1,resolvedTurn:state.turn};
  });
  const latest=currentRoom?.state;
  if(latest?.resultWinner&&currentRoom.status!=="finished"){
    const {update}=window.FB.dbMod;
    await update(roomRef,{status:"finished",result:{winner:latest.resultWinner}});
    if(latest.resultWinner===user.uid){stats.wins++;await saveStats();renderStats()}
    else if(latest.resultWinner!=="draw"){stats.losses++;await saveStats();renderStats()}
  }
}

async function submitMove(m){
  if(!online||!user||!roomId){guestBattle(m);return}
  const me=currentRoom?.state?.[role];if(!me?.living||me.move){return}
  if(!legal(me,m)){gameStatus("Not enough ammo or mana.");return}
  const next={...me};spend(next,m);next.move=m;
  if(m==="shoot"||m==="mana_shoot")next.clashTime=Date.now()+performance.now()%1;
  const {ref,update}=window.FB.dbMod;
  await update(ref(db,`rooms/${roomId}/state/${role}`),next);
  gameStatus("Move sent. Waiting for opponent…");
}

async function quickMatch(){
  if(!user){startGuest();return}
  const {ref,onValue,set,remove}=window.FB.dbMod;
  const qref=ref(db,`matchmaking/${user.uid}`);
  await set(qref,{uid:user.uid,email:user.email||"",createdAt:Date.now()});
  $("quickBtn").disabled=true;$("cancelBtn").hidden=false;lobby("Searching for an opponent…");
  if(queueUnsub)queueUnsub();
  queueUnsub=onValue(ref(db,"matchmaking"),async snap=>{
    const q=snap.val()||{};
    const candidates=Object.values(q).filter(x=>x.uid&&x.uid!==user.uid);
    if(!candidates.length)return;
    const op=candidates.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))[0];
    const ids=[user.uid,op.uid].sort(),id=ids.join("_");
    await set(ref(db,`rooms/${id}`),{status:"active",createdAt:Date.now(),players:{a:{uid:ids[0]},b:{uid:ids[1]}},state:{turn:0,a:initialState(),b:initialState(),resolvedTurn:-1}});
    await remove(ref(db,`matchmaking/${user.uid}`));await remove(ref(db,`matchmaking/${op.uid}`));
    role=user.uid===ids[0]?"a":"b";watchRoom(id);
    $("quickBtn").disabled=false;$("cancelBtn").hidden=true;
  });
}
async function cancelMatch(){if(user){await window.FB.dbMod.remove(window.FB.dbMod.ref(db,`matchmaking/${user.uid}`))} $("quickBtn").disabled=false;$("cancelBtn").hidden=true;lobby("Matchmaking cancelled.");}

function listenChallenges(){
  if(currentChallengeUnsub)currentChallengeUnsub();
  const {collection,query,where,onSnapshot}=window.FB.fsMod;
  currentChallengeUnsub=onSnapshot(query(collection(fs,"challenges"),where("toUid","==",user.uid),where("status","==","pending")),snap=>{
    const d=snap.docs[0];if(!d)return;
    currentChallenge={id:d.id,...d.data()};$("incomingText").textContent=`${currentChallenge.fromEmail||"A player"} challenged you.`;setPanel("incomingPanel",true);
  });
}
async function sendChallenge(){
  if(!user){alert("Sign in first.");return}
  const email=$("challengeEmail").value.trim().toLowerCase();if(!email)return;
  const {collection,query,where,getDocs,addDoc}=window.FB.fsMod;
  const s=await getDocs(query(collection(fs,"players"),where("email","==",email)));
  if(s.empty){$("challengeStatus").textContent="No Firebase account was found for that email.";return}
  const target=s.docs[0];if(target.id===user.uid){$("challengeStatus").textContent="You cannot challenge yourself.";return}
  await addDoc(collection(fs,"challenges"),{fromUid:user.uid,fromEmail:user.email||"",toUid:target.id,toEmail:email,status:"pending",createdAt:Date.now()});
  $("challengeStatus").textContent="Challenge sent.";
}
async function acceptChallenge(){
  if(!currentChallenge)return;
  const ids=[user.uid,currentChallenge.fromUid].sort();const id=await makeRoom(ids[0],ids[1]);
  role=user.uid===ids[0]?"a":"b";
  await window.FB.fsMod.updateDoc(window.FB.fsMod.doc(fs,"challenges",currentChallenge.id),{status:"accepted"});
  watchRoom(id);
}
async function declineChallenge(){
  if(!currentChallenge)return;
  await window.FB.fsMod.updateDoc(window.FB.fsMod.doc(fs,"challenges",currentChallenge.id),{status:"declined"});
  setPanel("incomingPanel",false);currentChallenge=null;
}

$("googleBtn").onclick=authButton;$("emailBtn").onclick=emailAuth;$("guestBtn").onclick=startGuest;
$("quickBtn").onclick=quickMatch;$("cancelBtn").onclick=cancelMatch;
$("challengeBtn").onclick=()=>{if(!user){alert("Sign in first.");return}setPanel("menuPanel",false);setPanel("challengePanel",true)};
$("closeChallengeBtn").onclick=setMenu;$("sendChallengeBtn").onclick=sendChallenge;
$("acceptBtn").onclick=acceptChallenge;$("declineBtn").onclick=declineChallenge;
$("leaveBtn").onclick=async()=>{if(roomRef&&user)await window.FB.dbMod.update(roomRef,{status:"abandoned"});roomId=null;setMenu()};
document.querySelectorAll("#moves button").forEach(b=>b.onclick=()=>submitMove(b.dataset.move));
addEventListener("keydown",e=>{if(e.repeat||$("gamePanel").hidden)return;const m={w:"rel",s:"mana_rel",a:"block",d:"trash",h:"shoot",j:"mana_shoot"}[e.key.toLowerCase()];if(m){e.preventDefault();submitMove(m)}});
init();
