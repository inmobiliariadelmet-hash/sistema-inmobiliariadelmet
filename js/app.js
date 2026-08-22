// ============================================================
//  APP — navegación, dashboard y módulos
// ============================================================

import { db, auth } from "./firebase-config.js";
import { sesion } from "./auth.js";
import { PROYECTOS } from "./data/proyectos.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const main = document.getElementById("app-main");
const navButtons = () => document.querySelectorAll("#app-nav button[data-module]");

// ---------- Utilidades ----------

function fmtMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

function fmtFecha(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function opcionesProyectos() {
  return PROYECTOS.map((p) => `<option value="${p.nombre}">${p.nombre} — ${p.constructora}</option>`).join("");
}

// El Director ve los datos de todo el equipo; cualquier otro rol
// solo ve lo suyo (esto es solo para la interfaz — lo que de verdad
// impide o permite el acceso son las reglas en firestore.rules).
function esDirector() {
  return sesion.perfil?.rol === "Director";
}

// Escalafón del equipo, de menor a mayor nivel. El Director asigna y
// cambia el nivel de cada persona a mano, desde la consola de
// Firebase (campo "rol" en su documento de usuariosAutorizados) — se
// usa aquí solo para mostrar/ordenar, no para permisos.
const RANGOS = ["Ejecutivo JR 2G", "Ejecutivo JR 1G", "Ejecutivo SR", "Líder JR", "Líder SR", "Director"];
const RANGOS_EJECUTIVO = ["Ejecutivo JR 2G", "Ejecutivo JR 1G", "Ejecutivo SR"];

function nivelRango(rol) {
  const i = RANGOS.indexOf(rol);
  return i === -1 ? -1 : i;
}

// Líder JR/SR: no ven datos de clientes de nadie, solo la agenda
// (actividad + fecha, sin detalle) de los tres niveles de Ejecutivo.
function esLider() {
  return sesion.perfil?.rol === "Líder JR" || sesion.perfil?.rol === "Líder SR";
}

// ---------- Utilidades de fecha (para el módulo de Visitas) ----------
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtFechaCorta(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// ---------- Catálogos del módulo de Visitas ----------
const ESTADOS_VISITA = [
  { value: "programada", label: "Programada", color: "#e0a600" },
  { value: "realizada", label: "Realizada", color: "#2e8b57" },
  { value: "no_asistio", label: "No asistió", color: "#c0392b" },
  { value: "cancelada", label: "Cancelada", color: "#6b6b6b" },
];
const RESULTADOS_VISITA = [
  { value: "", label: "— Sin resultado aún —", color: "#999" },
  { value: "interesado", label: "Interesado", color: "#d9822b" },
  { value: "seguimiento", label: "En seguimiento", color: "#3a7bd5" },
  { value: "separo", label: "Separó", color: "#1f6fb2" },
  { value: "no_interesado", label: "No interesado", color: "#c0392b" },
];
const TIPOS_VISITA = ["Visita al proyecto", "Oficina", "Predio"];

function badgeEstadoVisita(valor) {
  const e = ESTADOS_VISITA.find((x) => x.value === valor) || ESTADOS_VISITA[0];
  return `<span class="badge" style="background:${e.color};color:#fff;">${e.label}</span>`;
}
function badgeResultadoVisita(valor) {
  if (!valor) return `<span style="color:var(--texto-suave);">—</span>`;
  const r = RESULTADOS_VISITA.find((x) => x.value === valor);
  if (!r) return "—";
  return `<span class="badge" style="background:${r.color};color:#fff;">${r.label}</span>`;
}

async function pedirUbicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 6000 }
    );
  });
}

// ---------- Navegación ----------

navButtons().forEach((btn) => {
  btn.addEventListener("click", () => irAModulo(btn.dataset.module));
});

function irAModulo(key) {
  navButtons().forEach((b) => b.classList.toggle("active", b.dataset.module === key));
  const modulo = MODULOS[key];
  if (!modulo) {
    main.innerHTML = `<p class="empty-state">Módulo no encontrado.</p>`;
    return;
  }
  modulo.render(main);
}

document.addEventListener("sesion-lista", () => irAModulo("inicio"));

// ============================================================
//  MÓDULO GENÉRICO: formulario + tabla sobre una colección
// ============================================================
//
//  Se usa para casi todos los módulos: cada uno define su
//  colección de Firestore y los campos del formulario. Así,
//  Prospectos, Separaciones, Comisiones, PQRS, Bitácora, Agenda,
//  Acompañamientos, Apadrinamiento, Mapa de Sueños, Ascensos y
//  Panel Estratégico comparten el mismo motor y quedan
//  funcionando de verdad desde el primer día.

async function renderModuloTabla(container, cfg) {
  container.innerHTML = `
    <h2 class="module-title">${cfg.titulo}</h2>
    <p class="module-subtitle">${cfg.subtitulo}</p>

    <div class="card">
      <h3>Nuevo registro</h3>
      <form id="form-nuevo">
        <div class="form-row">
          ${cfg.campos.map((c) => campoHtml(c)).join("")}
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Guardar</button>
      </form>
    </div>

    <div class="card">
      <h3>Registros</h3>
      <div id="tabla-wrap"><p class="empty-state">Cargando…</p></div>
    </div>
  `;

  const form = container.querySelector("#form-nuevo");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = {};
    cfg.campos.forEach((c) => {
      datos[c.key] = form.querySelector(`[name="${c.key}"]`).value;
    });
    if (cfg.calcular) Object.assign(datos, cfg.calcular(datos));
    datos.autor = sesion.perfil?.nombre || sesion.user.email;
    datos.autorEmail = sesion.user.email;
    datos.creado = serverTimestamp();

    await addDoc(collection(db, cfg.coleccion), datos);
    form.reset();
    cargarTabla();
  });

  async function cargarTabla() {
    const wrap = container.querySelector("#tabla-wrap");
    wrap.innerHTML = `<p class="empty-state">Cargando…</p>`;
    try {
      let q = collection(db, cfg.coleccion);
      if (cfg.soloMios) {
        // Siempre solo lo mío, incluso si soy Director (ej. mi agenda).
        q = query(q, where("autorEmail", "==", sesion.user.email));
      } else if (cfg.privadoPorDefecto && !esDirector()) {
        // Cada ejecutivo ve solo lo suyo; el Director ve todo.
        q = query(q, where("autorEmail", "==", sesion.user.email));
      }
      const snap = await getDocs(q);
      let filas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      filas.sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0));

      if (filas.length === 0) {
        wrap.innerHTML = `<p class="empty-state">Todavía no hay registros. Agrega el primero arriba.</p>`;
        return;
      }

      const cols = cfg.columnas;
      wrap.innerHTML = `
        <table>
          <thead><tr>${cols.map((c) => `<th>${c.label}</th>`).join("")}<th></th></tr></thead>
          <tbody>
            ${filas
              .map(
                (f) => `
              <tr data-id="${f.id}">
                ${cols.map((c) => `<td>${c.formato ? c.formato(f[c.key], f) : (f[c.key] ?? "—")}</td>`).join("")}
                <td><button class="btn-link btn-eliminar" data-id="${f.id}">Eliminar</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;

      wrap.querySelectorAll(".btn-eliminar").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar este registro?")) return;
          await deleteDoc(doc(db, cfg.coleccion, btn.dataset.id));
          cargarTabla();
        });
      });
    } catch (err) {
      wrap.innerHTML = `<p class="empty-state">No se pudo cargar (${err.message}). Revisa la configuración de Firebase.</p>`;
    }
  }

  cargarTabla();
}

function campoHtml(c) {
  if (c.tipo === "select") {
    return `
      <div class="field">
        <label>${c.label}</label>
        <select name="${c.key}" ${c.requerido !== false ? "required" : ""}>
          ${c.opciones}
        </select>
      </div>`;
  }
  if (c.tipo === "textarea") {
    return `
      <div class="field" style="flex-basis:100%;">
        <label>${c.label}</label>
        <textarea name="${c.key}" rows="2" style="width:100%;padding:10px;border:1px solid var(--gris-borde);border-radius:8px;" ${c.requerido !== false ? "required" : ""}></textarea>
      </div>`;
  }
  return `
    <div class="field">
      <label>${c.label}</label>
      <input type="${c.tipo || "text"}" name="${c.key}" ${c.requerido !== false ? "required" : ""} />
    </div>`;
}

// ============================================================
//  MÓDULO: Mi Agenda
//  ------------------------------------------------------------
//  Cada quien ve y guarda su propia agenda completa (actividad +
//  fecha + detalle). Además, junto con cada actividad se guarda un
//  "resumen" (solo actividad + fecha, sin el detalle) en una
//  colección aparte: eso es lo único que un Líder JR/SR puede leer
//  de los Ejecutivos SR/JR 1G/JR 2G — nunca el detalle, y nunca los
//  datos de otros módulos (prospectos, visitas, etc.). Esto lo
//  refuerza también firestore.rules, no solo esta pantalla.
// ============================================================

async function renderAgenda(container) {
  const verEquipo = esLider();

  container.innerHTML = `
    <h2 class="module-title">Mi Agenda</h2>
    <p class="module-subtitle">Citas y pendientes del día a día.</p>

    <div class="card">
      <h3>Nuevo registro</h3>
      <form id="form-agenda">
        <div class="form-row">
          <div class="field">
            <label>Actividad</label>
            <input type="text" name="titulo" required />
          </div>
          <div class="field">
            <label>Fecha</label>
            <input type="date" name="fecha" required />
          </div>
          <div class="field" style="flex-basis:100%;">
            <label>Detalle</label>
            <textarea name="texto" rows="2" style="width:100%;padding:10px;border:1px solid var(--gris-borde);border-radius:8px;"></textarea>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Guardar</button>
      </form>
    </div>

    <div class="card">
      <h3>Mis registros</h3>
      <div id="agenda-wrap"><p class="empty-state">Cargando…</p></div>
    </div>

    ${
      verEquipo
        ? `<div class="card">
            <h3>Agenda del equipo</h3>
            <p style="font-size:0.8rem;color:var(--texto-suave);">Lo que tienen programado los Ejecutivos (SR, JR 1G y JR 2G) por día — solo actividad y fecha. El detalle y los datos de sus clientes no son visibles aquí; eso solo lo ve el Director.</p>
            <div id="agenda-equipo-wrap"><p class="empty-state">Cargando…</p></div>
          </div>`
        : ""
    }
  `;

  const form = container.querySelector("#form-agenda");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const titulo = fd.get("titulo");
    const fecha = fd.get("fecha");
    const texto = fd.get("texto") || "";
    const autor = sesion.perfil?.nombre || sesion.user.email;
    const autorEmail = sesion.user.email;
    const autorRol = sesion.perfil?.rol || "";
    const creado = serverTimestamp();

    // Un solo ID compartido entre el registro completo y su resumen,
    // para poder borrar ambos juntos.
    const ref = doc(collection(db, "agenda"));
    await setDoc(ref, { titulo, fecha, texto, autor, autorEmail, creado });
    await setDoc(doc(db, "agendaResumen", ref.id), { titulo, fecha, autor, autorEmail, autorRol, creado });

    form.reset();
    cargarMiAgenda();
    if (verEquipo) cargarAgendaEquipo();
  });

  async function cargarMiAgenda() {
    const wrap = container.querySelector("#agenda-wrap");
    wrap.innerHTML = `<p class="empty-state">Cargando…</p>`;
    try {
      const q = query(collection(db, "agenda"), where("autorEmail", "==", sesion.user.email));
      const snap = await getDocs(q);
      const filas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      filas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));

      if (filas.length === 0) {
        wrap.innerHTML = `<p class="empty-state">Todavía no hay registros. Agrega el primero arriba.</p>`;
        return;
      }

      wrap.innerHTML = `
        <table>
          <thead><tr><th>Fecha</th><th>Actividad</th><th>Detalle</th><th></th></tr></thead>
          <tbody>
            ${filas
              .map(
                (f) => `
              <tr data-id="${f.id}">
                <td>${f.fecha || "—"}</td>
                <td>${f.titulo || "—"}</td>
                <td>${f.texto || "—"}</td>
                <td><button class="btn-link btn-eliminar" data-id="${f.id}">Eliminar</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

      wrap.querySelectorAll(".btn-eliminar").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar este registro?")) return;
          await deleteDoc(doc(db, "agenda", btn.dataset.id));
          await deleteDoc(doc(db, "agendaResumen", btn.dataset.id)).catch(() => {});
          cargarMiAgenda();
          if (verEquipo) cargarAgendaEquipo();
        });
      });
    } catch (err) {
      wrap.innerHTML = `<p class="empty-state">No se pudo cargar (${err.message}).</p>`;
    }
  }

  async function cargarAgendaEquipo() {
    const wrap = container.querySelector("#agenda-equipo-wrap");
    if (!wrap) return;
    wrap.innerHTML = `<p class="empty-state">Cargando…</p>`;
    try {
      const q = query(collection(db, "agendaResumen"), where("autorRol", "in", RANGOS_EJECUTIVO));
      const snap = await getDocs(q);
      const filas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      filas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));

      if (filas.length === 0) {
        wrap.innerHTML = `<p class="empty-state">No hay actividades programadas todavía.</p>`;
        return;
      }

      wrap.innerHTML = `
        <table>
          <thead><tr><th>Fecha</th><th>Ejecutivo</th><th>Nivel</th><th>Actividad</th></tr></thead>
          <tbody>
            ${filas
              .map(
                (f) => `<tr><td>${f.fecha || "—"}</td><td>${f.autor || f.autorEmail || "—"}</td><td>${f.autorRol || "—"}</td><td>${f.titulo || "—"}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>`;
    } catch (err) {
      wrap.innerHTML = `<p class="empty-state">No se pudo cargar (${err.message}).</p>`;
    }
  }

  cargarMiAgenda();
  if (verEquipo) cargarAgendaEquipo();
}

// ============================================================
//  MÓDULO: Inicio (dashboard)
// ============================================================

const ACCESOS_RAPIDOS = [
  { modulo: "cotizador", titulo: "Cotizador", texto: "Arma una propuesta de pago y sácala en PDF para el cliente." },
  { modulo: "prospectos", titulo: "Prospectos CRM", texto: "Tus prospectos y clientes, con su historia completa." },
  { modulo: "asistencia", titulo: "Asistencia", texto: "Registra tu llegada con ubicación." },
  { modulo: "visitas", titulo: "Visitas", texto: "Programa y registra visitas, con seguimiento a cada cliente." },
  { modulo: "ranking-visitas", titulo: "Ranking Visitas", texto: "Cómo va todo el equipo en visitas este mes." },
];

async function renderInicio(container) {
  const nombre = (sesion.perfil?.nombre || sesion.user.email).split(" ")[0].toUpperCase();
  const rol = sesion.perfil?.rol || "equipo";
  const fecha = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "2-digit", month: "long" });

  container.innerHTML = `
    <div style="border-radius:var(--radio);overflow:hidden;margin-bottom:26px;box-shadow:var(--sombra);">
      <div style="background:linear-gradient(135deg, var(--azul-medio), #4a7fb5 60%, var(--dorado-suave));padding:26px 28px 18px;color:white;">
        <h2 style="margin:0;font-size:1.5rem;">Buenos días, ${nombre}</h2>
      </div>
      <div style="background:var(--azul-noche);color:rgba(255,255,255,0.85);padding:10px 28px;font-size:0.85rem;text-transform:capitalize;">
        ${fecha} · ${rol}
      </div>
    </div>

    <h3 style="color:var(--azul-noche);margin-bottom:14px;">Accesos rápidos</h3>
    <div class="kpi-grid" id="accesos-grid"></div>
  `;

  const grid = container.querySelector("#accesos-grid");
  grid.innerHTML = ACCESOS_RAPIDOS.map(
    (a) => `
    <div class="card" style="cursor:pointer;margin-bottom:0;" data-ir="${a.modulo}">
      <h3 style="margin-bottom:6px;">${a.titulo}</h3>
      <p style="margin:0;color:var(--texto-suave);font-size:0.85rem;">${a.texto}</p>
    </div>`
  ).join("");
  grid.querySelectorAll("[data-ir]").forEach((el) => {
    el.addEventListener("click", () => irAModulo(el.dataset.ir));
  });
}

// ============================================================
//  MÓDULO: Cotizador
// ============================================================

async function renderCotizador(container) {
  container.innerHTML = `
    <h2 class="module-title">Cotizador</h2>
    <p class="module-subtitle">Arma una propuesta de pago para el cliente y guárdala o imprímela en PDF.</p>

    <div class="card">
      <form id="form-cotizador">
        <div class="form-row">
          <div class="field">
            <label>Cliente</label>
            <input type="text" name="cliente" required />
          </div>
          <div class="field">
            <label>Proyecto</label>
            <select name="proyecto" required>${opcionesProyectos()}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Valor total del lote/casa</label>
            <input type="number" name="valorTotal" min="0" required />
          </div>
          <div class="field">
            <label>% cuota inicial</label>
            <input type="number" name="pctInicial" min="0" max="100" value="30" required />
          </div>
          <div class="field">
            <label>Número de cuotas (saldo)</label>
            <input type="number" name="numCuotas" min="1" value="12" required />
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Calcular propuesta</button>
      </form>
    </div>

    <div class="card" id="resultado-cotizador" style="display:none;"></div>
  `;

  const form = container.querySelector("#form-cotizador");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const cliente = fd.get("cliente");
    const proyectoNombre = fd.get("proyecto");
    const valorTotal = Number(fd.get("valorTotal"));
    const pctInicial = Number(fd.get("pctInicial"));
    const numCuotas = Number(fd.get("numCuotas"));

    const cuotaInicial = valorTotal * (pctInicial / 100);
    const saldo = valorTotal - cuotaInicial;
    const valorCuota = saldo / numCuotas;
    const proyecto = PROYECTOS.find((p) => p.nombre === proyectoNombre);

    const box = container.querySelector("#resultado-cotizador");
    box.style.display = "block";
    box.innerHTML = `
      <div id="area-imprimir">
        <h3>Propuesta de pago — ${cliente}</h3>
        <p style="color:var(--texto-suave);font-size:0.85rem;">
          ${proyecto ? `${proyecto.nombre} — ${proyecto.constructora} · ${proyecto.ubicacion}` : proyectoNombre}
        </p>
        <table>
          <tbody>
            <tr><td>Valor total</td><td>${fmtMoney(valorTotal)}</td></tr>
            <tr><td>Cuota inicial (${pctInicial}%)</td><td>${fmtMoney(cuotaInicial)}</td></tr>
            <tr><td>Saldo a financiar</td><td>${fmtMoney(saldo)}</td></tr>
            <tr><td>${numCuotas} cuotas de</td><td>${fmtMoney(valorCuota)}</td></tr>
          </tbody>
        </table>
        <p style="font-size:0.75rem;color:var(--texto-suave);margin-top:10px;">
          Preparado por ${sesion.perfil?.nombre || sesion.user.email} · inmobiliariadelmet · ${new Date().toLocaleDateString("es-CO")}
        </p>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-imprimir" style="margin-top:14px;width:auto;">Imprimir / Guardar como PDF</button>
    `;
    container.querySelector("#btn-imprimir").addEventListener("click", () => window.print());
  });
}

// ============================================================
//  MÓDULO: Asistencia (registro de llegada con ubicación)
// ============================================================

async function renderAsistencia(container) {
  const director = esDirector();
  container.innerHTML = `
    <h2 class="module-title">Asistencia</h2>
    <p class="module-subtitle">Registra tu llegada con ubicación.</p>
    <div class="card">
      <button id="btn-registrar-llegada" class="btn btn-primary btn-sm">📍 Registrar mi llegada ahora</button>
      <p id="estado-asistencia" style="font-size:0.82rem;color:var(--texto-suave);margin-top:10px;"></p>
    </div>
    <div class="card">
      <h3>${director ? "Asistencia del equipo" : "Mis registros recientes"}</h3>
      <div id="tabla-asistencia"><p class="empty-state">Cargando…</p></div>
    </div>
  `;

  container.querySelector("#btn-registrar-llegada").addEventListener("click", async () => {
    const estado = container.querySelector("#estado-asistencia");
    estado.textContent = "Obteniendo ubicación…";
    const ubic = await pedirUbicacion();
    await addDoc(collection(db, "asistencia"), {
      autor: sesion.perfil?.nombre || sesion.user.email,
      autorEmail: sesion.user.email,
      lat: ubic?.lat ?? null,
      lng: ubic?.lng ?? null,
      creado: serverTimestamp(),
    });
    estado.textContent = ubic
      ? "Llegada registrada con ubicación ✅"
      : "Llegada registrada (sin ubicación disponible) ✅";
    cargarAsistencia();
  });

  async function cargarAsistencia() {
    const wrap = container.querySelector("#tabla-asistencia");
    const base = collection(db, "asistencia");
    const q = director ? base : query(base, where("autorEmail", "==", sesion.user.email));
    const snap = await getDocs(q);
    const filas = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0))
      .slice(0, director ? 50 : 20);
    if (filas.length === 0) {
      wrap.innerHTML = `<p class="empty-state">Aún no hay registros.</p>`;
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr>${director ? "<th>Quién</th>" : ""}<th>Fecha</th><th>Ubicación</th></tr></thead>
        <tbody>
          ${filas
            .map(
              (f) => `<tr>${director ? `<td>${f.autor}</td>` : ""}<td>${fmtFecha(f.creado)}</td><td>${f.lat ? `${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}` : "No disponible"}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  cargarAsistencia();
}

// ============================================================
//  MÓDULO: Visitas (registro de visita a proyecto con ubicación)
// ============================================================

async function renderVisitas(container) {
  const director = esDirector();

  container.innerHTML = `
    <h2 class="module-title">Visitas</h2>
    <p class="module-subtitle">La operación diaria: programa, registra y da seguimiento a cada visita.</p>

    <div class="kpi-grid" id="visitas-kpis"><p class="empty-state">Calculando…</p></div>

    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
        <button type="button" class="btn btn-primary btn-sm" id="btn-programar">+ Programar visita</button>
        <button type="button" class="btn btn-primary btn-sm" id="btn-registrar">+ Registrar visita realizada</button>
      </div>
      <form id="form-visita">
        <input type="hidden" name="idEdicion" value="" />
        <div class="form-row">
          <div class="field">
            <label>Cliente (de Prospectos CRM)</label>
            <select name="prospecto"><option value="">— Cliente nuevo (escribir manualmente) —</option></select>
          </div>
          <div class="field">
            <label>Nombre del cliente</label>
            <input type="text" name="cliente" required />
          </div>
          <div class="field">
            <label>Teléfono</label>
            <input type="tel" name="telefono" />
          </div>
          <div class="field">
            <label>Proyecto</label>
            <select name="proyecto" required>${opcionesProyectos()}</select>
          </div>
          <div class="field">
            <label>Lote de interés</label>
            <input type="text" name="lote" />
          </div>
          <div class="field">
            <label>Tipo de visita</label>
            <select name="tipo">${TIPOS_VISITA.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Fecha</label>
            <input type="date" name="fecha" required />
          </div>
          <div class="field">
            <label>Hora</label>
            <input type="time" name="hora" />
          </div>
          <div class="field">
            <label>Estado</label>
            <select name="estado">${ESTADOS_VISITA.map((e) => `<option value="${e.value}">${e.label}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Resultado</label>
            <select name="resultado">${RESULTADOS_VISITA.map((r) => `<option value="${r.value}">${r.label}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label>Próximo seguimiento</label>
            <input type="date" name="proximoSeguimiento" />
          </div>
          <div class="field" style="flex-basis:100%;">
            <label>Observaciones</label>
            <textarea name="observaciones" rows="2" style="width:100%;padding:10px;border:1px solid var(--gris-borde);border-radius:8px;"></textarea>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm" id="btn-guardar-visita">Guardar</button>
        <button type="button" class="btn-link" id="btn-cancelar-edicion" style="display:none;">Cancelar edición</button>
      </form>
    </div>

    <div class="card" id="visitas-alertas" style="display:none;"></div>

    <div class="card">
      <h3>Visitas</h3>
      <div class="form-row" style="margin-bottom:10px;">
        <div class="field"><label>Desde</label><input type="date" id="f-desde" /></div>
        <div class="field"><label>Hasta</label><input type="date" id="f-hasta" /></div>
        <div class="field">
          <label>Proyecto</label>
          <select id="f-proyecto"><option value="">Todos</option>${opcionesProyectos()}</select>
        </div>
        <div class="field">
          <label>Estado</label>
          <select id="f-estado"><option value="">Todos</option>${ESTADOS_VISITA.map((e) => `<option value="${e.value}">${e.label}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>Resultado</label>
          <select id="f-resultado"><option value="">Todos</option>${RESULTADOS_VISITA.filter((r) => r.value).map((r) => `<option value="${r.value}">${r.label}</option>`).join("")}</select>
        </div>
      </div>
      <div id="tabla-visitas"><p class="empty-state">Cargando…</p></div>
    </div>
  `;

  const form = container.querySelector("#form-visita");
  const selProspecto = form.querySelector('[name="prospecto"]');
  const inputCliente = form.querySelector('[name="cliente"]');
  const inputTelefono = form.querySelector('[name="telefono"]');
  const inputFecha = form.querySelector('[name="fecha"]');
  const selEstado = form.querySelector('[name="estado"]');
  const inputId = form.querySelector('[name="idEdicion"]');
  const btnCancelar = container.querySelector("#btn-cancelar-edicion");

  inputFecha.value = toISODate(new Date());

  // ---------- Cargar prospectos propios (o de todos si soy Director) ----------
  let prospectosLista = [];
  try {
    let qP = collection(db, "prospectos");
    if (!director) qP = query(qP, where("autorEmail", "==", sesion.user.email));
    const snapP = await getDocs(qP);
    prospectosLista = snapP.docs.map((d) => ({ id: d.id, ...d.data() }));
    selProspecto.innerHTML =
      `<option value="">— Cliente nuevo (escribir manualmente) —</option>` +
      prospectosLista.map((p) => `<option value="${p.id}" data-nombre="${p.nombre || ""}" data-telefono="${p.telefono || ""}">${p.nombre || "(sin nombre)"} — ${p.telefono || "sin teléfono"}</option>`).join("");
  } catch {
    // si falla, el ejecutivo simplemente escribe el cliente a mano
  }

  selProspecto.addEventListener("change", () => {
    const opt = selProspecto.selectedOptions[0];
    if (opt && opt.value) {
      inputCliente.value = opt.dataset.nombre || "";
      inputTelefono.value = opt.dataset.telefono || "";
    }
  });

  container.querySelector("#btn-programar").addEventListener("click", () => {
    limpiarFormulario();
    selEstado.value = "programada";
    form.scrollIntoView({ behavior: "smooth" });
  });
  container.querySelector("#btn-registrar").addEventListener("click", () => {
    limpiarFormulario();
    selEstado.value = "realizada";
    form.scrollIntoView({ behavior: "smooth" });
  });
  btnCancelar.addEventListener("click", () => {
    limpiarFormulario();
  });

  function limpiarFormulario() {
    form.reset();
    inputFecha.value = toISODate(new Date());
    inputId.value = "";
    container.querySelector("#btn-guardar-visita").textContent = "Guardar";
    btnCancelar.style.display = "none";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const datos = {
      prospectoId: fd.get("prospecto") || null,
      cliente: fd.get("cliente"),
      telefono: fd.get("telefono") || "",
      proyecto: fd.get("proyecto"),
      lote: fd.get("lote") || "",
      tipo: fd.get("tipo"),
      fecha: fd.get("fecha"),
      hora: fd.get("hora") || "",
      estado: fd.get("estado"),
      resultado: fd.get("resultado") || "",
      proximoSeguimiento: fd.get("proximoSeguimiento") || "",
      observaciones: fd.get("observaciones") || "",
      autor: sesion.perfil?.nombre || sesion.user.email,
      autorEmail: sesion.user.email,
      autorRol: sesion.perfil?.rol || "",
      actualizado: serverTimestamp(),
    };

    const idExistente = inputId.value;
    const ref = idExistente ? doc(db, "visitas", idExistente) : doc(collection(db, "visitas"));
    if (!idExistente) datos.creado = serverTimestamp();
    await setDoc(ref, datos, { merge: !!idExistente });

    // Resumen sin datos de cliente — es lo único que ve todo el equipo en Ranking Visitas.
    await setDoc(doc(db, "visitasResumen", ref.id), {
      autorEmail: datos.autorEmail,
      autor: datos.autor,
      autorRol: datos.autorRol,
      estado: datos.estado,
      resultado: datos.resultado,
      fecha: datos.fecha,
      actualizado: serverTimestamp(),
    });

    limpiarFormulario();
    cargarVisitas();
  });

  function editarVisita(f) {
    inputId.value = f.id;
    selProspecto.value = f.prospectoId || "";
    inputCliente.value = f.cliente || "";
    inputTelefono.value = f.telefono || "";
    form.querySelector('[name="proyecto"]').value = f.proyecto || "";
    form.querySelector('[name="lote"]').value = f.lote || "";
    form.querySelector('[name="tipo"]').value = f.tipo || TIPOS_VISITA[0];
    inputFecha.value = f.fecha || toISODate(new Date());
    form.querySelector('[name="hora"]').value = f.hora || "";
    selEstado.value = f.estado || "programada";
    form.querySelector('[name="resultado"]').value = f.resultado || "";
    form.querySelector('[name="proximoSeguimiento"]').value = f.proximoSeguimiento || "";
    form.querySelector('[name="observaciones"]').value = f.observaciones || "";
    container.querySelector("#btn-guardar-visita").textContent = "Guardar cambios";
    btnCancelar.style.display = "inline";
    form.scrollIntoView({ behavior: "smooth" });
  }

  let TODAS = [];

  async function cargarVisitas() {
    const wrap = container.querySelector("#tabla-visitas");
    const kpis = container.querySelector("#visitas-kpis");
    wrap.innerHTML = `<p class="empty-state">Cargando…</p>`;
    try {
      const base = collection(db, "visitas");
      const q = director ? base : query(base, where("autorEmail", "==", sesion.user.email));
      const snap = await getDocs(q);
      TODAS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // ---------- KPIs ----------
      const hoyStr = toISODate(new Date());
      const haceSemana = new Date();
      haceSemana.setDate(haceSemana.getDate() - 6);
      const semanaStr = toISODate(haceSemana);
      const mesPrefix = hoyStr.slice(0, 7);

      const enHoy = TODAS.filter((f) => f.fecha === hoyStr).length;
      const enSemana = TODAS.filter((f) => f.fecha >= semanaStr && f.fecha <= hoyStr).length;
      const enMes = TODAS.filter((f) => (f.fecha || "").startsWith(mesPrefix)).length;
      const realizadas = TODAS.filter((f) => f.estado === "realizada");
      const separadas = realizadas.filter((f) => f.resultado === "separo").length;
      const conversion = realizadas.length ? Math.round((separadas / realizadas.length) * 1000) / 10 : 0;

      kpis.innerHTML = `
        <div class="kpi-card"><div class="kpi-label">Visitas hoy</div><div class="kpi-value">${enHoy}</div></div>
        <div class="kpi-card"><div class="kpi-label">Esta semana</div><div class="kpi-value">${enSemana}</div></div>
        <div class="kpi-card"><div class="kpi-label">Este mes</div><div class="kpi-value">${enMes}</div></div>
        <div class="kpi-card"><div class="kpi-label">Conversión a separación</div><div class="kpi-value">${conversion}%</div></div>
      `;

      // ---------- Alertas ----------
      const sinResultado = realizadas.filter((f) => !f.resultado);
      const calientes = TODAS.filter((f) => f.resultado === "interesado");
      const vencidos = TODAS.filter((f) => f.proximoSeguimiento && f.proximoSeguimiento < hoyStr && !["separo", "no_interesado"].includes(f.resultado));
      const alertasBox = container.querySelector("#visitas-alertas");
      if (sinResultado.length || calientes.length || vencidos.length) {
        alertasBox.style.display = "block";
        alertasBox.innerHTML = `
          <h3>Pendientes</h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${vencidos.length ? `<div>⚠️ <strong>${vencidos.length}</strong> visita(s) con seguimiento vencido.</div>` : ""}
            ${sinResultado.length ? `<div>🔴 <strong>${sinResultado.length}</strong> visita(s) realizadas todavía sin resultado.</div>` : ""}
            ${calientes.length ? `<div>🔥 <strong>${calientes.length}</strong> cliente(s) interesado(s) que aún no han separado.</div>` : ""}
          </div>
        `;
      } else {
        alertasBox.style.display = "none";
      }

      renderTabla();
    } catch (err) {
      wrap.innerHTML = `<p class="empty-state">No se pudo cargar (${err.message}).</p>`;
    }
  }

  function renderTabla() {
    const wrap = container.querySelector("#tabla-visitas");
    const desde = container.querySelector("#f-desde").value;
    const hasta = container.querySelector("#f-hasta").value;
    const fProyecto = container.querySelector("#f-proyecto").value;
    const fEstado = container.querySelector("#f-estado").value;
    const fResultado = container.querySelector("#f-resultado").value;
    const hoyStr = toISODate(new Date());

    let filas = TODAS.slice();
    if (desde) filas = filas.filter((f) => (f.fecha || "") >= desde);
    if (hasta) filas = filas.filter((f) => (f.fecha || "") <= hasta);
    if (fProyecto) filas = filas.filter((f) => f.proyecto === fProyecto);
    if (fEstado) filas = filas.filter((f) => f.estado === fEstado);
    if (fResultado) filas = filas.filter((f) => f.resultado === fResultado);
    filas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    if (filas.length === 0) {
      wrap.innerHTML = `<p class="empty-state">No hay visitas con esos filtros.</p>`;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead><tr>${director ? "<th>Ejecutivo</th>" : ""}<th>Fecha</th><th>Cliente</th><th>Proyecto</th><th>Estado</th><th>Resultado</th><th>Próx. seguimiento</th><th></th></tr></thead>
        <tbody>
          ${filas
            .map((f) => {
              const vencido = f.proximoSeguimiento && f.proximoSeguimiento < hoyStr && !["separo", "no_interesado"].includes(f.resultado);
              return `
            <tr data-id="${f.id}">
              ${director ? `<td>${f.autor || "—"}</td>` : ""}
              <td>${fmtFechaCorta(f.fecha)}${f.hora ? " · " + f.hora : ""}</td>
              <td>${f.cliente || "—"}</td>
              <td>${f.proyecto || "—"}</td>
              <td>${badgeEstadoVisita(f.estado)}</td>
              <td>${badgeResultadoVisita(f.resultado)}</td>
              <td>${f.proximoSeguimiento ? fmtFechaCorta(f.proximoSeguimiento) + (vencido ? " ⚠️" : "") : "—"}</td>
              <td>
                <button class="btn-link btn-editar" data-id="${f.id}">Editar</button>
                <button class="btn-link btn-eliminar" data-id="${f.id}">Eliminar</button>
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    wrap.querySelectorAll(".btn-editar").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = TODAS.find((x) => x.id === btn.dataset.id);
        if (f) editarVisita(f);
      });
    });
    wrap.querySelectorAll(".btn-eliminar").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta visita?")) return;
        await deleteDoc(doc(db, "visitas", btn.dataset.id));
        await deleteDoc(doc(db, "visitasResumen", btn.dataset.id)).catch(() => {});
        cargarVisitas();
      });
    });
  }

  ["#f-desde", "#f-hasta", "#f-proyecto", "#f-estado", "#f-resultado"].forEach((sel) => {
    container.querySelector(sel).addEventListener("change", renderTabla);
  });

  cargarVisitas();
}

// ============================================================
//  MÓDULO: Ranking Visitas
//  ------------------------------------------------------------
//  Visible para TODO el equipo (no solo el Director) — la idea es
//  fomentar la competencia sana viendo quién está trabajando. Se
//  alimenta de "visitasResumen" (sin datos de clientes) para que
//  nadie vea información privada de los negocios de otro, solo las
//  cifras: programadas, realizadas, no asistió, separó y conversión.
// ============================================================

async function renderRankingVisitas(container) {
  container.innerHTML = `
    <h2 class="module-title">Ranking Visitas</h2>
    <p class="module-subtitle">Análisis y competencia del equipo — se alimenta automáticamente de Visitas. Todo el equipo puede verlo.</p>
    <div class="card"><div id="ranking-wrap"><p class="empty-state">Cargando…</p></div></div>
  `;
  const wrap = container.querySelector("#ranking-wrap");
  try {
    const snap = await getDocs(collection(db, "visitasResumen"));
    const porEjecutivo = {};
    snap.docs.forEach((d) => {
      const r = d.data();
      const key = r.autorEmail || "—";
      if (!porEjecutivo[key]) {
        porEjecutivo[key] = { nombre: r.autor || key, rol: r.autorRol || "", programadas: 0, realizadas: 0, noAsistio: 0, separo: 0 };
      }
      const e = porEjecutivo[key];
      if (r.estado === "programada") e.programadas++;
      if (r.estado === "realizada") e.realizadas++;
      if (r.estado === "no_asistio") e.noAsistio++;
      if (r.resultado === "separo") e.separo++;
    });

    const filas = Object.values(porEjecutivo).map((e) => ({
      ...e,
      conversion: e.realizadas ? Math.round((e.separo / e.realizadas) * 1000) / 10 : 0,
    }));
    filas.sort((a, b) => b.conversion - a.conversion || b.realizadas - a.realizadas);

    if (filas.length === 0) {
      wrap.innerHTML = `<p class="empty-state">Aún no hay visitas registradas en el equipo.</p>`;
      return;
    }

    const medallas = ["🥇", "🥈", "🥉"];
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Pos.</th><th>Ejecutivo</th><th>Nivel</th><th>Programadas</th><th>Realizadas</th><th>No asistió</th><th>Separó</th><th>Conversión</th></tr></thead>
        <tbody>
          ${filas
            .map(
              (f, i) => `
            <tr>
              <td>${medallas[i] || i + 1}</td>
              <td>${f.nombre}</td>
              <td>${f.rol || "—"}</td>
              <td>${f.programadas}</td>
              <td>${f.realizadas}</td>
              <td>${f.noAsistio}</td>
              <td>${f.separo}</td>
              <td>${f.conversion}%</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<p class="empty-state">No se pudo cargar (${err.message}).</p>`;
  }
}

// ============================================================
//  MÓDULO: Métricas (KPIs agregados)
// ============================================================

async function renderMetricas(container) {
  const director = esDirector();
  container.innerHTML = `
    <h2 class="module-title">Métricas</h2>
    <p class="module-subtitle">${director ? "Resumen general del negocio (todo el equipo)." : "Tu resumen personal."}</p>
    <div class="kpi-grid" id="metricas-grid"><p class="empty-state">Calculando…</p></div>
  `;
  const colecciones = ["prospectos", "visitas", "asistencia"];
  const conteos = {};
  for (const c of colecciones) {
    try {
      const base = collection(db, c);
      const q = director ? base : query(base, where("autorEmail", "==", sesion.user.email));
      const snap = await getCountFromServer(q);
      conteos[c] = snap.data().count;
    } catch {
      conteos[c] = "—";
    }
  }
  const grid = container.querySelector("#metricas-grid");
  grid.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Prospectos</div><div class="kpi-value">${conteos.prospectos}</div></div>
    <div class="kpi-card"><div class="kpi-label">Visitas registradas</div><div class="kpi-value">${conteos.visitas}</div></div>
    <div class="kpi-card"><div class="kpi-label">Registros de asistencia</div><div class="kpi-value">${conteos.asistencia}</div></div>
  `;
}

// ============================================================
//  MÓDULO: Mi Equipo (lista de usuarios autorizados)
// ============================================================

async function renderMiEquipo(container) {
  if (!esDirector()) {
    container.innerHTML = `
      <h2 class="module-title">Mi Equipo</h2>
      <p class="module-subtitle">Este módulo es visible solo para el Director.</p>
    `;
    return;
  }
  container.innerHTML = `
    <h2 class="module-title">Mi Equipo</h2>
    <p class="module-subtitle">Personas registradas en el sistema.</p>
    <p style="font-size:0.8rem;color:var(--texto-suave);">Aquí ves a todos los que se han registrado con el link, ordenados por nivel. Escalafón: ${RANGOS.slice(0, -1).join(" → ")}. Para subir/bajar a alguien de nivel o desactivarlo, edita su documento en la colección <code>usuariosAutorizados</code> en la consola de Firebase (campo <code>rol</code> o <code>activo</code>).</p>
    <div class="card"><div id="equipo-wrap"><p class="empty-state">Cargando…</p></div></div>
  `;
  try {
    const snap = await getDocs(collection(db, "usuariosAutorizados"));
    const filas = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => nivelRango(b.rol) - nivelRango(a.rol));
    const wrap = container.querySelector("#equipo-wrap");
    if (filas.length === 0) {
      wrap.innerHTML = `<p class="empty-state">No hay usuarios autorizados todavía.</p>`;
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Nombre</th><th>Correo</th><th>Nivel</th><th>Estado</th></tr></thead>
        <tbody>
          ${filas
            .map(
              (f) => `<tr><td>${f.nombre || "—"}</td><td>${f.id}</td><td>${f.rol || "—"}</td><td>${f.activo === false ? "Inactivo" : "Activo"}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  } catch (err) {
    container.querySelector("#equipo-wrap").innerHTML = `<p class="empty-state">No se pudo cargar (${err.message}).</p>`;
  }
}

// ============================================================
//  MÓDULO: Perfil
// ============================================================

async function renderPerfil(container) {
  container.innerHTML = `
    <h2 class="module-title">Mi perfil</h2>
    <p class="module-subtitle">Tus datos dentro del sistema.</p>
    <div class="card">
      <table>
        <tbody>
          <tr><td>Nombre</td><td>${sesion.perfil?.nombre || "—"}</td></tr>
          <tr><td>Correo</td><td>${sesion.user.email}</td></tr>
          <tr><td>Nivel</td><td>${sesion.perfil?.rol || "—"}</td></tr>
        </tbody>
      </table>
      <p style="font-size:0.8rem;color:var(--texto-suave);margin-top:12px;">
        Para cambiar tu contraseña usa la opción "¿Olvidaste tu contraseña?" en la pantalla de ingreso.
      </p>
    </div>
  `;
}

// ============================================================
//  Registro de módulos
// ============================================================

const MODULOS = {
  inicio: { render: renderInicio },
  cotizador: { render: renderCotizador },
  asistencia: { render: renderAsistencia },
  visitas: { render: renderVisitas },
  "ranking-visitas": { render: renderRankingVisitas },
  metricas: { render: renderMetricas },
  "mi-equipo": { render: renderMiEquipo },
  perfil: { render: renderPerfil },

  prospectos: {
    render: (c) =>
      renderModuloTabla(c, {
        titulo: "Prospectos CRM",
        subtitulo: "Tus prospectos y clientes, con su historia completa.",
        coleccion: "prospectos",
        privadoPorDefecto: true,
        campos: [
          { key: "nombre", label: "Nombre" },
          { key: "telefono", label: "Teléfono", tipo: "tel" },
          { key: "proyectoInteres", label: "Proyecto de interés", tipo: "select", opciones: opcionesProyectos() },
          {
            key: "estado",
            label: "Estado",
            tipo: "select",
            opciones: `<option value="nuevo">Nuevo</option><option value="contactado">Contactado</option><option value="negociando">Negociando</option><option value="cerrado">Cerrado</option><option value="perdido">Perdido</option>`,
          },
          { key: "notas", label: "Notas", tipo: "textarea", requerido: false },
        ],
        columnas: [
          { key: "nombre", label: "Nombre" },
          { key: "telefono", label: "Teléfono" },
          { key: "proyectoInteres", label: "Proyecto" },
          { key: "estado", label: "Estado", formato: (v) => `<span class="badge preventa">${v}</span>` },
          { key: "autor", label: "Ejecutivo" },
        ],
      }),
  },

  agenda: { render: renderAgenda },

  pqrs: {
    render: (c) =>
      renderModuloTabla(c, {
        titulo: "PQRS",
        subtitulo: "Peticiones, quejas, reclamos y sugerencias.",
        coleccion: "pqrs",
        privadoPorDefecto: true,
        campos: [
          { key: "cliente", label: "Cliente / proyecto" },
          { key: "tipo", label: "Tipo", tipo: "select", opciones: `<option value="peticion">Petición</option><option value="queja">Queja</option><option value="reclamo">Reclamo</option><option value="sugerencia">Sugerencia</option>` },
          { key: "texto", label: "Descripción", tipo: "textarea" },
        ],
        columnas: [
          { key: "cliente", label: "Cliente" },
          { key: "tipo", label: "Tipo", formato: (v) => `<span class="badge en_construccion">${v}</span>` },
          { key: "texto", label: "Descripción" },
          { key: "creado", label: "Fecha", formato: fmtFecha },
        ],
      }),
  },

  bitacora: {
    render: (c) =>
      renderModuloTabla(c, {
        titulo: "Bitácora",
        subtitulo: "Registro de novedades y decisiones.",
        coleccion: "bitacora",
        privadoPorDefecto: true,
        campos: [
          { key: "titulo", label: "Título" },
          { key: "texto", label: "Detalle", tipo: "textarea" },
        ],
        columnas: [
          { key: "titulo", label: "Título" },
          { key: "texto", label: "Detalle" },
          { key: "creado", label: "Fecha", formato: fmtFecha },
          { key: "autor", label: "Autor" },
        ],
      }),
  },

  acompanamientos: {
    render: (c) =>
      renderModuloTabla(c, {
        titulo: "Acompañamientos",
        subtitulo: "Seguimiento a ejecutivos en formación.",
        coleccion: "acompanamientos",
        privadoPorDefecto: true,
        campos: [
          { key: "titulo", label: "Ejecutivo acompañado" },
          { key: "texto", label: "Notas del acompañamiento", tipo: "textarea" },
        ],
        columnas: [
          { key: "titulo", label: "Ejecutivo" },
          { key: "texto", label: "Notas" },
          { key: "creado", label: "Fecha", formato: fmtFecha },
        ],
      }),
  },

  "mapa-suenos": {
    render: (c) =>
      renderModuloTabla(c, {
        titulo: "Mapa de Sueños",
        subtitulo: "Metas personales del equipo comercial.",
        coleccion: "mapaSuenos",
        soloMios: true,
        campos: [
          { key: "titulo", label: "Meta" },
          { key: "texto", label: "Por qué es importante", tipo: "textarea", requerido: false },
        ],
        columnas: [
          { key: "titulo", label: "Meta" },
          { key: "texto", label: "Detalle" },
          { key: "creado", label: "Fecha", formato: fmtFecha },
        ],
      }),
  },

  "panel-estrategico": {
    render: (c) =>
      renderModuloTabla(c, {
        titulo: "Panel Estratégico",
        subtitulo: "Decisiones y lineamientos estratégicos.",
        coleccion: "panelEstrategico",
        privadoPorDefecto: true,
        campos: [
          { key: "titulo", label: "Tema" },
          { key: "texto", label: "Decisión / lineamiento", tipo: "textarea" },
        ],
        columnas: [
          { key: "titulo", label: "Tema" },
          { key: "texto", label: "Decisión" },
          { key: "creado", label: "Fecha", formato: fmtFecha },
          { key: "autor", label: "Autor" },
        ],
      }),
  },
};

// Si la sesión ya estaba lista antes de que este script corriera
if (sesion.user) irAModulo("inicio");
