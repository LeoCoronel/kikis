// Datos fijos de la tienda. Todo lo que hay que cambiar antes de lanzar está acá.
const SHEET = "https://docs.google.com/spreadsheets/d/1lVUGM7bUOAJE6cnrUg-eeaIfd-NQMwUfKGbuBkTzXPU/export?format=csv";

export const SITE = {
  name: "Kiki's makeup",
  // MOCK: número de WhatsApp de relleno (código de país + número, sin signos).
  // Reemplazar por el real de la dueña antes de publicar. Es el único lugar donde se escribe.
  whatsapp: "5491100000000",
  instagram: "https://instagram.com/kikismakeup__",
  // Planilla de Google "kiki catalogo": hoja Productos (gid 0) y hoja Combos (gid 2), exportadas como CSV.
  sheetProductos: `${SHEET}&gid=0`,
  sheetCombos: `${SHEET}&gid=2`,
  // Cloudinary: nombre de la cuenta ("cloud name"). Mientras esté vacío no se piden fotos y las
  // tarjetas muestran el marcador con la marca. Ver la sección Fotos del brief.
  cloudinary: "",
  zones: ["San Miguel", "Moreno", "José C. Paz"],
  // Texto de la acción principal: igual en el nav, el formulario y el cierre.
  mainAction: "Pedir por WhatsApp",
} as const;

/** URL de una foto en Cloudinary, ya achicada y en WebP/AVIF. "" si todavía no hay cuenta. */
export function photoUrl(file: string, width = 600): string {
  if (!SITE.cloudinary || !file) return "";
  return `https://res.cloudinary.com/${SITE.cloudinary}/image/upload/f_auto,q_auto,w_${width}/${encodeURIComponent(file)}`;
}
