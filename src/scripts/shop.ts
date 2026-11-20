// Tienda: buscador, filtros, orden y "Ver más". Todo se filtra en el navegador sobre las tarjetas ya generadas.
const STEP = 24;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const shop = $("[data-shop]");
if (shop) {
  const list = $("[data-list]", shop)!;
  const cards = [...list.querySelectorAll<HTMLElement>("[data-item]")];
  const q = $<HTMLInputElement>("[data-f=q]", shop)!;
  const cat = $<HTMLSelectElement>("[data-f=cat]", shop)!;
  const brand = $<HTMLSelectElement>("[data-f=brand]", shop)!;
  const estado = $<HTMLSelectElement>("[data-f=estado]", shop)!;
  const sort = $<HTMLSelectElement>("[data-f=sort]", shop)!;
  const more = $<HTMLButtonElement>("[data-more]", shop)!;
  const empty = $("[data-empty]", shop)!;
  const total = $("[data-total-count]", shop)!;
  const reset = $<HTMLButtonElement>("[data-reset]", shop)!;
  const preset = shop.dataset.cat ?? "";
  let shown = STEP;

  // Estado inicial: la categoría de la página y lo que traiga la dirección (?q=...&marca=...)
  const params = new URLSearchParams(location.search);
  cat.value = params.get("categoria") ?? preset;
  q.value = params.get("q") ?? "";
  brand.value = params.get("marca") ?? "";
  estado.value = params.get("disponibilidad") ?? "";
  sort.value = params.get("orden") ?? "novedades";

  const SORTERS: Record<string, (a: HTMLElement, b: HTMLElement) => number> = {
    novedades: (a, b) => Number(a.dataset.order) - Number(b.dataset.order),
    "precio-menor": (a, b) => Number(a.dataset.price) - Number(b.dataset.price),
    "precio-mayor": (a, b) => Number(b.dataset.price) - Number(a.dataset.price),
    nombre: (a, b) => (a.dataset.name ?? "").localeCompare(b.dataset.name ?? "", "es"),
  };

  const apply = () => {
    const words = norm(q.value).split(/\s+/).filter(Boolean);
    const found = cards.filter((c) => {
      if (cat.value === "Combos" ? c.dataset.combo !== "1" : cat.value && c.dataset.cat !== cat.value) return false;
      if (brand.value && c.dataset.brand !== brand.value) return false;
      if (estado.value && c.dataset.estado !== estado.value) return false;
      const hay = c.dataset.search ?? "";
      return words.every((x) => hay.includes(x));
    });
    found.sort(SORTERS[sort.value] ?? SORTERS.novedades);
    cards.forEach((c) => (c.hidden = true));
    found.forEach((c, i) => {
      list.appendChild(c);
      c.hidden = i >= shown;
    });
    const n = found.length;
    total.textContent = n === 1 ? "1 producto" : `${n} productos`;
    empty.hidden = n > 0;
    more.hidden = n <= shown;
    more.textContent = `Ver más productos (${Math.min(STEP, n - shown)})`;
    reset.hidden = !(q.value || brand.value || estado.value || cat.value !== preset);

    // La dirección refleja el filtro, para poder compartirla
    const next = new URLSearchParams();
    if (q.value.trim()) next.set("q", q.value.trim());
    if (cat.value !== preset) next.set("categoria", cat.value);
    if (brand.value) next.set("marca", brand.value);
    if (estado.value) next.set("disponibilidad", estado.value);
    if (sort.value !== "novedades") next.set("orden", sort.value);
    const qs = next.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  };

  const refilter = () => {
    shown = STEP;
    apply();
  };
  q.addEventListener("input", refilter);
  [cat, brand, estado, sort].forEach((s) => s.addEventListener("change", refilter));
  more.addEventListener("click", () => {
    shown += STEP;
    apply();
  });
  reset.addEventListener("click", () => {
    q.value = "";
    brand.value = "";
    estado.value = "";
    cat.value = preset;
    refilter();
  });
  q.closest("form")?.addEventListener("submit", (e) => e.preventDefault());
  apply();
}
