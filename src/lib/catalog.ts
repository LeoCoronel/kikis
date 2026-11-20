import { SITE, photoUrl } from "../config";

export type Estado = "hay" | "pedido" | "tanda" | "agotado";

export interface Product {
  id: string;
  slug: string; // para la URL: /producto/<slug>/
  nombre: string;
  marca: string;
  categoria: string;
  descripcion: string;
  ingredientes: string;
  precio: number;
  tonos: string[];
  estado: Estado;
  fotoArchivo: string; // nombre del archivo en Cloudinary (la columna foto, o el id)
  destacado: boolean;
}

export interface ComboItem {
  product: Product;
  qty: number;
}

export interface Combo {
  id: string;
  slug: string;
  nombre: string;
  items: ComboItem[];
  precio: number;
  separado: number; // suma de los precios sueltos
  ahorro: number; // separado - precio (0 si no hay ahorro)
  estado: Estado;
  masPedido: boolean;
  fotoArchivo: string;
}

export const ESTADO_LABEL: Record<Estado, string> = {
  hay: "Hay disponible",
  pedido: "Por pedido",
  tanda: "Próxima tanda",
  agotado: "Agotado",
};
// del mejor al peor: el combo toma el peor estado de sus productos
const ESTADO_RANK: Estado[] = ["hay", "pedido", "tanda", "agotado"];

export const money = (n: number) => "$" + n.toLocaleString("es-AR");

/** "Máscara de pestañas" -> "mascara-de-pestanas" */
export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** URL de la foto de un producto o combo ("" si no hay cuenta de fotos). */
export const fotoDe = (x: { fotoArchivo: string }, width = 600) => photoUrl(x.fotoArchivo, width);

/** CSV con comillas ("a,b" y "" dentro de un campo), saltos de línea incluidos. */
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some((x) => x.trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const isYes = (v: string) => /^(si|sí|1|x|true)$/i.test(v.trim());
const digits = (v: string) => Number((v || "0").replace(/\D/g, "")) || 0;

async function fetchCSV(url: string, what: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Una planilla privada devuelve una página de inicio de sesión, no un CSV.
    if (/<html/i.test(text.slice(0, 500))) throw new Error("la planilla no es pública");
    return text;
  } catch (e) {
    // En una construcción de producción no se publica un catálogo vacío.
    throw new Error(`No se pudo leer la hoja ${what} de la planilla: ${(e as Error).message}`);
  }
}

function toProduct(r: Record<string, string>, i: number): Product {
  const estado = (r.estado || "hay").toLowerCase() as Estado;
  const id = r.id || `p${i + 1}`;
  return {
    id,
    slug: slugify(id) || `p${i + 1}`,
    nombre: r.nombre || "Producto",
    marca: r.marca || "",
    categoria: r.categoria || "Otros",
    descripcion: r.descripcion || "",
    ingredientes: r.ingredientes || "",
    // El CSV trae el precio formateado ("$9.500"): se queda solo con los dígitos.
    precio: digits(r.precio),
    tonos: (r.tonos || "").split("|").map((t) => t.trim()).filter(Boolean),
    estado: estado in ESTADO_LABEL ? estado : "hay",
    fotoArchivo: (r.foto || "").trim() || id,
    destacado: isYes(r.destacado || ""),
  };
}

function toCombo(r: Record<string, string>, i: number, byId: Map<string, Product>): Combo {
  const id = r.id || `cmb-${i + 1}`;
  const items: ComboItem[] = [];
  for (const part of (r.productos || "").split("|").map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^([^*]+?)\s*(?:\*\s*(\d+))?$/);
    const pid = (m?.[1] ?? part).trim();
    const qty = Math.max(1, Number(m?.[2] ?? 1));
    const product = byId.get(pid);
    if (!product) throw new Error(`El combo "${id}" usa el id "${pid}", que no existe en la hoja Productos`);
    items.push({ product, qty });
  }
  if (!items.length) throw new Error(`El combo "${id}" no tiene productos`);
  const separado = items.reduce((a, it) => a + it.product.precio * it.qty, 0);
  const precio = digits(r.precio) || separado;
  const estado = items.reduce<Estado>(
    (worst, it) => (ESTADO_RANK.indexOf(it.product.estado) > ESTADO_RANK.indexOf(worst) ? it.product.estado : worst),
    "hay",
  );
  const auto = items.map((it) => (it.qty > 1 ? `${it.qty} ${it.product.nombre}` : it.product.nombre)).join(" + ");
  return {
    id,
    slug: slugify(id) || `cmb-${i + 1}`,
    nombre: r.nombre || auto,
    items,
    precio,
    separado,
    ahorro: Math.max(0, separado - precio),
    estado,
    masPedido: isYes(r.mas_pedido || ""),
    // sin foto propia usa la del primer producto
    fotoArchivo: (r.foto || "").trim() || items[0].product.fotoArchivo,
  };
}

function checkUnique(items: { id: string; slug: string }[], what: string) {
  const seen = new Set<string>();
  for (const x of items) {
    if (seen.has(x.slug)) throw new Error(`El id "${x.id}" está repetido en la hoja ${what}`);
    seen.add(x.slug);
  }
}

let cache: Promise<{ products: Product[]; combos: Combo[] }> | undefined;

/** Lee la planilla una sola vez por construcción. */
function load() {
  cache ??= (async () => {
    const products = parseCSV(await fetchCSV(SITE.sheetProductos, "Productos")).map(toProduct);
    checkUnique(products, "Productos");
    const byId = new Map(products.map((p) => [p.id, p]));
    const combos = parseCSV(await fetchCSV(SITE.sheetCombos, "Combos")).map((r, i) => toCombo(r, i, byId));
    checkUnique(combos, "Combos");
    const clash = combos.find((c) => byId.has(c.id));
    if (clash) throw new Error(`El id "${clash.id}" está en Productos y en Combos: tienen que ser distintos`);
    return { products, combos };
  })();
  return cache;
}

export const loadCatalog = async () => (await load()).products;
export const loadCombos = async () => (await load()).combos;

/** Categorías con su cantidad, en el orden en que aparecen. */
export function categoriesOf(items: Product[]) {
  const map = new Map<string, number>();
  for (const p of items) map.set(p.categoria, (map.get(p.categoria) ?? 0) + 1);
  return [...map].map(([nombre, total]) => ({ nombre, slug: slugify(nombre), total }));
}

/** Ilustración de Kiki para cada categoría de la portada (provisoria hasta tener fotos). */
export const CATEGORY_KIKI: Record<string, string> = {
  labios: "labial",
  rostro: "espejo",
  ojos: "maquillaje",
  skincare: "corazon",
  accesorios: "bolsa",
};
