// ============================================================
//  AUTENTICACIÓN
//  ------------------------------------------------------------
//  Reglas de negocio (modelo "por link"):
//   - Cualquiera que tenga el link del sistema puede crear su
//     propia cuenta (correo + contraseña, o Google) sin que el
//     Director tenga que autorizarlo antes. Al registrarse, se le
//     crea automáticamente un perfil en Firestore
//     ("usuariosAutorizados/{correo}") con rol: "Ejecutivo JR 2G"
//     (el nivel más bajo del escalafón) y activo: true.
//   - Escalafón, de menor a mayor: "Ejecutivo JR 2G" → "Ejecutivo
//     JR 1G" → "Ejecutivo SR" → "Líder JR" → "Líder SR" →
//     "Director". El Director sube/baja a cada quien de nivel a
//     mano, desde la consola de Firebase (editando el campo "rol"
//     de su documento en usuariosAutorizados) — no hay forma de
//     cambiar el propio nivel desde la app.
//   - El Director es la única cuenta con rol: "Director" — ese
//     perfil se crea UNA VEZ, a mano, desde la consola de Firebase
//     (no por la app). Con ese rol ve los datos de todo el equipo;
//     los demás (cualquier nivel de Ejecutivo o Líder) solo ven lo
//     suyo (eso lo controla firestore.rules).
//   - Si el Director desactiva a alguien (activo: false) desde la
//     consola, esa persona ve "Acceso restringido" al entrar.
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (sel) => document.querySelector(sel);

const authScreen = $("#auth-screen");
const appScreen = $("#app-screen");
const authMsg = $("#auth-msg");
const restrictedView = $("#restricted-view");
const politicaBox = $("#politica-box");

const forms = {
  login: $("#form-login"),
  register: $("#form-register"),
  reset: $("#form-reset"),
};

// Perfil del usuario autenticado + autorizado (lo usa app.js)
export const sesion = {
  user: null,
  perfil: null, // { nombre, rol, activo }
};

function mostrarMensaje(texto, tipo = "error") {
  authMsg.textContent = texto;
  authMsg.className = `auth-msg show ${tipo}`;
}

function ocultarMensaje() {
  authMsg.className = "auth-msg";
}

function mostrarFormulario(nombre) {
  ocultarMensaje();
  restrictedView.style.display = "none";
  Object.entries(forms).forEach(([key, form]) => {
    form.classList.toggle("active", key === nombre);
    form.style.display = key === nombre ? "block" : "none";
  });
}

document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => mostrarFormulario(btn.dataset.goto));
});

$("#btn-ver-politica").addEventListener("click", () => {
  politicaBox.style.display = politicaBox.style.display === "none" ? "block" : "none";
});

$("#btn-restricted-logout").addEventListener("click", async () => {
  await signOut(auth);
  restrictedView.style.display = "none";
  mostrarFormulario("login");
});

function emailKey(email) {
  return email.trim().toLowerCase();
}

async function buscarAutorizacion(email) {
  const ref = doc(db, "usuariosAutorizados", emailKey(email));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}

// ---------- Login con correo/contraseña ----------
forms.login.addEventListener("submit", async (e) => {
  e.preventDefault();
  ocultarMensaje();
  const email = $("#login-email").value;
  const password = $("#login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged se encarga del resto (validar autorización)
  } catch (err) {
    mostrarMensaje(traducirError(err));
  }
});

// ---------- Registro (primera vez) ----------
forms.register.addEventListener("submit", async (e) => {
  e.preventDefault();
  ocultarMensaje();
  const nombre = $("#reg-nombre").value.trim();
  const email = $("#reg-email").value;
  const pass1 = $("#reg-password").value;
  const pass2 = $("#reg-password-confirm").value;
  const acepta = $("#reg-consent").checked;

  if (!nombre) {
    mostrarMensaje("Escribe tu nombre completo.");
    return;
  }
  if (!acepta) {
    mostrarMensaje("Debes aceptar la política de tratamiento de datos personales.");
    return;
  }
  if (pass1 !== pass2) {
    mostrarMensaje("Las contraseñas no coinciden.");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass1);
    // Se crea su propio perfil de negocio automáticamente, siempre en
    // el nivel más bajo del escalafón ("Ejecutivo JR 2G") — nadie
    // puede autoasignarse un nivel mayor desde aquí, eso lo impone
    // también firestore.rules. El Director lo va subiendo de nivel
    // a mano, desde la consola de Firebase.
    await setDoc(doc(db, "usuariosAutorizados", emailKey(email)), {
      nombre,
      rol: "Ejecutivo JR 2G",
      activo: true,
    });
    mostrarMensaje("Cuenta creada. Ingresando…", "success");
    await entrarSiCorresponde(cred.user);
  } catch (err) {
    mostrarMensaje(traducirError(err));
  }
});

// ---------- Recuperar contraseña ----------
forms.reset.addEventListener("submit", async (e) => {
  e.preventDefault();
  ocultarMensaje();
  const email = $("#reset-email").value;
  try {
    await sendPasswordResetEmail(auth, email);
    mostrarMensaje("Te enviamos un enlace para restablecer tu contraseña.", "success");
  } catch (err) {
    mostrarMensaje(traducirError(err));
  }
});

// ---------- Google ----------
$("#btn-google").addEventListener("click", async () => {
  ocultarMensaje();
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    const existente = await buscarAutorizacion(cred.user.email);
    if (!existente) {
      // Primera vez con Google: se crea su perfil automáticamente,
      // igual que en el registro con correo/contraseña (nivel más
      // bajo del escalafón).
      await setDoc(doc(db, "usuariosAutorizados", emailKey(cred.user.email)), {
        nombre: cred.user.displayName || cred.user.email,
        rol: "Ejecutivo JR 2G",
        activo: true,
      });
    }
    await entrarSiCorresponde(cred.user);
  } catch (err) {
    mostrarMensaje(traducirError(err));
  }
});

// ---------- Logout (botón dentro de la app) ----------
document.addEventListener("click", async (e) => {
  if (e.target && e.target.id === "btn-logout") {
    await signOut(auth);
  }
});

// Revisa si el usuario tiene perfil de negocio válido y muestra la
// app o la pantalla de "acceso restringido". Se llama tanto desde
// el observador de sesión como justo después de un registro nuevo
// (para no depender de que onAuthStateChanged vuelva a dispararse).
async function entrarSiCorresponde(user) {
  const autorizacion = await buscarAutorizacion(user.email);
  if (!autorizacion || autorizacion.activo === false) {
    authScreen.style.display = "flex";
    appScreen.style.display = "none";
    Object.values(forms).forEach((f) => (f.style.display = "none"));
    restrictedView.style.display = "block";
    return;
  }

  sesion.user = user;
  sesion.perfil = autorizacion;

  authScreen.style.display = "none";
  appScreen.style.display = "block";

  const label = document.getElementById("user-email-label");
  if (label) label.textContent = `${autorizacion.nombre || user.email} · ${autorizacion.rol || "equipo"}`;

  document.dispatchEvent(new CustomEvent("sesion-lista", { detail: sesion }));
}

// ---------- Observador de sesión ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    sesion.user = null;
    sesion.perfil = null;
    appScreen.style.display = "none";
    authScreen.style.display = "flex";
    mostrarFormulario("login");
    return;
  }
  await entrarSiCorresponde(user);
});

function traducirError(err) {
  const code = err && err.code ? err.code : "";
  const mapa = {
    "auth/invalid-email": "El correo no es válido.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Intenta ingresar.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de terminar.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento e intenta de nuevo.",
  };
  return mapa[code] || "Ocurrió un error. Intenta de nuevo.";
}
