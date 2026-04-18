// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDpCpaKPQ6FHlwwtkWdebjkvdkW1ZY31XE",
  authDomain: "techfest-dev.firebaseapp.com",
  projectId: "techfest-dev",
  storageBucket: "techfest-dev.firebasestorage.app",
  messagingSenderId: "593866835014",
  appId: "1:593866835014:web:45c051bb9c783f5ed1b647",
  measurementId: "G-K9JBKQHBLE"
};// Initialize Firebase

const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
