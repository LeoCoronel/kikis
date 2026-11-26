import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, setDoc, writeBatch } from "firebase/firestore";
import { FIREBASE } from "../config";
import { parseCSV } from "../lib/csv";

type Kind = "productos" | "combos";
type Tab = Kind | "importar" | "ajustes";
type Rec = { id: string; [k: string]: any };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const app = initializeApp(FIREBASE);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

const ESTADOS: Record<string, string> = { hay: "Hay disponible", pedido: "Por pedido", tanda: "Próxima tanda", agotado: "Agotado" };
const data: Record<Kind, Rec[]> = { productos: [], combos: [] };
let tab: Tab = "productos";
let editing: { kind: Kind; id: string | null } | null = null;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const money = (n: unknown) => "$" + Number(n || 0).toLocaleString("es-AR");
const https = (s: unknown) => (/^https:\/\//i.test(String(s ?? "").trim()) ? String(s).trim() : "");

function say(text: string) {
  const el = $("[data-msg]");
  el.textContent = text;
  el.hidden = !text;
  if (text) setTimeout(() => (el.textContent === text ? (el.hidden = true) : null), 6000);
}

function friendly(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code.includes("permission-denied")) return "Esta cuenta no tiene permiso para editar. Revisá que su Gmail esté en las reglas de Firestore.";
  if (code.includes("unavailable") || code.includes("network")) return "No hay conexión. Probá de nuevo.";
  return (e as Error).message || "Algo salió mal.";
}

// ---------- Sesión ----------
$("[data-signin]").addEventListener("click", async () => {
  const err = $("[data-login-error]");
  err.hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code.includes("cancelled")) return;
    err.textContent = code.includes("popup-closed")
      ? "Se cerró la ventana de Google. Si veía el error \"missing initial state\", abrí esta página directo en Chrome o Safari (no desde Instagram/WhatsApp), sin modo privado, y permití cookies de terceros para este sitio."
      : code.includes("unauthorized-domain")
      ? "Este dominio no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados)."
      : code.includes("popup-blocked")
        ? "El navegador bloqueó la ventana de Google. Permití las ventanas emergentes para este sitio y probá de nuevo."
        : code.includes("operation-not-allowed")
          ? "El ingreso con Google no está activado en Firebase (Authentication → Método de acceso)."
          : `${friendly(e)} (${code || "sin código"})`;
    err.hidden = false;
  }
});
$("[data-signout]").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (import.meta.env.DEV && location.hash === "#demo") return;
  $("[data-login]").hidden = !!user;
  $("[data-app]").hidden = !user;
  $("[data-user]").hidden = !user;
  if (!user) return;
  // ¿Esta cuenta está autorizada? Las reglas de Firestore solo dejan leer este documento a los admins.
  try {
    await getDoc(doc(db, "_acceso", "ping"));
  } catch (e) {
    if (((e as { code?: string }).code ?? "").includes("permission-denied")) {
      const mail = user.email ?? "esa cuenta";
      await signOut(auth);
      const err = $("[data-login-error]");
      err.textContent = `${mail} no tiene permiso para editar la tienda. Probá con otra cuenta de Google.`;
      err.hidden = false;
      return;
    }
  }
  $("[data-email]").textContent = user.email ?? "";
  await refresh();
});

async function refresh() {
  try {
    for (const k of ["productos", "combos"] as Kind[]) {
      const snap = await getDocs(collection(db, k));
      data[k] = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Rec)
        .sort((a, b) => (Number(a.orden) || 1e9) - (Number(b.orden) || 1e9) || a.id.localeCompare(b.id, "es"));
    }
    renderList("productos");
    renderList("combos");
    await loadSettings();
  } catch (e) {
    say(friendly(e));
  }
}

// ---------- Pestañas y listas ----------
$$("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab as typeof tab;
    $$("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  }),
);
$$<HTMLInputElement>("[data-filter]").forEach((i) => i.addEventListener("input", () => renderList(i.dataset.filter as Kind)));
$$("[data-new]").forEach((b) => b.addEventListener("click", () => openForm(b.dataset.new as Kind, null)));

function updateStats() {
  $('[data-stat="productos"]').textContent = String(data.productos.length);
  $('[data-stat="combos"]').textContent = String(data.combos.length);
  const mas = data.combos.filter((c) => c.mas_pedido).length;
  $('[data-stat="mas"]').innerHTML = `${mas}<small>/6</small>`;
}

function renderList(kind: Kind) {
  updateStats();
  const q = slug($<HTMLInputElement>(`[data-filter="${kind}"]`).value);
  const box = $(`[data-list="${kind}"]`);
  const rows = data[kind].filter((r) => !q || slug(`${r.id} ${r.nombre ?? ""} ${r.marca ?? ""} ${r.categoria ?? ""}`).includes(q));
  if (!rows.length) {
    const none = !data[kind].length;
    box.innerHTML = `<div class="adm-empty"><img src="${BASE}/kiki/kiki-triste-240.webp" alt="" width="140" height="160" />
      <p>${none ? `Todavía no hay ${kind === "productos" ? "productos" : "combos"} cargados.` : "Nada coincide con la búsqueda."}</p></div>`;
    return;
  }
  box.innerHTML = rows
    .map((r) => {
      const img = https(r.foto);
      const thumb = img ? `<img class="adm-thumb" src="${esc(img)}" alt="" loading="lazy" />` : `<span class="adm-thumb adm-thumb--empty">sin foto</span>`;
      let sub: string, price: string, pill: string;
      if (kind === "productos") {
        sub = [r.marca, r.categoria, r.id].filter(Boolean).join(" · ");
        price = money(r.precio);
        pill = `<span class="adm-pill adm-pill--${esc(r.estado || "hay")}">${esc(ESTADOS[r.estado] ?? ESTADOS.hay)}</span>`;
      } else {
        const n = String(r.productos ?? "").split("|").filter(Boolean).length;
        sub = `${n} ${n === 1 ? "producto" : "productos"} · ${r.id}`;
        price = r.precio ? money(r.precio) : "Suma de productos";
        pill = r.mas_pedido ? `<span class="adm-pill adm-pill--star">Más pedido</span>` : "";
      }
      return `<button type="button" class="adm-row" data-edit="${esc(r.id)}">
        ${thumb}
        <span class="adm-row__name"><strong>${esc(r.nombre || r.id)}</strong><small>${esc(sub)}</small></span>
        <span class="adm-row__price">${esc(price)}</span>
        ${pill || "<span></span>"}
      </button>`;
    })
    .join("");
  box.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) => b.addEventListener("click", () => openForm(kind, b.dataset.edit!)));
}

// ---------- Formulario ----------
const dialog = $<HTMLDialogElement>("[data-dialog]");

const field = (label: string, name: string, value: unknown = "", extra = "", type = "text", hint = "") =>
  `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra} />${hint ? `<small>${hint}</small>` : ""}</label>`;
const area = (label: string, name: string, value: unknown = "", rows = 3, hint = "") =>
  `<label class="field"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(value)}</textarea>${hint ? `<small>${hint}</small>` : ""}</label>`;
/** Desplegable con buscador: elige una opción existente o agrega una nueva escribiéndola. */
const combo = (label: string, name: string, value: unknown, options: string[], placeholder: string) =>
  `<div class="field adm-combo" data-combo data-options="${esc(JSON.stringify(options))}">
    <span>${label}</span>
    <div class="adm-combo__box">
      <input type="text" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" />
      <button type="button" class="adm-combo__toggle" tabindex="-1" aria-label="Ver opciones"></button>
      <ul class="adm-combo__list" role="listbox" hidden></ul>
    </div>
  </div>`;

function comboRender(box: HTMLElement, showAll: boolean) {
  const input = box.querySelector<HTMLInputElement>("input")!;
  const list = box.querySelector<HTMLUListElement>("ul")!;
  const options: string[] = JSON.parse(box.dataset.options || "[]");
  const typed = input.value.trim();
  const q = slug(typed);
  const shown = showAll || !q ? options : options.filter((o) => slug(o).includes(q));
  const exact = options.some((o) => slug(o) === q);
  let html = shown.map((o) => `<li role="option" data-val="${esc(o)}" ${slug(o) === q ? 'aria-selected="true"' : ""}>${esc(o)}</li>`).join("");
  if (typed && !exact) html += `<li role="option" class="is-add" data-val="${esc(typed)}">+ Agregar «${esc(typed)}»</li>`;
  if (!html) html = `<li class="is-empty">Escribí para agregar la primera</li>`;
  list.innerHTML = html;
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  list.querySelector("[aria-selected]")?.scrollIntoView({ block: "nearest" });
}
function comboClose(box: HTMLElement) {
  box.querySelector<HTMLElement>("ul")!.hidden = true;
  box.querySelector("input")!.setAttribute("aria-expanded", "false");
}
function comboPick(box: HTMLElement, val: string) {
  box.querySelector("input")!.value = val;
  comboClose(box);
}

const group = (title: string, body: string) => `<fieldset class="adm-group"><legend>${title}</legend>${body}</fieldset>`;
const photoField = (value: unknown) =>
  group(
    "Foto",
    `<div class="adm-photo">
      <img class="adm-thumb" data-photo-preview alt="" ${https(value) ? `src="${esc(https(value))}"` : ""} />
      ${field("Enlace de la foto", "foto", value, 'placeholder="https://res.cloudinary.com/…"', "url", "Subí la foto a Cloudinary y pegá acá su enlace.")}
    </div>`,
  );

/* ---------- tonos y fotos ---------- */
const photoRow = (url = "") => `<div class="adm-shot">
    <img class="adm-thumb" alt="" ${https(url) ? `src="${esc(https(url))}"` : ""} />
    <input type="url" data-shot value="${esc(url)}" placeholder="Pegá el enlace de la foto" aria-label="Enlace de la foto" />
    <button type="button" data-shot-remove aria-label="Quitar foto">×</button>
  </div>`;
const photoList = (urls: string[]) => `<div class="adm-shots" data-shots>${(urls.length ? urls : [""]).map(photoRow).join("")}</div>
  <button class="adm-more" type="button" data-shot-add>+ Otra foto</button>`;
const variantCard = (nombre = "", fotos: string[] = []) => `<div class="adm-variant" data-variant>
    <div class="adm-variant__head">
      <input type="text" data-variant-name value="${esc(nombre)}" placeholder="Nombre del tono, ej. Rosa" aria-label="Nombre del tono" />
      <button type="button" data-variant-remove>Quitar tono</button>
    </div>
    ${photoList(fotos)}
  </div>`;

/** Tonos y fotos generales guardados (acepta las cargas anteriores: tonos como texto y una sola foto). */
function stored(r: Rec): { variantes: { nombre: string; fotos: string[] }[]; fotos: string[] } {
  const variantes =
    Array.isArray(r.variantes) && r.variantes.length
      ? r.variantes
      : String(r.tonos ?? "").split("|").filter(Boolean).map((nombre) => ({ nombre, fotos: [] }));
  const fotos = Array.isArray(r.fotos) ? r.fotos : r.foto ? [r.foto] : [];
  return { variantes, fotos };
}
const readShots = (box: Element) => [...box.querySelectorAll<HTMLInputElement>("[data-shot]")].map((i) => i.value.trim()).filter(Boolean);

dialog.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.matches("[data-variant-add]")) {
    const box = dialog.querySelector("[data-variants]")!;
    box.insertAdjacentHTML("beforeend", variantCard());
    box.lastElementChild!.querySelector("input")!.focus();
  }
  if (t.matches("[data-variant-remove]")) t.closest("[data-variant]")!.remove();
  if (t.matches("[data-shot-add]")) {
    const box = t.previousElementSibling!;
    box.insertAdjacentHTML("beforeend", photoRow());
    box.lastElementChild!.querySelector("input")!.focus();
  }
  if (t.matches("[data-shot-remove]")) {
    const row = t.closest(".adm-shot")!;
    if (row.parentElement!.children.length > 1) row.remove();
    else {
      row.querySelector("input")!.value = "";
      row.querySelector("img")!.removeAttribute("src");
    }
  }
});
dialog.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (!t.matches("[data-shot]")) return;
  const img = t.closest(".adm-shot")!.querySelector("img")!;
  if (https(t.value)) img.src = https(t.value);
  else img.removeAttribute("src");
});
// Pegar varios enlaces juntos los reparte en una fila para cada uno
dialog.addEventListener("paste", (e) => {
  const t = e.target as HTMLInputElement;
  if (!t.matches("[data-shot]")) return;
  const found = (e as ClipboardEvent).clipboardData?.getData("text").match(/https:\/\/[^\s,;]+/g) ?? [];
  if (found.length < 2) return;
  e.preventDefault();
  const row = t.closest(".adm-shot")!;
  row.insertAdjacentHTML("afterend", found.map(photoRow).join(""));
  if (!t.value.trim()) row.remove();
});

function partRow(productId = "", qty = 1) {
  const opts = data.productos
    .map((p) => `<option value="${esc(p.id)}" ${p.id === productId ? "selected" : ""}>${esc(p.nombre || p.id)}</option>`)
    .join("");
  return `<div class="adm-part"><select name="part-id" aria-label="Producto"><option value="">Elegir producto…</option>${opts}</select>
    <input type="number" name="part-qty" min="1" value="${qty}" aria-label="Cantidad" />
    <button type="button" data-part-remove>Quitar</button></div>`;
}

function openForm(kind: Kind, id: string | null) {
  editing = { kind, id };
  const r: Rec = id ? data[kind].find((x) => x.id === id) ?? { id } : { id: "" };
  const isNew = !id;
  $("[data-form-title]").textContent = `${isNew ? "Nuevo" : "Editar"} ${kind === "productos" ? "producto" : "combo"}`;
  $("[data-form-error]").hidden = true;
  $("[data-delete]").hidden = isNew;
  const idField = field(
    "Código",
    "id",
    r.id,
    `${isNew ? "" : "readonly"} placeholder="ej. labial-rosa" required`,
    "text",
    isNew ? "Corto y sin espacios. No se puede cambiar después." : "",
  );
  const uniq = (k: string) =>
    [...new Set(data.productos.map((p) => String(p[k] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const categorias = uniq("categoria");
  const marcas = uniq("marca");
  let html: string;
  if (kind === "productos") {
    html =
      group(
        "Producto",
        `${idField}
        ${field("Nombre", "nombre", r.nombre, "required")}
        <div class="adm-two">
          ${combo("Marca", "marca", r.marca, marcas, "Elegir o crear")}
          ${combo("Categoría", "categoria", r.categoria, categorias, "Elegir o crear")}
        </div>`,
      ) +
      group(
        "Precio y disponibilidad",
        `${field("Precio ($)", "precio", r.precio ?? "", 'min="0" step="1" inputmode="numeric" required', "number")}
        <div class="field"><span>Disponibilidad</span><div class="adm-chips">${Object.entries(ESTADOS)
          .map(([v, l]) => `<label class="tone"><input type="radio" name="estado" value="${v}" ${(r.estado || "hay") === v ? "checked" : ""} /><span>${l}</span></label>`)
          .join("")}</div></div>`,
      ) +
      group(
        "Tonos y fotos",
        `<p class="adm-note">Agregá un tono por cada color y poné sus fotos. La primera es la que se muestra en la tienda. Subí las fotos a Cloudinary y pegá los enlaces (podés pegar varios juntos).</p>
        <div class="adm-variants" data-variants>${stored(r).variantes.map((v) => variantCard(v.nombre, v.fotos)).join("")}</div>
        <button class="btn btn--secondary btn--sm adm-addpart" type="button" data-variant-add>Agregar tono</button>`,
      ) +
      group("Fotos generales", `<p class="adm-note">Para productos sin tonos, o para los tonos que no tengan foto propia.</p><div data-general>${photoList(stored(r).fotos)}</div>`) +
      group("Textos", area("Descripción", "descripcion", r.descripcion, 3) + area("Ingredientes", "ingredientes", r.ingredientes, 2)) +
      group("Orden", field("Posición en la tienda", "orden", r.orden ?? "", 'min="1" step="1"', "number", "Opcional. El 1 va primero."));
  } else {
    const parts = String(r.productos ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = s.match(/^([^*]+?)\s*(?:\*\s*(\d+))?$/);
        return partRow((m?.[1] ?? s).trim(), Number(m?.[2] ?? 1));
      });
    html =
      group("Combo", `${idField}${field("Nombre", "nombre", r.nombre, "", "text", "Si lo dejás vacío se arma con los productos.")}`) +
      group(
        "Qué incluye",
        `<div class="adm-parts" data-parts>${(parts.length ? parts : [partRow()]).join("")}</div>
        <button class="btn btn--secondary btn--sm adm-addpart" type="button" data-part-add>Agregar otro producto</button>`,
      ) +
      group(
        "Precio y portada",
        `${field("Precio del combo ($)", "precio", r.precio ?? "", 'min="0" step="1" inputmode="numeric"', "number", "Vacío = suma de los productos.")}
        <label class="adm-switch"><input type="checkbox" name="mas_pedido" ${r.mas_pedido ? "checked" : ""} /><span>Mostrar en «Los más pedidos»<small>Aparece en la portada. Máximo 6.</small></span></label>`,
      ) +
      photoField(r.foto) +
      group("Orden", field("Posición", "orden", r.orden ?? "", 'min="1" step="1"', "number", "Opcional. El 1 va primero."));
  }
  $("[data-fields]").innerHTML = html;
  dialog.showModal();
  $("[data-fields]").scrollTop = 0;
}

const comboOf = (el: EventTarget | null) => (el as HTMLElement | null)?.closest<HTMLElement>("[data-combo]") ?? null;
dialog.addEventListener("focusin", (e) => {
  const box = comboOf(e.target);
  if ((e.target as HTMLElement).tagName === "INPUT" && box) comboRender(box, true);
});
dialog.addEventListener("focusout", (e) => {
  const box = comboOf(e.target);
  if (box && !box.contains((e as FocusEvent).relatedTarget as Node | null)) comboClose(box);
});
dialog.addEventListener("mousedown", (e) => {
  const t = e.target as HTMLElement;
  const box = comboOf(t);
  if (!box) return;
  const li = t.closest<HTMLElement>("li[data-val]");
  if (li) {
    e.preventDefault();
    comboPick(box, li.dataset.val!);
  } else if (t.closest(".adm-combo__toggle")) {
    e.preventDefault();
    const list = box.querySelector<HTMLElement>("ul")!;
    if (list.hidden) {
      box.querySelector("input")!.focus();
      comboRender(box, true);
    } else comboClose(box);
  }
});
dialog.addEventListener("keydown", (e) => {
  const box = comboOf(e.target);
  if (!box || (e.target as HTMLElement).tagName !== "INPUT") return;
  const list = box.querySelector<HTMLElement>("ul")!;
  const items = [...list.querySelectorAll<HTMLElement>("li[data-val]")];
  const cur = items.findIndex((i) => i.classList.contains("is-active"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (list.hidden) return comboRender(box, true);
    if (!items.length) return;
    const next = e.key === "ArrowDown" ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
    items.forEach((i, k) => i.classList.toggle("is-active", k === next));
    items[next].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && !list.hidden) {
    e.preventDefault(); // no envía el formulario
    if (cur >= 0) comboPick(box, items[cur].dataset.val!);
    else comboClose(box);
  } else if (e.key === "Escape" && !list.hidden) {
    e.preventDefault(); // cierra la lista, no el panel
    comboClose(box);
  }
});
dialog.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  const box = comboOf(t);
  if (box && t.tagName === "INPUT") comboRender(box, false);
  if (t.name === "foto") {
    const img = dialog.querySelector<HTMLImageElement>("[data-photo-preview]")!;
    const url = https(t.value);
    if (url) img.src = url;
    else img.removeAttribute("src");
  }
});
dialog.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.matches("[data-part-add]")) dialog.querySelector("[data-parts]")!.insertAdjacentHTML("beforeend", partRow());
  if (t.matches("[data-part-remove]")) {
    const parts = dialog.querySelector("[data-parts]")!;
    if (parts.children.length > 1) t.closest(".adm-part")!.remove();
  }
});
$$("[data-cancel],[data-cancel-2]").forEach((b) => b.addEventListener("click", () => dialog.close()));
dialog.addEventListener("click", (e) => {
  // un clic en el fondo oscuro cierra el panel
  if (e.target === dialog) dialog.close();
});

function formError(text: string) {
  const el = $("[data-form-error]");
  el.textContent = text;
  el.hidden = !text;
}

$("[data-form]").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editing) return;
  const { kind, id: editId } = editing;
  const f = new FormData($<HTMLFormElement>("[data-form]"));
  const get = (k: string) => String(f.get(k) ?? "").trim();
  const id = editId ?? slug(get("id"));
  if (!id) return formError("Poné un código corto, por ejemplo labial-rosa.");
  const other: Kind = kind === "productos" ? "combos" : "productos";
  if (!editId && (data[kind].some((r) => r.id === id) || data[other].some((r) => r.id === id)))
    return formError(`El código «${id}» ya existe. Tiene que ser distinto en productos y combos.`);
  const foto = get("foto");
  if (foto && !https(foto)) return formError("La foto tiene que ser una URL que empiece con https://");

  const out: Record<string, unknown> = {};
  if (foto) out.foto = foto;
  const orden = get("orden");
  if (orden) out.orden = Number(orden);

  if (kind === "productos") {
    if (!get("nombre")) return formError("Falta el nombre.");
    const precio = get("precio");
    if (precio === "" || Number(precio) < 0) return formError("Falta el precio.");
    const variantes: { nombre: string; fotos: string[] }[] = [];
    for (const card of dialog.querySelectorAll("[data-variant]")) {
      const nombre = card.querySelector<HTMLInputElement>("[data-variant-name]")!.value.replace(/\|/g, "/").trim();
      const fotos = readShots(card);
      if (!nombre && !fotos.length) continue;
      if (!nombre) return formError("Hay un tono con fotos pero sin nombre.");
      if (variantes.some((v) => slug(v.nombre) === slug(nombre))) return formError(`El tono «${nombre}» está repetido.`);
      variantes.push({ nombre, fotos });
    }
    const generales = readShots(dialog.querySelector("[data-general]")!);
    if ([...generales, ...variantes.flatMap((v) => v.fotos)].some((x) => !https(x)))
      return formError("Todas las fotos tienen que ser enlaces que empiecen con https://");
    const principal = generales[0] ?? variantes.find((v) => v.fotos.length)?.fotos[0];
    if (principal) out.foto = principal; // miniatura de la lista
    Object.assign(out, {
      nombre: get("nombre"),
      marca: get("marca"),
      categoria: get("categoria") || "Otros",
      precio: Number(precio),
      estado: get("estado") || "hay",
      tonos: variantes.map((v) => v.nombre).join("|"),
      variantes,
      fotos: generales,
      descripcion: get("descripcion"),
      ingredientes: get("ingredientes"),
    });
  } else {
    const ids = f.getAll("part-id").map(String);
    const qtys = f.getAll("part-qty").map((q) => Math.max(1, Number(q) || 1));
    const parts = ids.map((p, i) => (p ? (qtys[i] > 1 ? `${p}*${qtys[i]}` : p) : "")).filter(Boolean);
    if (!parts.length) return formError("Elegí al menos un producto para el combo.");
    Object.assign(out, { productos: parts.join("|"), mas_pedido: f.get("mas_pedido") === "on" });
    if (get("nombre")) out.nombre = get("nombre");
    if (get("precio")) out.precio = Number(get("precio"));
  }

  const btn = $<HTMLButtonElement>("[data-save]");
  btn.disabled = true;
  try {
    await setDoc(doc(db, kind, id), out);
    dialog.close();
    say("Guardado. Se ve en la tienda en la próxima actualización (menos de una hora).");
    await refresh();
  } catch (err) {
    formError(friendly(err));
  } finally {
    btn.disabled = false;
  }
});

$("[data-delete]").addEventListener("click", async () => {
  if (!editing?.id) return;
  const { kind, id } = editing;
  if (kind === "productos") {
    const used = data.combos.filter((c) => String(c.productos ?? "").split("|").some((p) => p.split("*")[0].trim() === id));
    if (used.length)
      return formError(`No se puede borrar: lo usa el combo ${used.map((c) => "«" + (c.nombre || c.id) + "»").join(", ")}. Sacalo del combo primero.`);
  }
  if (!confirm(`¿Borrar «${id}»? No se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, kind, id));
    dialog.close();
    say("Borrado.");
    await refresh();
  } catch (err) {
    formError(friendly(err));
  }
});

// ---------- Importar las hojas de la planilla ----------
const pending: Partial<Record<Kind, Record<string, string>[]>> = {};
const importInfo = $("[data-import-info]");
const importGo = $<HTMLButtonElement>("[data-import-go]");
const digits = (v: string) => Number((v || "0").replace(/\D/g, "")) || 0;

$$<HTMLInputElement>("[data-import]").forEach((inp) =>
  inp.addEventListener("change", async () => {
    const kind = inp.dataset.import as Kind;
    const file = inp.files?.[0];
    if (!file) return delete pending[kind];
    pending[kind] = parseCSV(await file.text()).filter((r) => r.id);
    const n = { productos: pending.productos?.length, combos: pending.combos?.length };
    importInfo.textContent = [n.productos != null && `${n.productos} productos`, n.combos != null && `${n.combos} combos`]
      .filter(Boolean)
      .join(" y ") + " listos para importar. Las fotos hay que pegarlas después, una por una.";
    importGo.disabled = !(pending.productos?.length || pending.combos?.length);
  }),
);

importGo.addEventListener("click", async () => {
  importGo.disabled = true;
  try {
    const writes: [Kind, string, Record<string, unknown>][] = [];
    (pending.productos ?? []).forEach((r, i) => {
      const id = slug(r.id);
      if (!id) return;
      writes.push(["productos", id, {
        nombre: r.nombre || id, marca: r.marca || "", categoria: r.categoria || "Otros", precio: digits(r.precio),
        estado: r.estado in ESTADOS ? r.estado : "hay", tonos: r.tonos || "", descripcion: r.descripcion || "",
        ingredientes: r.ingredientes || "", orden: i + 1,
      }]);
    });
    (pending.combos ?? []).forEach((r, i) => {
      const id = slug(r.id);
      if (!id) return;
      const o: Record<string, unknown> = {
        productos: (r.productos || "").split("|").map((p) => p.trim().split("*").map((x, k) => (k ? x.trim() : slug(x))).join("*")).join("|"),
        mas_pedido: /^(si|sí|1|x|true)$/i.test(r.mas_pedido || ""),
        orden: i + 1,
      };
      if (r.nombre) o.nombre = r.nombre;
      if (digits(r.precio)) o.precio = digits(r.precio);
      writes.push(["combos", id, o]);
    });
    for (let i = 0; i < writes.length; i += 400) {
      const batch = writeBatch(db);
      writes.slice(i, i + 400).forEach(([k, id, v]) => batch.set(doc(db, k, id), v, { merge: true }));
      await batch.commit();
    }
    say(`Importados ${writes.length} registros.`);
    $$<HTMLInputElement>("[data-import]").forEach((i) => (i.value = ""));
    delete pending.productos;
    delete pending.combos;
    importInfo.textContent = "";
    await refresh();
  } catch (e) {
    say(friendly(e));
    importGo.disabled = false;
  }
});

// ---------- Ajustes: número de WhatsApp ----------
const phoneInput = $<HTMLInputElement>("[data-phone]");
async function loadSettings() {
  const snap = await getDoc(doc(db, "config", "contacto"));
  phoneInput.value = String(snap.data()?.whatsapp ?? "");
  $("[data-phone-warn]").hidden = !!phoneInput.value;
}
$("[data-settings]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const whatsapp = phoneInput.value.replace(/\D/g, "");
  if (whatsapp.length < 10 || whatsapp.length > 15) return say("Revisá el número: va con código de país y de área, entre 10 y 15 dígitos.");
  try {
    await setDoc(doc(db, "config", "contacto"), { whatsapp });
    phoneInput.value = whatsapp;
    $("[data-phone-warn]").hidden = true;
    say("Número guardado. Los pedidos ya llegan a ese WhatsApp.");
  } catch (err) {
    say(friendly(err));
  }
});

// Solo en desarrollo: /admin/#demo muestra el panel con datos de ejemplo, sin iniciar sesión.
if (import.meta.env.DEV && location.hash === "#demo") {
  data.productos = [
    { id: "labial-rosa", nombre: "Labial mate Rosa Kiki", marca: "Mely", categoria: "Labios", precio: 9500, estado: "hay", tonos: "Rosa|Nude|Coral", variantes: [{ nombre: "Rosa", fotos: [] }, { nombre: "Nude", fotos: [] }, { nombre: "Coral", fotos: [] }] },
    { id: "base-fluida", nombre: "Base fluida satinada", marca: "Tejar", categoria: "Rostro", precio: 14200, estado: "pedido", tonos: "01|02|03" },
    { id: "mascara", nombre: "Máscara de pestañas", marca: "Mely", categoria: "Ojos", precio: 8800, estado: "tanda" },
    { id: "serum", nombre: "Sérum hidratante", marca: "Tejar", categoria: "Skincare", precio: 18900, estado: "agotado" },
  ];
  data.combos = [
    { id: "combo-labios", nombre: "Combo labios", productos: "labial-rosa*2|serum", precio: 32000, mas_pedido: true },
    { id: "combo-rostro", productos: "base-fluida|mascara" },
  ];
  $("[data-login]").hidden = true;
  $("[data-app]").hidden = false;
  $("[data-user]").hidden = false;
  $("[data-email]").textContent = "dueña@gmail.com";
  renderList("productos");
  renderList("combos");
}
