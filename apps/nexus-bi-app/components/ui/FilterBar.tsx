"use client";

import { useId } from "react";
import { BUTTON_GHOST } from "@/components/ui/interactive";

interface FilterBarBaseProps {
  quickAccess?: React.ReactNode;
  children: React.ReactNode;
  chips?: React.ReactNode;
  actions?: React.ReactNode;
}

interface FilterBarWithoutMoreFilters extends FilterBarBaseProps {
  moreFilters?: never;
  moreFiltersOpen?: never;
  onToggleMoreFilters?: never;
  moreFiltersLabel?: never;
}

interface FilterBarWithMoreFilters extends FilterBarBaseProps {
  moreFilters: Exclude<
    React.ReactNode,
    null | undefined | boolean
  >;
  moreFiltersOpen: boolean;
  onToggleMoreFilters: () => void;
  moreFiltersLabel?: string;
}

type FilterBarProps =
  | FilterBarWithoutMoreFilters
  | FilterBarWithMoreFilters;

// Type predicate explícito. Se probó empíricamente (tsc --noEmit sobre un
// archivo de verificación temporal, no versionado) que un `"moreFilters"
// in props` inline NO angosta props.moreFiltersOpen/onToggleMoreFilters a
// sus tipos estrictos en esta unión - moreFilters está declarado (como
// `never` opcional) en las dos variantes, así que TypeScript no descarta
// FilterBarWithoutMoreFilters solo por la presencia de la clave. El
// predicate function fuerza el angostamiento real (verificado: dentro del
// `if`/`&&` que lo usa, moreFiltersOpen es `boolean` y no
// `boolean | undefined`), sin recurrir a `as`/`any`/`@ts-ignore`.
function hasMoreFiltersGuard(
  props: FilterBarProps,
): props is FilterBarWithMoreFilters {
  return props.moreFilters !== undefined;
}

// Componente de composición/slots para la barra de filtros, sin lógica ni
// vocabulario de negocio (nada de "cliente", "máquina", "auditoría",
// "endpoint" vive acá). Resuelve únicamente layout, accesibilidad y
// estructura visual - cada pantalla mantiene su propio estado y lógica de
// filtros y le pasa contenido ya armado.
//
// Completamente controlado: no guarda moreFiltersOpen en estado propio.
// La pantalla es dueña de ese estado y lo pasa por prop;
// onToggleMoreFilters solo solicita el cambio, no lo aplica.
//
// El parámetro se recibe como `props` (no destructurado en la firma) y
// solo se destructuran acá los campos comunes a ambas variantes
// (quickAccess/children/chips/actions). Los campos que distinguen la
// unión (moreFilters y compañía) se leen siempre vía `props.`, nunca
// destructurados aparte, para que el angostamiento de `hasMoreFilters`
// (ver más abajo) siga aplicando dentro de cada bloque `hasMoreFilters &&
// (...)` - destructurarlos por separado perdería la correlación entre
// ellos y el chequeo dejaría de ser exhaustivo.
//
// Los componentes existentes (components/dashboard/FilterBar.tsx,
// components/audit/AuditFilterBar.tsx) no se tocan ni se borran - siguen
// sirviendo a las pantallas actuales hasta que una etapa posterior migre
// cada una. Este componente todavía no está conectado a ninguna pantalla.
export function FilterBar(props: FilterBarProps) {
  const { quickAccess, children, chips, actions } = props;
  const moreFiltersPanelId = useId();
  // Discriminador estructural, no de verdad/falsedad: moreFilters está
  // tipado Exclude<ReactNode, null | undefined | boolean>, pero 0 y ""
  // siguen siendo ReactNode válidos y son falsy - si se discriminara con
  // `props.moreFilters && (...)`, pasar moreFilters={0} (u otro valor
  // falsy admitido por el tipo) ocultaría el botón y el panel aunque la
  // variante con filtros esté activa según el tipo. La presencia de la
  // propiedad en `props` (no su valor) es lo que decide qué variante de
  // la unión aplica - hasMoreFiltersGuard() además angosta de verdad el
  // tipo de `props` (ver comentario junto a su definición), a diferencia
  // de un `"moreFilters" in props` inline suelto.
  const hasMoreFilters = hasMoreFiltersGuard(props);

  return (
    <div
      className="rounded-[var(--nx-radius-card)] p-3.5"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      {quickAccess && <div className="mb-2.5 flex flex-wrap gap-1.5">{quickAccess}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {children}

        {hasMoreFilters && (
          <button
            type="button"
            aria-expanded={props.moreFiltersOpen}
            aria-controls={moreFiltersPanelId}
            onClick={props.onToggleMoreFilters}
            className={`rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-[13px] font-semibold ${BUTTON_GHOST}`}
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-accent-indigo)" }}
          >
            {props.moreFiltersLabel ?? (props.moreFiltersOpen ? "Menos filtros" : "Más filtros")}
          </button>
        )}

        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {hasMoreFilters && (
        <div
          id={moreFiltersPanelId}
          hidden={!props.moreFiltersOpen}
          className="mt-2.5 flex flex-wrap gap-2 border-t border-dashed pt-2.5"
          style={{ borderColor: "var(--nx-border)" }}
        >
          {props.moreFilters}
        </div>
      )}

      {chips && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5" style={{ borderColor: "var(--nx-border)" }}>
          {chips}
        </div>
      )}
    </div>
  );
}
