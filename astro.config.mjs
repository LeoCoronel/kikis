// @ts-check
import { defineConfig } from 'astro/config';

// El sitio se publica en GitHub Pages dentro de la subcarpeta /kikis/.
// Si se pasa a un dominio propio, cambiar base por '/'.
export default defineConfig({
  base: '/kikis',
  devToolbar: { enabled: false },
});
