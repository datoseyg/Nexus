"use client";

import { useEffect } from "react";

// Abstracción chica y reutilizable para "los datos acaban de cambiar,
// quien esté mirando algo debería refrescar" (NEXUS V3 - no existía ningún
// mecanismo de invalidación entre componentes en esta app: todo el resto
// del código fetchea con useEffect+fetch plano, sin SWR/React Query/
// contexto global). Un CustomEvent en window es la forma más simple que
// cruza el árbol de componentes sin acoplar DataRefreshControl.tsx (sidebar)
// a cada vista que necesita reaccionar - ninguna vista importa la otra.
//
// Quien EMITE el evento (DataRefreshControl.tsx) usa dispatchDataRefreshSucceeded.
// Quien CONSUME (cada vista) usa el hook de más abajo, useDataRefreshEpoch
// (components/data-refresh/DataRefreshEpochProvider.tsx) - la mayoría de
// las vistas de esta app NO necesitan el detalle crudo del evento, solo
// "algo cambió, volvé a pedir tus datos", así que el patrón recomendado es
// el epoch (un número que sube en 1 por cada SUCCEEDED nuevo, agregable
// directo a un array de dependencias de useEffect existente) - este hook de
// más abajo (useDataRefreshSucceededListener) expone el detalle completo
// {refreshRunId, finishedAt, sourceSnapshotId} para el puñado de casos que
// sí lo necesiten.
export const DATA_REFRESH_SUCCEEDED_EVENT = "nexus:data-refresh-succeeded";

export interface DataRefreshSucceededDetail {
  refreshRunId: string;
  finishedAt: string;
  sourceSnapshotId: string | null;
}

export function dispatchDataRefreshSucceeded(detail: DataRefreshSucceededDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DataRefreshSucceededDetail>(DATA_REFRESH_SUCCEEDED_EVENT, { detail }));
}

// Hook de bajo nivel - se suscribe/desuscribe correctamente en cada
// render (handler siempre la versión más reciente, sin pedirle al caller
// que memorice con useCallback) y limpia al desmontar.
export function useDataRefreshSucceededListener(handler: (detail: DataRefreshSucceededDetail) => void): void {
  useEffect(() => {
    function onEvent(event: Event) {
      handler((event as CustomEvent<DataRefreshSucceededDetail>).detail);
    }
    window.addEventListener(DATA_REFRESH_SUCCEEDED_EVENT, onEvent);
    return () => window.removeEventListener(DATA_REFRESH_SUCCEEDED_EVENT, onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler]);
}
