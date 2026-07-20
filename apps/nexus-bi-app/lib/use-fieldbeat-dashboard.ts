"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseFieldbeatDashboardResponse, FieldbeatContractError } from "./fieldbeat-contract";
import type { FieldbeatDashboardResponse } from "@/types/fieldbeat";

// ETAPA 5 - hook de fetch único (sin filtros, un solo endpoint). Separa
// explícitamente dos causas de "no se pudo mostrar la información":
//   - error de TRANSPORTE (fetch falla, response.ok=false)
//   - error de CONTRATO (parseFieldbeatDashboardResponse lanza
//     FieldbeatContractError - forma inesperada del body)
// Ambas colapsan a status="error" acá (mismo tratamiento visible:
// ErrorBanner + Reintentar) - pero NINGUNA de las dos llega nunca a
// evaluateFieldbeatPageStatus() (lib/fieldbeat-page-status.ts), que solo
// se invoca desde el Shell cuando status==="success", es decir, sobre un
// contrato ya validado y normalizado.
export type FieldbeatFetchStatus = "idle" | "loading" | "success" | "error";

export interface FieldbeatFetchState {
  status: FieldbeatFetchStatus;
  data: FieldbeatDashboardResponse | null;
  error: string | null;
  retry: () => void;
}

/**
 * Pura, sin DOM - decide si una respuesta capturada en `capturedRequestId`
 * debe aplicarse dado el `currentRequestId` vigente al momento de
 * resolver. Extraída para ser unit-testeable sin useEffect/jsdom (mismo
 * patrón que shouldApplyResponse() en lib/use-after-hours-section.ts).
 */
export function shouldApplyFieldbeatResponse(capturedRequestId: number, currentRequestId: number): boolean {
  return capturedRequestId === currentRequestId;
}

const FIELDBEAT_ENDPOINT = "/api/dashboard/fieldbeat";

export function useFieldbeatDashboard(): FieldbeatFetchState {
  const [status, setStatus] = useState<FieldbeatFetchStatus>("idle");
  const [data, setData] = useState<FieldbeatDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;

    setStatus("loading");
    setError(null);

    fetch(FIELDBEAT_ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then(async res => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message = body && typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
          throw new Error(message);
        }
        // Nunca `body as FieldbeatDashboardResponse` - se valida y
        // normaliza acá, una sola vez, antes de que cualquier estado del
        // hook lo exponga al resto de la app.
        return parseFieldbeatDashboardResponse(body);
      })
      .then(parsed => {
        if (!mountedRef.current) return;
        if (!shouldApplyFieldbeatResponse(requestId, requestIdRef.current)) return; // respuesta obsoleta - se descarta sin tocar el estado
        setData(parsed); // reemplaza SIEMPRE los datos anteriores, incluso si el resultado nuevo está vacío
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return; // abort esperado, nunca un error visible
        if (!mountedRef.current) return;
        if (!shouldApplyFieldbeatResponse(requestId, requestIdRef.current)) return;
        const message = err instanceof FieldbeatContractError ? err.message : err instanceof Error ? err.message : "Error desconocido";
        setStatus("error");
        setError(message);
      });

    return () => controller.abort();
  }, [retryNonce]);

  // retry() repite el fetch existente (incrementa retryNonce) - nunca
  // window.location.reload().
  const retry = useCallback(() => setRetryNonce(n => n + 1), []);

  return { status, data, error, retry };
}
