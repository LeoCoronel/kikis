// Pedido compartido por todas las páginas: se guarda en el navegador y se cierra por WhatsApp.
const KEY = "kiki-pedido";
const MAX_URL_TEXT = 1700; // más largo, el enlace de WhatsApp puede cortarse

interface Line {
  id: string;
  tono: string;
  qty: number;
  name: string;
  brand: string;
  price: number;
  url?: string;
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];
const money = (n: number) => "$" + n.toLocaleString("es-AR");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let lines: Line[] = [];
try {
  lines = (JSON.parse(localStorage.getItem(KEY) || "[]") as Line[]).filter((l) => l && l.id && l.qty > 0);
} catch {
  lines = [];
}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* sin almacenamiento: el pedido vive solo en esta página */
  }
};

const count = () => lines.reduce((a, l) => a + l.qty, 0);
const total = () => lines.reduce((a, l) => a + l.qty * l.price, 0);

function badge() {
  const n = count();
  $$("[data-cart-count]").forEach((b) => {
    b.textContent = String(n);
    b.hidden = n === 0;
  });
}

/* ------------------------------------------------------------ agregar desde cualquier página */
document.addEventListener("click", (e) => {
  const add = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
  if (!add) return;
  const item = add.closest<HTMLElement>("[data-item]");
  if (!item) return;
  // Un producto lleva un tono; un combo lleva uno por cada producto ("Labial mate: Rosa, Delineador: Marrón")
  const tono = $$<HTMLInputElement>("input[data-tone-input]:checked", item)
    .map((r) => (r.dataset.comp ? `${r.dataset.comp}: ${r.value}` : r.value))
    .join(", ");
  const id = item.dataset.id!;
  const found = lines.find((l) => l.id === id && l.tono === tono);
  if (found) found.qty++;
  else
    lines.push({ id, tono, qty: 1, name: item.dataset.name ?? "", brand: item.dataset.brand ?? "", price: Number(item.dataset.price) || 0, url: item.dataset.url });
  save();
  badge();
  renderOrder();
  const label = add.textContent;
  add.textContent = "Agregado";
  add.disabled = true;
  setTimeout(() => {
    add.textContent = label;
    add.disabled = false;
  }, 1200);
});

/* ------------------------------------------------------------ página del pedido */
const order = $("[data-order]");
const list = $<HTMLUListElement>("[data-order-list]");
const emptyBox = $("[data-order-empty]");
const totalRow = $("[data-order-total]");
const note = $("[data-order-note]");

// Precios y disponibilidad vigentes (de la última construcción del sitio)
let live: Record<string, { name: string; brand: string; price: number; estado: string; url?: string }> = {};
const liveTag = $("#order-prices");
if (liveTag?.textContent) {
  try {
    live = JSON.parse(liveTag.textContent);
  } catch {
    live = {};
  }
}
if (order && Object.keys(live).length) {
  // Se descartan los productos que ya no están y se actualizan nombre y precio.
  lines = lines.filter((l) => live[l.id]);
  lines.forEach((l) => Object.assign(l, { name: live[l.id].name, brand: live[l.id].brand, price: live[l.id].price, url: live[l.id].url }));
  save();
}

function renderOrder() {
  if (!order || !list || !emptyBox || !totalRow) return;
  const has = lines.length > 0;
  emptyBox.hidden = has;
  list.hidden = !has;
  totalRow.hidden = !has;
  list.innerHTML = lines
    .map((l, i) => {
      const sub = [l.brand, l.tono].filter(Boolean).join(" · ");
      const out = live[l.id]?.estado === "agotado";
      return `<li class="order-item">
        <span class="rows__name"><a href="${esc(l.url ?? "/tienda/")}">${esc(l.name)}</a>${sub ? `<small>${esc(sub)}${out ? " · Agotado" : ""}</small>` : out ? "<small>Agotado</small>" : ""}</span>
        <span class="order-qty">
          <button type="button" data-dec="${i}" aria-label="Quitar uno de ${esc(l.name)}">−</button>
          <span aria-live="polite">${l.qty}</span>
          <button type="button" data-inc="${i}" aria-label="Agregar uno de ${esc(l.name)}">+</button>
        </span>
        <span class="rows__value">${money(l.qty * l.price)}</span>
      </li>`;
    })
    .join("");
  const t = $("[data-total]", totalRow);
  if (t) t.textContent = money(total());
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const inc = t.closest<HTMLElement>("[data-inc]");
  const dec = t.closest<HTMLElement>("[data-dec]");
  if (inc) lines[Number(inc.dataset.inc)].qty++;
  else if (dec) {
    const i = Number(dec.dataset.dec);
    if (--lines[i].qty <= 0) lines.splice(i, 1);
  } else return;
  save();
  badge();
  renderOrder();
});

const form = $<HTMLFormElement>("[data-order-form]");
form?.addEventListener("submit", (e) => {
  const data = new FormData(form);
  const who = String(data.get("nombre") || "").trim();
  const comment = String(data.get("comentario") || "").trim();
  const rows = lines.map((l) => {
    const detail = [l.brand, l.tono].filter(Boolean).join(", ");
    return `• ${l.qty}x ${l.name}${detail ? ` (${detail})` : ""} - ${money(l.qty * l.price)}`;
  });
  const text = [
    lines.length ? `Hola Kiki's! Soy ${who} y quiero hacer este pedido:` : `Hola Kiki's! Soy ${who} y quiero consultar por productos.`,
    "",
    ...rows,
    "",
    lines.length ? `Total: ${money(total())}` : "",
    `Zona: ${data.get("zona")}`,
    comment ? `Comentario: ${comment}` : "",
    lines.length ? "¿Me confirmás disponibilidad y la entrega? Gracias!" : "¿Me ayudás a elegir? Gracias!",
  ]
    .filter((x, i, a) => x !== "" || (a[i - 1] !== "" && i < a.length - 1))
    .join("\n");

  if (text.length > MAX_URL_TEXT) {
    // Pedido largo: el mensaje se copia y se pega en el chat (el enlace tiene un límite de largo).
    e.preventDefault();
    navigator.clipboard?.writeText(text).then(
      () => {
        if (note) note.textContent = "Tu pedido es largo: lo copiamos. Pegalo en el chat de WhatsApp que se abre.";
        window.open(form.action, "_blank", "noopener");
      },
      () => {
        if (note) note.textContent = "Tu pedido es largo y no pudimos copiarlo. Quitá algunos productos o escribinos por partes.";
      },
    );
    return;
  }
  $<HTMLInputElement>("[name=text]", form)!.value = text;
  // Al número de WhatsApp solo viaja el mensaje, no los demás campos.
  const others = $$<HTMLInputElement | HTMLSelectElement>("[name=nombre], [name=zona], [name=comentario]", form);
  others.forEach((f) => (f.disabled = true));
  setTimeout(() => others.forEach((f) => (f.disabled = false)), 0);
});

badge();
renderOrder();

// Si una foto no carga (todavía no la subieron), se muestra el marcador de la tarjeta
document.addEventListener(
  "error",
  (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLImageElement && t.hasAttribute("data-photo")) t.remove();
  },
  true,
);
