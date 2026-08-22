# Sistema inmobiliariadelmet

Herramienta comercial interna para **inmobiliariadelmet**, inspirada en la estructura de
Sistema Alianza: login por link, y módulos de Comercial, Gestión, Desarrollo y Estrategia.
Es un sitio estático (HTML/CSS/JS, sin build) que se conecta a **Firebase** (Authentication
+ Firestore) — igual que el original, se puede alojar gratis en GitHub Pages.

Tu proyecto de Firebase (`inmobiliariadelmet-ff4a0`) ya está creado y `js/firebase-config.js`
ya tiene tus datos reales — no necesitas volver a copiarlos.

## 1. Cómo funciona el acceso (modelo "por link")

- **No hay autorización manual por persona.** Cualquiera que tenga el link del sistema
  puede crear su propia cuenta (correo + contraseña, o Google) y entra directamente. Como
  el link solo lo tienes tú, en la práctica solo entra quien tú se lo compartas.
- Al registrarse, cada persona queda automáticamente en el **nivel más bajo del
  escalafón ("Ejecutivo JR 2G")** y **activo: true**. Ver sección 2.1 para el escalafón
  completo y cómo subir/bajar a alguien de nivel.
- **Tú (el Director) eres la única excepción**: tu cuenta la creas UNA VEZ a mano, en la
  consola de Firebase, con `rol: "Director"` (ver sección 2.2). Nadie puede asignarse ese
  rol por la app.
- Si más adelante quieres sacar a alguien, entras a su documento en `usuariosAutorizados`
  (consola de Firebase) y le cambias `activo` a `false`.
- **A tener en cuenta**: si el link se llega a compartir fuera de tu control, cualquiera
  que lo abra podría crear una cuenta de nivel "Ejecutivo JR 2G" — solo vería y crearía
  sus propios datos (no los de tu equipo real, por el punto 2), pero igual usaría tu cuota
  de Firebase. Si más adelante quieres un candado extra (ej. un código de invitación), lo
  agregamos.

## 2. Quién ve qué (privacidad entre ejecutivos)

- **Un ejecutivo solo ve y edita SUS PROPIOS registros** en: Prospectos CRM, Visitas,
  Asistencia, PQRS, Bitácora, Acompañamientos y Panel Estratégico. No ve los de sus
  compañeros.
- **Tú, como Director, ves y puedes editar los de todo el equipo** en esos mismos módulos
  — no tienes que hacer nada especial, tu cuenta ya tiene ese acceso por el `rol:
  "Director"`.
- **Mi Agenda y Mapa de Sueños son siempre privados de cada quien**, incluso para ti — son
  personales por diseño (si quieres que tú también los veas, lo ajustamos).
- **Excepción puntual**: un **Líder JR o Líder SR** sí puede ver, dentro del módulo "Mi
  Agenda", una sección aparte llamada "Agenda del equipo" con lo que tienen programado
  los Ejecutivos (SR, JR 1G y JR 2G) — pero **solo la actividad y la fecha**, nunca el
  detalle ni ningún dato de cliente (teléfono, notas, etc.). Esa parte del detalle nunca
  se guarda en el resumen que puede leer el Líder, así que aunque quisiera no podría
  verla — está bloqueado también en la base de datos, no solo en la pantalla. Un Líder no
  ve la agenda de otros Líderes ni la tuya, y sigue sin ver prospectos, visitas ni ningún
  otro dato de clientes de los Ejecutivos — de eso solo tú tienes acceso.
- **Ranking Visitas es visible para TODO el equipo** (no solo para ti) — es a propósito,
  para fomentar la competencia sana: cualquiera puede ver cuántas visitas programó,
  realizó, a cuántas no asistió y cuántas terminaron en separación cada ejecutivo, y su
  % de conversión. Pero solo ve esos números — nunca el nombre del cliente, el teléfono
  ni ningún dato del negocio; eso sigue siendo privado de cada quien (o tuyo si eres
  Director). Esto funciona con una colección aparte (`visitasResumen`) que guarda
  únicamente esas cifras, nunca los datos del cliente — así que aunque alguien
  intentara "hackear" la app, es imposible que reciba esa información porque nunca se
  guarda ahí.
- **Mi Equipo es visible solo para ti** (el Director) — un ejecutivo ve un aviso de
  "módulo solo para el Director" si entra ahí.
- **Métricas** le muestra a cada ejecutivo sus propios números, y a ti el resumen de todo
  el negocio.
- Esto está reforzado en dos capas: en la app (`js/app.js`) y, más importante, en las
  reglas de la base de datos (`firestore.rules`) — así que aunque alguien intente "hackear"
  la app, la base de datos igual se lo impide.

## 2.1 Escalafón del equipo (niveles)

Cada persona del equipo tiene un **nivel** (campo `rol` en su documento de
`usuariosAutorizados`), de menor a mayor:

1. **Ejecutivo JR 2G** (ejecutivo junior de 2da generación) — nivel con el que entra
   automáticamente todo el que se registra por primera vez.
2. **Ejecutivo JR 1G** (ejecutivo junior de 1ra generación)
3. **Ejecutivo SR** (ejecutivo senior)
4. **Líder JR** (líder junior)
5. **Líder SR** (líder senior)
6. **Director** — tu cuenta.

El nivel es solo informativo dentro del sistema (se muestra en "Mi Equipo" y en "Mi
perfil") y te sirve a ti para llevar el control de a cuánto gana cada quien — el sistema
no cambia nada automáticamente por el nivel. **Tú subes o bajas a alguien de nivel a
mano**, así:

1. Ve a **Firestore Database → Datos → usuariosAutorizados** en la consola de Firebase.
2. Abre el documento de esa persona (el ID es su correo en minúsculas).
3. Edita el campo `rol` y escribe el nivel nuevo, **exactamente** como está arriba
   (mayúsculas y tildes incluidas — por ejemplo `Líder JR`, no `lider jr`).
4. Guarda. La próxima vez que esa persona entre (o recargue la página), ya ve su nivel
   actualizado en "Mi perfil".

La visibilidad de datos (quién ve qué) **no cambia con el nivel**: solo tu cuenta
("Director") ve los datos de todo el equipo; los cinco niveles de Ejecutivo/Líder ven
únicamente lo suyo, igual que se explica en la sección 2. Si más adelante quieres que los
"Líder JR"/"Líder SR" también vean los datos de su grupo, avísame y lo ajustamos.

## 2.2 Tu cuenta de Director (créala así, a mano, una sola vez)

1. Ve a tu proyecto en [console.firebase.google.com](https://console.firebase.google.com) →
   **Firestore Database → Datos**.
2. Crea la colección `usuariosAutorizados` (si no existe) y un documento con:
   - **ID del documento**: tu correo, todo en minúsculas.
   - **Campos**: `nombre` (string, tu nombre), `rol` (string, exactamente `"Director"`),
     `activo` (boolean, `true`).
3. Con eso, cuando entres al sistema con ese correo, el sistema te reconoce como Director.

El resto de tu equipo NO necesita este paso — ellos solo abren el link y crean su cuenta
desde la pantalla de "¿Primera vez? Crea tu contraseña".

## 3. Cómo ponerlo en línea

### 3.1 Activar autenticación (si no lo hiciste ya)

En **Authentication → Sign-in method**, activa: Correo electrónico/contraseña, y Google.

### 3.2 Crear la base de datos y publicar las reglas (si no lo hiciste ya)

En **Firestore Database → Crear base de datos** (modo producción). Luego, en la pestaña
**Reglas**, pega el contenido del archivo `firestore.rules` de este proyecto y publica.

### 3.3 Publicar el sitio (GitHub Pages, igual que el original)

1. Crea un repositorio nuevo en GitHub (puede ser privado) y sube todo el contenido de
   esta carpeta.
2. En el repositorio: **Settings → Pages → Source**: rama `main`, carpeta `/ (root)`.
3. En unos minutos tu sistema queda disponible en
   `https://tu-usuario.github.io/tu-repositorio/` — ese es el link que compartes con tu
   equipo.

### Probar en tu computador antes de publicar

Con Python instalado, desde esta carpeta:

```
python3 -m http.server 8000
```

y abre `http://localhost:8000` en el navegador. (El login y los módulos solo funcionan
servidos por http(s) — localhost cuenta, abrir el archivo directo con doble clic no.)

## 4. Qué falta / próximos pasos sugeridos

Esto es lo primero de una lista más larga que armaste — lo demás lo iremos construyendo
por fases:

- **Bitácora** (auditoría de quién hizo qué en el sistema, solo para ti).
- **Novedades y Comunicados** (publicaciones tuyas con confirmación de lectura).
- **Acompañamientos con foto + ubicación en tiempo real**, y acuerdo de comisión entre
  ejecutivos cuando uno ayuda a otro en un cierre.
- **Mapa de Sueños** conectado con las comisiones (cuánto te falta vender para tu meta).
- **Mi Equipo como estructura personal** (que cualquier nivel arme su propia gente, no
  solo el Director) — pendiente de confirmar si aplica a todos o solo a Líderes.
- **Promociones del Mes** con cupos y conexión automática al Cotizador.
- **Material Comercial** (biblioteca de imágenes, videos, brochures y listas de precios
  por proyecto).
- **Fotos en Visitas**: hoy el módulo no adjunta fotos; para eso hace falta activar
  Firebase Storage (te ayudo cuando quieras).
- **Los 3 proyectos pendientes** en `js/data/proyectos.js` (Dolce Castello, Prados de
  Valencia y el que falte para completar 23).
- **Candado extra de invitación** (código o dominio de correo permitido) si te preocupa
  que el link circule más de la cuenta.
- **Panel de administración** dentro de la app para desactivar gente, subir de nivel o
  ver el equipo sin entrar a la consola de Firebase.

Cuando quieras, seguimos afinando cualquier módulo.
