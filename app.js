import { firebaseEnabled, firebaseConfig } from "./firebase-config.js";

const $ = id => document.getElementById(id);
const authView=$("authView"), lobbyView=$("lobbyView"), gameView=$("gameView");
let mode="guest", localGame=null, currentUser=null, currentMatch=null, myRole="p1";
let localRecord=JSON.parse(localStorage.getItem("wow-local-record")||'{"wins":0,"losses":0}');

function show(v){[authView,lobbyView,gameView].forEach(x=>x.classList.add("hidden"));v.classList.remove("hidden")}
function saveRecord(){localStorage.setItem("wow-local-record",JSON.stringify(localRecord));$("wins").textContent=localRecord.wins;$("losses").textContent=localRecord.losses}
function guest(){mode="guest";$("wins").textContent=localRecord.wins;$("losses").textContent=localRecord.losses;$("userLabel").textContent="Guest — record saved in this browser";$("randomBtn").textContent="Play Local Match";$("opponentEmail").disabled=true;$("challengeBtn").disabled=true;$("queueMsg").textContent="Guest mode: play against the computer.";show(lobbyView)}
function canUse(p,m){return m==="shoot"?p.ammo>=1:m==="mana_shoot"?p.mana>=2:true}

function startLocal(){
 localGame={status:"active",turn:1,result:null,
  p1:{email:"You",living:true,ammo:0,mana:0,move:null,clashTime:null},
  p2:{email:"Computer Wizard",living:true,ammo:0,mana:0,move:null,clashTime:null}};
 currentMatch="local";myRole="p1";$("resultModal").classList.add("hidden");show(gameView);render();
}
function computerMove(){
 const e=localGame.p2,a=["rel","mana_rel","block","trash"];
 if(e.ammo>0)a.push("shoot"); if(e.mana>=2)a.push("mana_shoot");
 return a[Math.floor(Math.random()*a.length)];
}
function resolveLocal(){
 const d=localGame,p=d.p1,e=d.p2;
 e.move=computerMove();
 const clash=(p.move==="shoot"&&e.move==="shoot")||(p.move==="mana_shoot"&&e.move==="mana_shoot");
 if(clash){
  p.clashTime=100+Math.floor(Math.random()*700);e.clashTime=100+Math.floor(Math.random()*700);
  if(p.clashTime<e.clashTime)e.living=false;else if(e.clashTime<p.clashTime)p.living=false;else{p.living=false;e.living=false}
 }else{
  if(p.move==="rel")p.ammo++; if(p.move==="mana_rel")p.mana++;
  if(e.move==="rel")e.ammo++; if(e.move==="mana_rel")e.mana++;
  if(p.move==="shoot")p.ammo--; if(p.move==="mana_shoot")p.mana-=2;
  if(e.move==="shoot")e.ammo--; if(e.move==="mana_shoot")e.mana-=2;
  if((e.move==="shoot"&&p.move!=="block")||(e.move==="trash"&&p.move==="block")||(e.move==="mana_shoot"&&p.move!=="shoot"))p.living=false;
  if((p.move==="shoot"&&e.move!=="block")||(p.move==="trash"&&e.move==="block")||(p.move==="mana_shoot"&&e.move!=="shoot"))e.living=false;
 }
 if(!p.living||!e.living){d.status="finished";d.result=p.living&&!e.living?"p1":e.living&&!p.living?"p2":"draw";render();finishLocal();return}
 d.turn++;p.move=e.move=null;p.clashTime=e.clashTime=null;render()
}
function finishLocal(){
 if(localGame.result==="p1")localRecord.wins++;else localRecord.losses++;
 saveRecord();$("resultTitle").textContent=localGame.result==="p1"?"Victory!":"Defeat!";
 $("resultText").textContent=localGame.result==="p1"?"You defeated the computer.":"The computer defeated you.";
 $("resultModal").classList.remove("hidden")
}
function render(){
 const d=localGame,p=d.p1,e=d.p2;
 $("gameOpponent").textContent=e.email;$("turnTitle").textContent=`Turn ${d.turn} Commands & Rules`;
 $("playerAmmo").textContent=p.ammo;$("playerMana").textContent=p.mana;$("enemyAmmo").textContent=e.ammo;$("enemyMana").textContent=e.mana;
 $("playerStatus").textContent=p.living?"ALIVE":"DEFEATED";$("enemyStatus").textContent=e.living?"ALIVE":"DEFEATED";
 $("playerReady").textContent=p.move?"LOCKED IN":"CHOOSING...";$("enemyReady").textContent=e.move?"LOCKED IN":"CHOOSING...";
 $("playerMove").textContent=p.move||"None";$("enemyMove").textContent=e.move||"None";
 document.querySelectorAll("[data-move]").forEach(b=>b.disabled=!!p.move||!p.living||!canUse(p,b.dataset.move));
 const clash=p.move&&e.move&&((p.move==="shoot"&&e.move==="shoot")||(p.move==="mana_shoot"&&e.move==="mana_shoot"));
 $("clashBanner").classList.toggle("hidden",!clash);
 if(clash)$("clashBanner").textContent=`SPEED CLASH! ${p.move==="shoot"?"Press H":"Press J"}!`;
}
function choose(m){if(mode==="guest"&&localGame&&!localGame.p1.move&&canUse(localGame.p1,m)){localGame.p1.move=m;render();setTimeout(resolveLocal,350)}}
document.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>choose(b.dataset.move));
addEventListener("keydown",e=>{const m={w:"rel",s:"mana_rel",a:"block",d:"trash",h:"shoot",j:"mana_shoot"}[e.key.toLowerCase()];if(m&&!gameView.classList.contains("hidden")){e.preventDefault();choose(m)}});

$("randomBtn").onclick=()=>startLocal();
$("guestBtn").onclick=guest;
$("backLobbyBtn").onclick=()=>{$("resultModal").classList.add("hidden");show(lobbyView);localGame=null};
$("leaveGameBtn").onclick=()=>{localGame=null;show(lobbyView)};

$("googleBtn").onclick=()=>alert("Firebase is not connected yet. Choose Play without an account, or enable Firebase in firebase-config.js.");
$("emailSignInBtn").onclick=()=>alert("Firebase is not connected yet. Choose Play without an account, or enable Firebase in firebase-config.js.");
$("emailSignUpBtn").onclick=()=>alert("Firebase is not connected yet. Choose Play without an account, or enable Firebase in firebase-config.js.");
$("signOutBtn").onclick=()=>show(authView);

saveRecord();

// Firebase is deliberately loaded only when enabled. A missing/broken Firebase setup
// therefore cannot prevent the page from loading or prevent guest mode.
if(firebaseEnabled){
 import("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js")
 .then(async ({initializeApp})=>{
   const {getAuth,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,createUserWithEmailAndPassword,onAuthStateChanged,signOut}=await import("https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js");
   const fapp=initializeApp(firebaseConfig),auth=getAuth(fapp);
   $("googleBtn").onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){guest()}};
   $("emailSignInBtn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,$("emailInput").value,$("passwordInput").value)}catch(e){guest()}};
   $("emailSignUpBtn").onclick=async()=>{try{await createUserWithEmailAndPassword(auth,$("emailInput").value,$("passwordInput").value)}catch(e){guest()}};
   $("signOutBtn").onclick=()=>signOut(auth);
   onAuthStateChanged(auth,u=>{if(u){currentUser=u;mode="account";$("userLabel").textContent=u.email||u.displayName||"Signed in";show(lobbyView)}});
 }).catch(()=>guest());
}
