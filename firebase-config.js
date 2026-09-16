// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyARr3MN2CKk4VM6Ck75mfD7-pyrJFRCFBw",
  authDomain: "wizards-of-the-west.firebaseapp.com",
  databaseURL: "https://wizards-of-the-west-default-rtdb.firebaseio.com",
  projectId: "wizards-of-the-west",
  storageBucket: "wizards-of-the-west.firebasestorage.app",
  messagingSenderId: "1040509732205",
  appId: "1:1040509732205:web:4b709edfb9940328998664",
  measurementId: "G-5DD68NQMSH"
};
export const firebaseEnabled = true;
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
