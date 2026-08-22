// ============================================================
//  CONFIGURACIÓN DE FIREBASE
//  ------------------------------------------------------------
//  1. Ve a https://console.firebase.google.com y crea un proyecto
//     (gratis, plan "Spark" alcanza para empezar).
//  2. Dentro del proyecto: ⚙️ Configuración del proyecto → General
//     → "Tus apps" → agrega una app Web (</>) → copia el objeto
//     firebaseConfig que te muestra y pégalo abajo, reemplazando
//     los valores de ejemplo.
//  3. En "Authentication" → Sign-in method, activa:
//       - Correo electrónico/contraseña
//       - Google
//  4. En "Firestore Database", crea una base de datos (modo producción)
//     y sube las reglas del archivo firestore.rules de este proyecto.
//  5. En "Authentication" → Templates puedes personalizar el correo
//     de restablecimiento de contraseña con tu marca.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwL_6LNGL9RiMmjv3FyiRSrZcF6KU_hl4",
  authDomain: "inmobiliariadelmet-ff4a0.firebaseapp.com",
  projectId: "inmobiliariadelmet-ff4a0",
  storageBucket: "inmobiliariadelmet-ff4a0.firebasestorage.app",
  messagingSenderId: "927375999961",
  appId: "1:927375999961:web:d33ac78629a2b3aaa48fc8",
  measurementId: "G-RYTLXZQBPC",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
