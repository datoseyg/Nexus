# 07 -Sistema de marca

**Regla dura de este archivo:** los colores de `globals.css` **no se declaran "paleta oficial de EyG"** -son tokens de implementación presentes en HEAD, remapeados a partir de un rediseño documentado solo en una branch no mergeada. Cinco categorías, deliberadamente no mezclables entre sí.

## 1. Tokens presentes en HEAD (`supabase-migration`, commit `4a3d055`) -AS_IS · CONFIRMADA

| Token | Valor (claro) | Valor (oscuro) | Uso |
|---|---|---|---|
| `--eyg-green` | `#6bbe45` | `#7fce57` | Acento, hover, éxito |
| `--eyg-green-dark` | `#3c8c2e` | `#5fb043` | Principal -botones, tabs activos, líneas de gráfico |
| `--eyg-lime` | `#a7d943` | (no redefinido) | Acento cálido / variedad categórica |
| `--eyg-teal` | `#1f8a8a` | `#3bb0b0` | Secundario -degradado del "logo", KPIs secundarios |
| `--eyg-ink` | `#243033` | `#eef3f1` | Texto principal |
| `--eyg-muted` | `#5e6b70` | `#a9b8b3` | Texto secundario |
| `--eyg-bg` | `#f4f7f6` | `#131a17` | Fondo general |
| `--eyg-card` | `#ffffff` | `#1b2422` | Fondo de tarjetas |
| `--eyg-border` | `#dde6e3` | `#2c3833` | Bordes |
| `--eyg-warning` | `#f4b740` | (heredado) | Solo advertencias |
| `--eyg-danger` | `#d9534f` | (heredado) | Solo errores/críticos |
| `--eyg-info` | `#2d9cdb` | (heredado) | Acento informativo puntual, nunca color principal |

Evidencia: STATIC_CODE `apps/nexus-bi-app/app/globals.css:8-19` (claro), `:36-59` (oscuro, vía `@media (prefers-color-scheme: dark)`) -confirmado por lectura directa completa del archivo en esta sesión. Paleta categórica de charts: `lib/dashboard-formatters.ts:9-33` (`DASHBOARD_PALETTE`/`DASHBOARD_PALETTE_SEQUENCE`, verde primero).

Tipografía: `body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }` -STATIC_CODE `globals.css:66`. **Es un stack de fuentes del sistema, no una tipografía institucional diseñada.**

## 2. Activos presentes en el repositorio -AUSENCIA CONFIRMADA en las 5 branches

No existe ningún archivo de imagen (`.svg/.png/.ico/.jpg/.jpeg/.webp`, fuera de `node_modules`) en **ninguna** de las 5 branches del repositorio, incluida `cloud-d1-readonly` (la branch del rediseño visual documentado):

- Comando: `git ls-tree -r <branch> --name-only | grep -iE "\.(svg|png|ico|jpe?g|webp)$"` sobre `main`, `cloudflare-migration`, `cloud-d1-readonly`, `cloud-smoke-test`, `supabase-migration` → **0 resultados en las 5**.
- No existe `apps/nexus-bi-app/public/` en `supabase-migration` (confirmado: el directorio no existe). En `cloud-d1-readonly` sí existe `public/`, pero solo contiene JSON de datos estáticos (`public/data/cloud/*.json`) para el modo de despliegue D1 -ningún asset visual.
- El único "logo" que existe en cualquier branch es un badge CSS (texto "EyG" sobre un `linear-gradient(135deg, var(--eyg-green-dark), var(--eyg-teal))`, 32×32px, `border-radius`) -STATIC_CODE `apps/nexus-bi-app/components/NavBar.tsx:35-40`.

Estado: AS_IS · CONFIRMADA (ausencia).

## 3. Activos corporativos oficiales externos -DESCONOCIDA, no poseídos por este repositorio

No se posee ningún manual de marca real de EyG dentro de este repositorio. El único indicio de una identidad corporativa externa es una referencia textual: "Referencia institucional: eygsa.cl -estética limpia, profesional, verde/gris" (ver §4). Este repositorio **nunca descargó, capturó ni versionó** ningún activo desde ese dominio -es una nota de inspiración escrita a mano, no una fuente extraída.

Estado: DESCONOCIDA. Se declara explícitamente el vacío en vez de inferir una paleta "oficial" a partir de los tokens de §1.

## 4. Documentación recuperada de branches históricas -LEGACY, no vigente en HEAD

`docs/VISUAL_REDESIGN_EYG.md` y `docs/DASHBOARD_VISUAL_STYLE.md` son referenciados por comentarios del código actual (`globals.css:3`, `NavBar.tsx:16-17`, `lib/dashboard-formatters.ts`) pero **no existen en `supabase-migration`** -confirmado por lectura directa del directorio `docs/` en esta sesión.

Recuperado vía `git show cloud-d1-readonly:docs/VISUAL_REDESIGN_EYG.md` (commit `7e69d7c`, rama `cloud-d1-readonly`/`cloud-smoke-test`, **nunca mergeada a `main` ni a `supabase-migration`** -GIT_HISTORY):

- Título del propio documento: "Rediseño visual - identidad E&G Medical Systems".
- Cita textual: "para que la app deje de verse como un dashboard genérico azul y refleje la identidad de **E&G Medical Systems** (empresa médica/tecnológica: instalación, soporte y equipamiento médico de alta tecnología). Referencia institucional: eygsa.cl".
- Regla de uso documentada allí: "verde E&G es el color principal (nunca azul genérico); teal es el único secundario; amarillo/rojo quedan reservados semánticamente para advertencia/error."
- **Importante -separar dos afirmaciones distintas:** los *valores* de los tokens (`#6bbe45`, `#3c8c2e`, etc.) son byte-idénticos entre `cloud-d1-readonly` y `supabase-migration` (confirmado: `git diff HEAD cloud-d1-readonly -- apps/nexus-bi-app/app/globals.css` → vacío) -es decir, los tokens SÍ están vigentes en HEAD (§1, AS_IS). Lo que es LEGACY es únicamente el **documento que explica el porqué y cita "E&G Medical Systems"/eygsa.cl** -ese documento nunca se portó a la branch auditada. No se debe presentar "E&G Medical Systems" como el nombre comercial confirmado de la marca en esta auditoría: es una nota de un documento no vigente, no una fuente oficial verificada.

Estado: tokens = AS_IS · CONFIRMADA; nombre "E&G Medical Systems" y narrativa de marca = LEGACY · PARCIALMENTE CONFIRMADA (existe como texto de un documento de diseño interno, no como fuente corporativa oficial -ver §3).

## 5. Decisiones propuestas de diseño -TO_BE, claramente separadas de lo anterior

Ninguna en este documento. Cualquier propuesta de sistema de marca para el nuevo frontend (logo vectorial, variantes, tipografía institucional) es responsabilidad de Claude Design **después** de que el registro de decisiones (`11-product-decision-register.md`, entrada "Fuentes oficiales de branding") se resuelva -no de esta auditoría.

## Vacíos declarados explícitamente (ninguno se debe inferir ni completar por conveniencia)

| Elemento | Estado |
|---|---|
| Logo vectorial (SVG/EPS/AI) | Ausente en las 5 branches -CONFIRMADA |
| Manual de marca | Ausente en el repositorio -DESCONOCIDA si existe fuera de él |
| Tipografías oficiales (archivos de fuente o licencia) | Ausente -CONFIRMADA (solo stack de fuentes del sistema) |
| Reglas de uso del logo (espaciado mínimo, tamaños, fondos permitidos) | Ausente -CONFIRMADA |
| Variantes monocromáticas | Ausente -CONFIRMADA |
| Iconografía institucional | Ausente -no se encontró ningún set de íconos propio (los íconos, si los hay en componentes, no se auditaron línea por línea en esta pasada -ver nota abajo) | 

Nota: esta auditoría no inspeccionó cada componente en busca de íconos SVG inline uno por uno; la afirmación de ausencia de "iconografía institucional" se basa en la ausencia confirmada de archivos de asset (§2), no en una revisión exhaustiva de cada JSX. Si Claude Design necesita confirmar esto con más profundidad, es una verificación adicional de bajo costo, no un vacío estructural.

## Fuentes

`apps/nexus-bi-app/app/globals.css`, `components/NavBar.tsx`, `lib/dashboard-formatters.ts`, `git ls-tree` sobre las 5 branches, `git show cloud-d1-readonly:docs/VISUAL_REDESIGN_EYG.md` (GIT_HISTORY, commit `7e69d7c`), `git diff HEAD cloud-d1-readonly -- apps/nexus-bi-app/app/globals.css` (confirma paridad de tokens).
