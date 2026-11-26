import { photoUrl } from "../config";
import { readCollection } from "./firestore";

export type Estado = "hay" | "pedido" | "tanda" | "agotado";

export interface Variante {
  nombre: string;
  fotos: string[];
  estado: Estado; // disponibilidad de este tono
}

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
  variantes: Variante[]; // un tono con sus fotos
  fotos: string[]; // fotos generales (sirven para los tonos sin fotos propias)
  estado: Estado; // con tonos: el mejor de ellos
  fotoArchivo: string; // la foto principal
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

const toEstado = (v: unknown, base: Estado): Estado => {
  const e = String(v ?? "").toLowerCase();
  return ESTADO_RANK.includes(e as Estado) ? (e as Estado) : base;
};
/** Índice del tono que se muestra elegido: el primero con la mejor disponibilidad. */
export const tonoInicial = (p: Product) => Math.max(0, p.variantes.findIndex((v) => v.estado === p.estado));

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

const isYes = (v: string) => /^(si|sí|1|x|true)$/i.test(v.trim());
const digits = (v: string) => Number((v || "0").replace(/\D/g, "")) || 0;

const json = (v: string | undefined): unknown => {
  try {
    return v ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
};
const urls = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

function toProduct(r: Record<string, string>, i: number): Product {
  const estado = toEstado(r.estado, "hay");
  const id = r.id || `p${i + 1}`;
  const guardadas = json(r.variantes);
  let variantes: Variante[] = (Array.isArray(guardadas) ? guardadas : [])
    .map((v) => ({ nombre: String(v?.nombre ?? "").trim(), fotos: urls(v?.fotos), estado: toEstado(v?.estado, estado) }))
    .filter((v) => v.nombre);
  // cargas anteriores: solo los nombres de los tonos
  if (!variantes.length)
    variantes = (r.tonos || "").split("|").map((t) => t.trim()).filter(Boolean).map((nombre) => ({ nombre, fotos: [], estado }));
  const propias = json(r.fotos);
  const fotos = Array.isArray(propias) ? urls(propias) : urls(r.foto ? [r.foto.trim()] : []);
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
    tonos: variantes.map((v) => v.nombre),
    variantes,
    fotos,
    estado: variantes.length ? ESTADO_RANK.find((e) => variantes.some((v) => v.estado === e))! : estado,
    fotoArchivo: fotos[0] ?? variantes.find((v) => v.fotos.length)?.fotos[0] ?? "",
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
    if (!product) throw new Error(`El combo "${id}" usa el id "${pid}", que no existe en la colección productos`);
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
    if (seen.has(x.slug)) throw new Error(`El id "${x.id}" está repetido en la colección ${what}`);
    seen.add(x.slug);
  }
}

let cache: Promise<{ products: Product[]; combos: Combo[] }> | undefined;

/** Lee Firestore una sola vez por construcción. */
function load() {
  cache ??= (async () => {
    const products = (await readCollection("productos")).map(toProduct);
    checkUnique(products, "productos");
    const byId = new Map(products.map((p) => [p.id, p]));
    const combos = (await readCollection("combos")).map((r, i) => toCombo(r, i, byId));
    checkUnique(combos, "combos");
    const clash = combos.find((c) => byId.has(c.id));
    if (clash) throw new Error(`El id "${clash.id}" está en productos y en combos: tienen que ser distintos`);
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
  labiales: "labial",
  rostro: "espejo",
  ojos: "maquillaje",
  skincare: "corazon",
  accesorios: "bolsa",
};
