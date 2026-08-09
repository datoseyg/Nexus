"use client";

import { createContext, useContext } from "react";

// Contexto puro (sin JSX) - separado a propósito de
// components/data-refresh/DataRefreshEpochProvider.tsx (que sí tiene JSX,
// el <Provider>). lib/use-after-hours-section.ts es un módulo .ts sin JSX
// que test/after-hours/use-after-hours-section.test.ts importa DIRECTO para
// probar su lógica pura (shouldApplyResponse) - si consumiera
// useDataRefreshEpoch desde el .tsx, ese import arrastraría JSX real y
// rompería ese test (el runner de este repo, node --experimental-strip-types,
// no puede cargar .tsx - mismo límite documentado en
// test/layout/root-layout-catch-isolation.test.ts; regresión real detectada
// y corregida en la misma sesión que introdujo el epoch). Cualquier vista
// .tsx sigue pudiendo importar useDataRefreshEpoch desde
// components/data-refresh/DataRefreshEpochProvider.tsx (reexportado desde
// ahí) - este archivo es la única fuente de verdad real del contexto.
export const DataRefreshEpochContext = createContext(0);

export function useDataRefreshEpoch(): number {
  return useContext(DataRefreshEpochContext);
}
