import { FIREBASE } from "../config";

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
};

interface FsDoc {
  name: string;
  fields?: Record<string, FsValue>;
}

/** Un valor de Firestore como valor común de JavaScript. */
function plain(v: FsValue): unknown {
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(plain);
  if (v.mapValue) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, plain(x)]));
  return asText(v);
}

/** Un valor de Firestore pasado a texto, que es lo que espera el modelo del catálogo (listas: JSON). */
function asText(v: FsValue | undefined): string {
  if (!v) return "";
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return v.integerValue;
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue ? "si" : "";
  if (v.arrayValue || v.mapValue) return JSON.stringify(plain(v));
  return "";
}

/**
 * Lee una colección completa por la API REST (sin SDK: se usa al construir el sitio).
 * Cada documento vuelve como { id, ...campos en texto }. Requiere lectura pública en las reglas.
 */
export async function readCollection(name: string): Promise<Record<string, string>[]> {
  const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/${name}`;
  const out: Record<string, string>[] = [];
  let pageToken = "";
  try {
    do {
      const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
      for (const d of data.documents ?? []) {
        const id = decodeURIComponent(d.name.split("/").pop() ?? "");
        out.push({ id, ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, asText(v)])) });
      }
      pageToken = data.nextPageToken ?? "";
    } while (pageToken);
  } catch (e) {
    // En una construcción de producción no se publica un catálogo vacío.
    throw new Error(`No se pudo leer "${name}" de Firestore: ${(e as Error).message}`);
  }
  // Orden elegido en el panel (campo "orden"); sin orden, al final y por id.
  const ord = (r: Record<string, string>) => (r.orden ? Number(r.orden) : Number.MAX_SAFE_INTEGER);
  return out.sort((a, b) => ord(a) - ord(b) || a.id.localeCompare(b.id, "es"));
}
