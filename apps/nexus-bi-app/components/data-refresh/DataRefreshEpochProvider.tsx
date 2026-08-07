"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useDataRefreshSucceededListener } from "@/lib/data-refresh-events";
import { DataRefreshEpochContext, useDataRefreshEpoch } from "@/lib/data-refresh-epoch-context";

// Montado UNA sola vez en components/layout/AppShell.tsx, envolviendo todo
// el árbol autenticado (mismo criterio que "un solo Sidebar, nunca
// duplicado por página" ya establecido para DataRefreshControl). Traduce el
// evento crudo nexus:data-refresh-succeeded en un número que solo sube
// (epoch) - la forma más simple de agregar a un array de dependencias de
// useEffect YA EXISTENTE en cualquier vista sin tocar qué/cómo fetchea esa
// vista, solo CUÁNDO vuelve a hacerlo. Arranca en 0 - las vistas nunca
// deben usar epoch===0 como señal de "hubo un refresh", solo los cambios
// de valor importan.
//
// El contexto en sí vive en lib/data-refresh-epoch-context.ts (sin JSX) -
// ver el comentario de ese archivo. useDataRefreshEpoch se reexporta acá
// para que las vistas .tsx puedan seguir importándolo desde este mismo
// archivo, sin tener que saber que el contexto vive en otro lado.
export { useDataRefreshEpoch };

export function DataRefreshEpochProvider({ children }: { children: ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  const bump = useCallback(() => setEpoch(e => e + 1), []);
  useDataRefreshSucceededListener(bump);

  return <DataRefreshEpochContext.Provider value={epoch}>{children}</DataRefreshEpochContext.Provider>;
}
