// Datos fijos de la tienda. Todo lo que hay que cambiar antes de lanzar está acá.

// Configuración web de Firebase. No es secreta: la protegen las reglas de seguridad (firestore.rules).
export const FIREBASE = {
  apiKey: "AIzaSyDTnbVJQ_dc5sh9ZqWgbLoF0xbj02Qm5N0",
  authDomain: "kikis-makeup.firebaseapp.com",
  projectId: "kikis-makeup",
  storageBucket: "kikis-makeup.firebasestorage.app",
  messagingSenderId: "233918741969",
  appId: "1:233918741969:web:b4dc3c4ccb86b0a572b4f0",
} as const;

export const SITE = {
  name: "Kiki's makeup",
  // MOCK: número de WhatsApp de relleno (código de país + número, sin signos).
  // Reemplazar por el real de la dueña antes de publicar. Es el único lugar donde se escribe.
  whatsapp: "5491100000000",
  instagram: "https://instagram.com/kikismakeup__",
  // Cloudinary: ya no hace falta. En el panel (/admin/) se pega la URL de cada foto.
  zones: ["San Miguel", "Moreno", "José C. Paz"],
  // Texto de la acción principal: igual en el nav, el formulario y el cierre.
  mainAction: "Pedir por WhatsApp",
} as const;

/**
 * URL de una foto pegada en el panel. Si es de Cloudinary (…/image/upload/…) le agrega
 * achicado y formato moderno; cualquier otra URL https se usa tal cual. "" si no hay foto.
 */
export function photoUrl(file: string, width = 600): string {
  const url = (file || "").trim();
  if (!/^https:\/\//i.test(url)) return "";
  const m = url.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/i);
  if (!m) return url;
  // Sin transformaciones previas (v123/… o el nombre del archivo): se las sumamos.
  return `${m[1]}f_auto,q_auto,w_${width}/${m[2]}`;
}

// El sitio vive en una subcarpeta (usuario.github.io/kikis/): todas las rutas propias pasan por u().
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const u = (path: string) => (/^(https?:|mailto:|tel:)/.test(path) ? path : BASE + path);
