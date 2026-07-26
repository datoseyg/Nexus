"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { ErrorBanner } from "@/components/ErrorBanner";
import { triggerBlobDownload } from "@/lib/csv-export";
import { buildFieldbeatQueryString, type FieldbeatUrlState } from "@/lib/fieldbeat-tabs-url-state";
import { FieldbeatReportDetailContent } from "./FieldbeatReportDetailContent";

const PANEL_WIDTH_CLASS = "w-full sm:w-[600px] lg:w-[720px]";

/** id del elemento de fallback en FieldbeatReportsTab.tsx - destino de foco
 * cuando el drawer se cierra y NUNCA hubo un elemento originador real
 * (apertura por URL directa/deep-link, sin click previo del usuario). */
export const FIELDBEAT_REPORTS_FOCUS_FALLBACK_ID = "fieldbeat-reports-focus-fallback";

interface FieldbeatReportDetailDrawerProps {
  reportId: string | null;
  urlState: FieldbeatUrlState;
  onClose: () => void;
}

// Drawer de detalle maestro (Phase 5) - reutiliza components/ui/DetailDrawer.tsx
// sin deformarlo (solo pide un panel más ancho vía panelWidthClassName, ver
// ese archivo). Cambiar de reportId con el drawer abierto NO desmonta
// FieldbeatReportDetailContent (React no remonta un componente solo porque
// cambia un prop) - lo que evita mostrar datos del reporte previo es que
// useAfterHoursSection reconstruye su `path` a partir de reportId, su
// efecto interno vuelve a correr, cancela el fetch anterior y pasa a
// status="refreshing" (que este componente trata igual que "loading") -
// nunca queda expuesto el contenido del reporte anterior bajo el ID nuevo.
export function FieldbeatReportDetailDrawer({ reportId, urlState, onClose }: FieldbeatReportDetailDrawerProps) {
  const open = reportId !== null;
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  // false por defecto (nunca asumir disponibilidad) hasta que
  // FieldbeatReportDetailContent confirme audit.fieldbeatOpenAvailable vía
  // onMeta - el cliente NUNCA recibe fleet/token, solo este booleano.
  const [openAvailable, setOpenAvailable] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const openedWithoutOriginRef = useRef(false);

  // useLayoutEffect, no useEffect: DetailDrawer (hijo) mueve el foco a SU
  // PROPIO botón de cerrar dentro de un useEffect normal - los efectos de
  // layout de TODO el árbol (padre e hijo) corren antes que CUALQUIER
  // efecto pasivo, así que este useLayoutEffect del padre lee
  // document.activeElement ANTES de que DetailDrawer alcance a robarle el
  // foco a su botón de cerrar. Con useEffect acá, activeElement YA era el
  // botón de cerrar (nunca <body>) en el momento de leerlo - bug real
  // encontrado en validación de navegador: el fallback nunca se activaba,
  // ni siquiera en una apertura por URL directa genuina.
  useLayoutEffect(() => {
    if (open) {
      // Ninguno de los dos consumidores existentes de DetailDrawer es
      // URL-driven (ver investigación Phase 5) - esta es la primera
      // instancia donde el drawer puede abrir sin que un click/Enter/Space
      // haya movido el foco primero (carga directa con ?report=<id> ya en
      // la URL). En ese caso document.activeElement sigue siendo <body> en
      // el momento en que este efecto corre.
      openedWithoutOriginRef.current = typeof document !== "undefined" && document.activeElement === document.body;
      setCopyStatus("idle");
      // Mismo motivo que copyStatus: cambiar de reporte sin cerrar el
      // drawer no debe conservar la disponibilidad/errores del reporte
      // anterior - vuelve a false hasta que el onMeta del reporte NUEVO
      // confirme su propio audit.fieldbeatOpenAvailable.
      setOpenAvailable(false);
      setPdfError(null);
    }
    // Depende también de reportId (no solo open): cambiar de un reporte a
    // otro sin cerrar el drawer (click en una fila distinta mientras ya
    // hay uno abierto) mantiene open=true, pero SÍ debe re-evaluar el
    // origen del foco (bug real de code review: sin esto, cambiar de
    // reporte via click mientras el drawer estaba abierto por deep-link
    // conservaba el flag "sin origen" de la apertura anterior) y SÍ debe
    // resetear "Enlace copiado" (bug real de code review: sin esto, el
    // botón seguía mostrando "Enlace copiado ✓" de un reporte anterior
    // aunque el contenido visible ya fuera el del reporte nuevo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId]);

  useEffect(() => {
    if (open || !openedWithoutOriginRef.current) return;
    // Corre en el efecto del padre, DESPUÉS del cleanup de DetailDrawer
    // (que intentó restaurar foco a `body`, un no-op) - fallback deliberado
    // en vez de dejar el foco perdido tras cerrar un drawer abierto por
    // deep-link.
    document.getElementById(FIELDBEAT_REPORTS_FOCUS_FALLBACK_ID)?.focus();
  }, [open]);

  async function handleCopyLink() {
    if (typeof window === "undefined") return;
    const qs = buildFieldbeatQueryString(urlState);
    const url = `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  // Mismo patrón fetch->blob->triggerBlobDownload que
  // FieldbeatReportsTab.handleExport (CSV) - el nombre de archivo real
  // viene del Content-Disposition del servidor, nunca se reconstruye acá.
  async function handleDownloadPdf() {
    if (!reportId) return;
    setPdfError(null);
    setPdfDownloading(true);
    try {
      const res = await fetch(`/api/dashboard/fieldbeat/reports/${reportId}/pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setPdfError(body?.error ?? `No fue posible descargar el PDF (HTTP ${res.status}).`);
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] ?? `nexus_fieldbeat_reporte_${reportId}.pdf`;
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
    } catch {
      setPdfError("No fue posible descargar el PDF - revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setPdfDownloading(false);
    }
  }

  const secondaryButtonClassName =
    "rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[12.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)] disabled:opacity-60 disabled:cursor-not-allowed";
  const secondaryButtonStyle = { background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)", border: "1px solid var(--nx-border)" };

  return (
    <DetailDrawer open={open} onClose={onClose} title={`Reporte FieldBeat ${reportId ?? ""}`} panelWidthClassName={PANEL_WIDTH_CLASS}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleCopyLink} className={secondaryButtonClassName} style={secondaryButtonStyle}>
          {copyStatus === "copied" ? "Enlace copiado ✓" : copyStatus === "error" ? "No se pudo copiar" : "Copiar enlace"}
        </button>
        <button type="button" onClick={handleDownloadPdf} disabled={pdfDownloading || !reportId} className={secondaryButtonClassName} style={secondaryButtonStyle}>
          {pdfDownloading ? "Generando PDF…" : "Descargar PDF"}
        </button>
        {/* "Abrir en FieldBeat" (Phase 6, riesgo aceptado 27.B): <a> nativo,
            NUNCA next/link - Link precargaría esta ruta (prefetch en
            viewport/hover), disparando el redirect con token ANTES de que
            el usuario decida abrirlo. openAvailable llega SOLO como este
            booleano (ver onMeta más abajo) - el cliente nunca recibe
            fleet/token, solo puede saber si está configurado o no. Cuando
            no está disponible se muestra un <button disabled> en el MISMO
            lugar (nunca se oculta ni se muestra como un link funcional que
            en realidad no lo es). */}
        {openAvailable && reportId ? (
          <a
            href={`/api/dashboard/fieldbeat/reports/${reportId}/open`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir en FieldBeat (se abre en una pestaña nueva)"
            className={secondaryButtonClassName}
            style={secondaryButtonStyle}
          >
            Abrir en FieldBeat ↗
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-label="Abrir en FieldBeat: no disponible en este entorno"
            title="No disponible: configuración de FieldBeat ausente en este entorno"
            className={secondaryButtonClassName}
            style={secondaryButtonStyle}
          >
            Abrir en FieldBeat
          </button>
        )}
      </div>
      <div aria-live="polite" className="sr-only">
        {copyStatus === "copied" ? "Enlace copiado al portapapeles." : copyStatus === "error" ? "No fue posible copiar el enlace." : ""}
        {pdfDownloading ? " Generando PDF…" : ""}
      </div>
      {pdfError && (
        <div role="alert" className="mb-3">
          <ErrorBanner message={pdfError} />
        </div>
      )}
      {reportId && (
        <FieldbeatReportDetailContent
          reportId={reportId}
          onMeta={meta => setOpenAvailable(meta?.fieldbeatOpenAvailable ?? false)}
        />
      )}
    </DetailDrawer>
  );
}
