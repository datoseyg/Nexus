// Constantes de interacción compartidas por components/search/** - evita
// duplicar la misma combinación de clases en cada botón. No es un sistema
// global nuevo (no toca components/ui/** ni globals.css): son solo
// strings de Tailwind + tokens --nx-* ya existentes, locales a esta
// carpeta. Transiciones cortas (150ms), sin glow/glassmorphism/3D, sin
// negro puro para acciones primarias (usa --nx-sidebar-bg, ya es el tono
// oscuro de marca), feedback perceptible en hover/focus/active/disabled
// respetando prefers-reduced-motion.

export const BASE_TRANSITION =
  "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-focus-ring-color)] focus-visible:ring-offset-2";

/** Botón primario (Buscar): fondo oscuro de marca, sin negro puro. */
export const BUTTON_PRIMARY = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:brightness-110 hover:shadow-md active:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:hover:shadow-none disabled:active:translate-y-0`;

/** Botón secundario con borde (Limpiar). */
export const BUTTON_SECONDARY = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:border-[var(--nx-accent-indigo)] hover:bg-[rgba(74,85,212,0.06)] active:bg-[rgba(74,85,212,0.12)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-transparent disabled:hover:bg-transparent`;

/** Enlace-botón de texto (Ver detalle, Ver todos, Limpiar filtros). */
export const BUTTON_TEXT_LINK = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer rounded-[var(--nx-radius-chip)] hover:bg-[rgba(74,85,212,0.08)] active:bg-[rgba(74,85,212,0.16)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`;

// Píldora seleccionable (tabs de entidad, presets de período). Importante:
// el fondo/color/borde de CADA rama (activa e inactiva) vive enteramente
// en estas clases - nunca en un `style` inline en el JSX consumidor. Un
// `style={{background:...}}` inline tiene más especificidad que cualquier
// regla `:hover`/`:active` generada por Tailwind y la anula por completo
// (el navegador nunca llega a aplicar la regla de hover) - esa fue la
// causa exacta de que las clases hover "existieran" en el código pero no
// se reflejaran en los estilos computados. Por eso acá no hay ninguna
// versión que dependa de un `style` externo para el color de reposo.
const PILL_BASE = `${BASE_TRANSITION} ${FOCUS_RING} inline-flex min-h-11 items-center justify-center border cursor-pointer active:translate-y-px`;

/** Tab/preset ACTIVO: fondo de marca (--nx-sidebar-bg o --nx-accent-green), con hover/active en tonos reales y perceptibles, no un filtro sutil. */
export const PILL_SELECTED_DARK = `${PILL_BASE} border-transparent bg-[var(--nx-sidebar-bg)] text-white shadow-sm hover:bg-[#242a3d] hover:shadow-md active:bg-[#10131c]`;
export const PILL_SELECTED_GREEN = `${PILL_BASE} border-transparent bg-[var(--nx-accent-green)] text-white shadow-sm hover:bg-[#2f7024] hover:shadow-md active:bg-[#245a1c]`;

/** Tab/preset INACTIVO: tinte índigo claramente visible en hover, borde suave, sin depender de un solo cambio de color casi imperceptible. */
export const PILL_UNSELECTED = `${PILL_BASE} border-transparent bg-[var(--nx-page-bg)] text-[var(--nx-text-secondary)] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 hover:shadow-sm active:bg-indigo-100`;

/** Control de formulario (select/input) - hover/focus reales, sin bloqueo por `style` inline en border/background. */
export const FORM_CONTROL = `${BASE_TRANSITION} ${FOCUS_RING} min-h-11 cursor-pointer border border-[var(--nx-border)] bg-white hover:border-indigo-300 hover:bg-indigo-50/40 active:border-indigo-400`;

/** Botón de icono (44x44 mínimo, ícono más pequeño adentro). */
export const BUTTON_ICON = `${BASE_TRANSITION} ${FOCUS_RING} cursor-pointer hover:bg-[rgba(74,85,212,0.10)] active:bg-[rgba(74,85,212,0.18)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`;
