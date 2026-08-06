// Constantes de interacción compartidas (hover/focus-visible/active/disabled),
// generalizadas desde components/search/search.styles.ts - esa es la
// referencia visual y search.styles.ts ahora reexporta desde acá. Transiciones
// cortas (150ms), sin glow/glassmorphism/3D, feedback perceptible respetando
// prefers-reduced-motion (motion-reduce: por clase, sin reset global).
//
// Reglas de fondo: un `style={{background:...}}` inline tiene más
// especificidad que una clase `:hover`/`:active` de Tailwind y la anula en
// silencio. Donde el color de reposo debe seguir viviendo en un `style`
// inline (dinámico o ya usado en muchos archivos), BUTTON_PRIMARY evita el
// problema por completo usando `hover:brightness-*`/`hover:shadow-*`
// (filter/box-shadow, propiedades distintas a background-color: nunca
// compiten en especificidad con un `style` que solo fija background/color).
// Donde el color de reposo pasa a vivir en una clase, se usa `hover:bg-*`
// directo (mismo patrón ya usado en PILL_SELECTED_DARK/GREEN).

export const BASE_TRANSITION =
  "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-focus-ring-color)] focus-visible:ring-offset-2";

/** Botón primario con fondo de color (propio o inline): brightness/shadow, nunca bg-*. */
export const BUTTON_PRIMARY = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:brightness-110 hover:shadow-md active:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:hover:shadow-none disabled:active:translate-y-0`;

/** Botón secundario con borde. */
export const BUTTON_SECONDARY = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:border-[var(--nx-accent-indigo)] hover:bg-[rgba(74,85,212,0.06)] active:bg-[rgba(74,85,212,0.12)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-transparent disabled:hover:bg-transparent`;

/** Botón ghost: sin borde, tinte índigo sutil en hover/active. */
export const BUTTON_GHOST = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:bg-[rgba(74,85,212,0.08)] active:bg-[rgba(74,85,212,0.16)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`;

/** Enlace-botón de texto (Ver detalle, Ver todos, Limpiar filtros). */
export const BUTTON_TEXT = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer rounded-[var(--nx-radius-chip)] hover:bg-[rgba(74,85,212,0.08)] active:bg-[rgba(74,85,212,0.16)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`;

/** Botón de icono. */
export const BUTTON_ICON = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:bg-[rgba(74,85,212,0.10)] active:bg-[rgba(74,85,212,0.18)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`;

/** Botón destructivo (Reintentar, Deshacer): usa --nx-danger-fg ya existente, no inventa color nuevo. */
export const BUTTON_DESTRUCTIVE = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:bg-[rgba(192,57,43,0.08)] active:bg-[rgba(192,57,43,0.16)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`;

/** Paginación (prev/next). Sin tamaño forzado - cada consumidor conserva sus dimensiones actuales. */
export const BUTTON_PAGINATION = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:bg-[rgba(74,85,212,0.10)] active:bg-[rgba(74,85,212,0.18)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`;

/** Botón de orden de columna: sin min-height forzado (evita layout shift en headers de tabla). */
export const BUTTON_SORT = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer rounded-[var(--nx-radius-chip)] hover:bg-[rgba(74,85,212,0.08)] active:bg-[rgba(74,85,212,0.16)] disabled:cursor-not-allowed disabled:opacity-50`;

// Píldora seleccionable de Búsqueda (tabs de entidad, presets de período). El
// fondo/color/borde de cada rama vive enteramente en estas clases, nunca en
// un `style` inline en el JSX consumidor - ver nota de especificidad arriba.
const PILL_BASE = `${BASE_TRANSITION} ${FOCUS_RING} inline-flex min-h-11 items-center justify-center border cursor-pointer active:translate-y-px`;

/** Tab/preset ACTIVO (Búsqueda): fondo oscuro de marca. */
export const PILL_SELECTED_DARK = `${PILL_BASE} border-transparent bg-[var(--nx-sidebar-bg)] text-white shadow-sm hover:bg-[#242a3d] hover:shadow-md active:bg-[#10131c]`;
/** Tab/preset ACTIVO (Búsqueda): fondo verde de marca. */
export const PILL_SELECTED_GREEN = `${PILL_BASE} border-transparent bg-[var(--nx-accent-green)] text-white shadow-sm hover:bg-[#2f7024] hover:shadow-md active:bg-[#245a1c]`;
/** Tab/preset INACTIVO (Búsqueda). */
export const PILL_UNSELECTED = `${PILL_BASE} border-transparent bg-[var(--nx-page-bg)] text-[var(--nx-text-secondary)] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 hover:shadow-sm active:bg-indigo-100`;

/** Control de formulario (select/input) usado por Búsqueda. */
export const FORM_CONTROL = `${BASE_TRANSITION} ${FOCUS_RING} min-h-11 cursor-pointer border border-[var(--nx-border)] bg-white hover:border-indigo-300 hover:bg-indigo-50/40 active:border-indigo-400`;

/** Filtro/pill fuera de Búsqueda, estado no seleccionado. Sin tamaño forzado. */
export const BUTTON_FILTER = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 disabled:cursor-not-allowed disabled:opacity-50`;

/** Filtro/pill fuera de Búsqueda, estado seleccionado: persistente, nunca solo opacidad. */
export const BUTTON_FILTER_SELECTED = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer border-transparent bg-[var(--nx-accent-indigo)] text-white shadow-sm hover:bg-[var(--nx-accent-indigo-hover)] hover:shadow-md active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50`;

/** Card explícitamente clicable (navega o ejecuta una acción). Sin cambio de borde: preserva el acento propio de cada card. */
export const CARD_INTERACTIVE = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:shadow-md active:translate-y-px`;

/** Botón sobre fondo oscuro de chrome (Sidebar/MobileTopBar/MobileSidebar/logout/refresh): overlay blanco translúcido, ya es el lenguaje visual existente ahí (rgba(255,255,255,0.06) en reposo), un tinte índigo casi no se distinguiría sobre --nx-sidebar-bg. */
export const BUTTON_CHROME = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:bg-white/10 active:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`;
