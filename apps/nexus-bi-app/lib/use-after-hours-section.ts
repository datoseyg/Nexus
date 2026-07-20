"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Hook compartido de fetch por sección para /dashboard/after-hours (ETAPA
// 6.6D) - cada bloque (summary, by-period, by-technician, ..., by-weekday,
// weekday-hour, technician-client) obtiene su PROPIO ciclo de vida
// independiente en vez de coordinarse en un único Promise.all/allSettled:
// así una sección que falla nunca bloquea a las demás, y cada una permite
// reintento verdaderamente local (retry() de ESTA sección, no de la
// página completa).
//
// Inspirado en el mismo patrón ya usado por useRemoteData() en
// components/home/HomeDashboard.tsx (AbortController + estado por
// fetch), extendido con lo que ese hook no necesitaba:
//   - "refreshing": cuando ya había datos y los filtros cambian, se
//     conservan visibles mientras llega la respuesta nueva (marcados
//     como tal - ver AfterHoursShell), en vez de saltar a un loading en
//     blanco.
//   - retry(): reintento manual de ESTA sección únicamente.
//   - guarda de generación explícita (`requestId`), además del
//     AbortController: una respuesta cuyo `requestId` capturado ya no
//     coincide con el vigente se descarta SIN tocar el estado, sin
//     depender únicamente de que el abort se propague a tiempo. Esta es
//     la garantía real contra respuestas fuera de orden (ver
//     shouldApplyResponse, testeable sin DOM).
export type AfterHoursSectionStatus = "idle" | "loading" | "refreshing" | "success" | "empty" | "error";

export interface AfterHoursSectionState<T> {
  status: AfterHoursSectionStatus;
  data: T | null;
  error: string | null;
  retry: () => void;
}

/**
 * Pura, sin DOM - decide si una respuesta capturada en `capturedRequestId`
 * debe aplicarse dado el `currentRequestId` vigente al momento de resolver.
 * Extraída para ser unit-testeable sin useEffect/jsdom (el repo no tiene
 * infraestructura de test de hooks).
 */
export function shouldApplyResponse(capturedRequestId: number, currentRequestId: number): boolean {
  return capturedRequestId === currentRequestId;
}

/**
 * @param path ruta del endpoint, ej. "/api/dashboard/after-hours/by-weekday"
 * @param query query string YA serializado (sin "?"), ej. "client=X&from=..."
 * @param isEmpty predicado de vacío semántico - DEBE ser una función
 * definida a nivel de módulo (no un arrow function inline recreado en cada
 * render), para no disparar un refetch espurio por cambiar de identidad en
 * cada render (ver `deps` del useEffect interno, que solo depende de
 * path/query/retryNonce -nunca de `isEmpty` en sí).
 */
export function useAfterHoursSection<T>(path: string, query: string, isEmpty: (data: T) => boolean): AfterHoursSectionState<T> {
  const [status, setStatus] = useState<AfterHoursSectionStatus>("idle");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;

    setStatus(prev => (prev === "success" || prev === "empty" || prev === "refreshing" ? "refreshing" : "loading"));
    setError(null);

    const url = query ? `${path}?${query}` : path;

    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async res => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
          throw new Error(message);
        }
        return body as T;
      })
      .then(body => {
        if (!mountedRef.current) return;
        if (!shouldApplyResponse(requestId, requestIdRef.current)) return; // respuesta obsoleta - se descarta sin tocar el estado
        setData(body);
        setStatus(isEmptyRef.current(body) ? "empty" : "success");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return; // abort esperado (cleanup/nuevo fetch), nunca un error visible
        if (!mountedRef.current) return;
        if (!shouldApplyResponse(requestId, requestIdRef.current)) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Error desconocido");
      });

    return () => controller.abort();
  }, [path, query, retryNonce]);

  const retry = useCallback(() => setRetryNonce(n => n + 1), []);

  return { status, data, error, retry };
}
