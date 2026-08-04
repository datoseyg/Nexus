// PDF NEXUS (Phase 6) - export server-side, multipágina, del detalle
// maestro de un reporte FieldBeat. Reutiliza EXACTAMENTE el contrato de
// Phase 5 (FieldbeatReportDetail) - nunca reimplementa una consulta ni una
// regla de negocio acá, y reutiliza las MISMAS etiquetas en español que ya
// usa el drawer (lib/fieldbeat-report-labels.ts) para que ambas
// superficies digan lo mismo ante el mismo dato.
//
// Elección de librería (pdfkit 0.19.1, MIT): sin bindings nativos, árbol
// de dependencias pequeño, soporta multipágina real y texto en español
// (á/é/í/ó/ú/ñ/¿/¡) vía WinAnsiEncoding de sus fuentes estándar
// (Helvetica/Helvetica-Bold) sin necesitar una fuente embebida. Se
// descartó una ruta basada en navegador headless (Puppeteer/Playwright)
// por su costo de binario/cold-start en un despliegue tipo Netlify
// serverless - inapropiado para una función que solo genera 1 PDF por
// request. `npm audit` tras instalar pdfkit no introdujo vulnerabilidades
// nuevas (verificado: package-lock.json no modifica las versiones de
// next/postcss/sharp, solo agrega el árbol propio de pdfkit).
//
// Limitación honesta: pdfkit no produce PDF etiquetado/accesible (sin
// estructura lógica UA - Tagged PDF). El PDF es visualmente profesional y
// navegable (marcadores de página, texto seleccionable/copiable, no es
// una imagen escaneada), pero no cumple PDF/UA. Documentado así en el
// reporte de cierre de Phase 6 - no se afirma conformidad que no existe.
import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  EQUIPMENT_SOURCE_LABEL,
  TEAM_IDENTIFICATION_STATUS_LABEL,
  CATALOG_MATCH_STATUS_LABEL,
  PARTICIPANT_ROLE_LABEL,
  formatFieldbeatDateTime,
  ANALYSIS_INTERVAL_BASIS_LABEL
} from "./fieldbeat-report-labels";
import type { FieldbeatReportDetail } from "@/types/fieldbeat-report-detail";

const PAGE_WIDTH = 595.28; // A4 en puntos
const PAGE_MARGIN = { top: 105, bottom: 55, left: 50, right: 50 };
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN.left - PAGE_MARGIN.right;

const INK_PRIMARY = "#1a1a1a";
const INK_SECONDARY = "#5e6b70";
const INK_MUTED = "#8a8f93";
const BRAND_GREEN = "#3c8c2e";
const RULE_COLOR = "#e2e5e7";
const WARNING_COLOR = "#8a5a00";
const DANGER_COLOR = "#b3261e";

let logoPngPromise: Promise<Buffer | null> | null = null;

// sharp ya es dependencia existente de esta app (la usa el optimizador de
// imágenes de Next) - se reutiliza acá SOLO para convertir el logo WebP a
// PNG en memoria, porque pdfkit soporta JPEG/PNG pero no WebP. Memoizado a
// nivel de módulo (1 lectura+conversión por proceso, no por PDF generado).
// Cualquier falla de lectura/conversión degrada a `null` - la generación
// del PDF nunca se bloquea por esto, simplemente sale sin logo.
function getLogoPngBuffer(): Promise<Buffer | null> {
  if (!logoPngPromise) {
    logoPngPromise = (async () => {
      try {
        const sharp = (await import("sharp")).default;
        const webpPath = path.join(process.cwd(), "public", "brand", "eyg-logo.webp");
        const webpBuffer = await readFile(webpPath);
        return await sharp(webpBuffer).png().toBuffer();
      } catch {
        return null;
      }
    })();
  }
  return logoPngPromise;
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number): void {
  const bottom = doc.page.height - PAGE_MARGIN.bottom;
  if (doc.y + neededHeight > bottom) {
    doc.addPage(); // dispara el listener "pageAdded" (ver drawHeader más abajo)
  }
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 28);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND_GREEN).text(title.toUpperCase(), PAGE_MARGIN.left, doc.y, { width: CONTENT_WIDTH });
  const ruleY = doc.y + 2;
  doc.moveTo(PAGE_MARGIN.left, ruleY).lineTo(PAGE_MARGIN.left + CONTENT_WIDTH, ruleY).strokeColor(RULE_COLOR).lineWidth(0.75).stroke();
  doc.moveDown(0.5);
}

function fieldLine(doc: PDFKit.PDFDocument, label: string, value: string): void {
  ensureSpace(doc, 16);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK_SECONDARY).text(`${label}:`, PAGE_MARGIN.left, y, { continued: true, width: CONTENT_WIDTH });
  doc.font("Helvetica").fontSize(9.5).fillColor(INK_PRIMARY).text(` ${value}`);
}

function paragraph(doc: PDFKit.PDFDocument, text: string, options: { color?: string; italic?: boolean; size?: number } = {}): void {
  doc.font(options.italic ? "Helvetica-Oblique" : "Helvetica").fontSize(options.size ?? 9.5).fillColor(options.color ?? INK_SECONDARY);
  const height = doc.heightOfString(text, { width: CONTENT_WIDTH });
  ensureSpace(doc, height + 4);
  doc.text(text, PAGE_MARGIN.left, doc.y, { width: CONTENT_WIDTH });
}

function ticketQualityLabel(detail: FieldbeatReportDetail): string {
  if (detail.quality.ticketAccessible === null && !detail.quality.ticketMissingOrRestricted) return "Sin ticket informado";
  if (detail.quality.ticketMissingOrRestricted) return "Restringido o ausente";
  return "Accesible";
}

function durationLabel(minutes: number | null): string {
  if (minutes === null) return "Sin registrar";
  if (minutes === 0) return "0 minutos (advertencia)";
  return `${minutes.toLocaleString("es-CL")} min`;
}

function drawIdentitySection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, "Identidad");
  const primary = detail.inconsistencies.find(f => f.isPrimary) ?? null;
  fieldLine(doc, "Estado", detail.report.state ?? "Sin información");
  fieldLine(doc, "Fecha", formatFieldbeatDateTime(detail.report.fieldbeatTaskDate));
  fieldLine(doc, "Tipo de tarea", detail.report.taskType ?? "Sin información");
  fieldLine(doc, "Origen", detail.report.origen ?? "Sin información");
  fieldLine(doc, "Estado de calidad", detail.report.reportQualityStatus ?? "Sin información");
  fieldLine(doc, "Severidad principal", primary ? `${primary.severity} (${primary.code})` : "Sin inconsistencias");
}

function drawQualitySummarySection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, "Resumen de calidad");
  const { quality, equipment } = detail;
  fieldLine(doc, "Completitud estructural", quality.structurallyComplete ? "Cumple" : "No cumple");
  fieldLine(doc, "Campos mínimos", quality.minimumFieldsComplete ? "Completos" : "Incompletos");
  fieldLine(doc, "Identificación de equipo", TEAM_IDENTIFICATION_STATUS_LABEL[equipment.status] ?? equipment.status);
  fieldLine(
    doc,
    "Trazabilidad de repuestos",
    quality.partTotalLines === 0 ? "Sin repuestos" : quality.partFullyTraceable ? "Totalmente trazable" : "Con brechas"
  );
  fieldLine(doc, "Campos temporales", detail.temporal.temporalIssues.length === 0 ? "Sin errores objetivos" : `${detail.temporal.temporalIssues.length} error(es) objetivo(s)`);
  fieldLine(doc, "Ticket", ticketQualityLabel(detail));
}

function drawInconsistenciesSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, `Inconsistencias (${detail.inconsistencies.length})`);
  if (detail.inconsistencies.length === 0) {
    paragraph(doc, "Sin inconsistencias detectadas para este reporte.");
    return;
  }

  const primary = detail.inconsistencies.find(f => f.isPrimary) ?? null;
  const secondary = detail.inconsistencies.filter(f => !f.isPrimary);

  if (primary) {
    paragraph(doc, `${primary.severity} · ${primary.code} (principal)`, { color: DANGER_COLOR, size: 10 });
    paragraph(doc, primary.explanation);
    if (primary.suggestedAction) paragraph(doc, primary.suggestedAction, { italic: true });
    if (primary.universe) paragraph(doc, `Universo: ${primary.universe}`, { italic: true, color: INK_MUTED });
    doc.moveDown(0.3);
  }

  for (const item of secondary) {
    paragraph(doc, `${item.severity} · ${item.code}`, { color: INK_PRIMARY, size: 9.5 });
    paragraph(doc, item.explanation);
    if (item.suggestedAction) paragraph(doc, item.suggestedAction, { italic: true });
    doc.moveDown(0.2);
  }
}

function drawTemporalSections(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  const { temporal } = detail;

  sectionTitle(doc, "Planificación");
  fieldLine(doc, "Fecha y hora programada", formatFieldbeatDateTime(temporal.scheduledAt.value));
  fieldLine(doc, "Duración estimada", durationLabel(temporal.estimatedDurationMinutes));
  fieldLine(doc, "Término estimado", formatFieldbeatDateTime(temporal.scheduledEstimatedEndAt.value));

  sectionTitle(doc, "Ejecución informada");
  fieldLine(doc, "Inicio del trabajo", formatFieldbeatDateTime(temporal.reportedWorkStartAt.value));
  fieldLine(doc, "Término del trabajo", formatFieldbeatDateTime(temporal.reportedWorkEndAt.value));
  fieldLine(doc, "Duración informada", durationLabel(temporal.reportedWorkDurationMinutes));
  fieldLine(doc, "Fuente", "Formulario FieldBeat");

  sectionTitle(doc, "Entrega");
  fieldLine(doc, "Fecha y hora de entrega", formatFieldbeatDateTime(temporal.deliveredAt.value));
  fieldLine(doc, "Diferencia respecto al término informado", durationLabel(temporal.deliveryDeltaMinutes));

  sectionTitle(doc, "Actividad del registro en FieldBeat");
  fieldLine(doc, "Reporte registrado", formatFieldbeatDateTime(temporal.reportRegisteredAt.value));
  fieldLine(doc, "Primera transición registrada", formatFieldbeatDateTime(temporal.firstTransitionAt.value));
  fieldLine(doc, "Última transición registrada", formatFieldbeatDateTime(temporal.lastTransitionAt.value));
  fieldLine(doc, "Estado actual", detail.report.state ?? "Sin información");
  paragraph(doc, "Estas fechas describen el registro dentro de FieldBeat y no necesariamente el período real de ejecución del trabajo.", { italic: true, color: INK_MUTED });

  sectionTitle(doc, "Intervalo utilizado para análisis");
  fieldLine(doc, "Inicio analizado", formatFieldbeatDateTime(temporal.analysisIntervalStartAt.value));
  fieldLine(doc, "Término analizado", formatFieldbeatDateTime(temporal.analysisIntervalEndAt.value));
  fieldLine(doc, "Duración analizada", durationLabel(temporal.analysisIntervalDurationMinutes));
  fieldLine(doc, "Base temporal", ANALYSIS_INTERVAL_BASIS_LABEL[temporal.analysisIntervalBasis] ?? temporal.analysisIntervalBasis);
  fieldLine(doc, "Fallback temporal utilizado", temporal.analysisFallbackUsed ? "Sí" : "No");
  fieldLine(doc, "Motivo del fallback", temporal.analysisFallbackReason ?? "No aplica");
  if (temporal.analysisIntervalBasis === "SCHEDULED_ESTIMATE") {
    paragraph(doc, "No se encontró un intervalo informado completo y válido.", { color: WARNING_COLOR, size: 9.5 });
  }
}

function drawTechnicianClientSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, "Responsable principal y cliente");
  fieldLine(doc, "Responsable principal", detail.technician?.name ?? "Sin información");
  fieldLine(doc, "Cliente", detail.client?.clientName ?? "Sin información");
}

// HOTFIX de integridad de datos FieldBeat (post-Phase 6) - Participantes
// 0..N, mismo contenido/orden que el drawer (data.participants ya viene
// ordenado con el responsable principal primero, ver sortParticipants() en
// lib/fieldbeat-participants.ts). Un participante no resoluble NUNCA se
// omite del PDF.
function drawParticipantsSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, `Participantes (${detail.participants.length})`);
  if (detail.participants.length === 0) {
    paragraph(doc, "Sin participantes registrados.");
    return;
  }
  for (const p of detail.participants) {
    const suffix = p.isPrimary ? " (principal)" : "";
    paragraph(doc, `• ${p.rawName}${suffix} — ${PARTICIPANT_ROLE_LABEL[p.role] ?? p.role}`, {
      color: p.resolutionStatus.startsWith("UNRESOLVED") ? WARNING_COLOR : INK_SECONDARY
    });
  }
}

// Duración real (declarada/transición validada) SEPARADA de la estimación
// de agenda - NUNCA se sustituyen entre sí, ambas siempre visibles.
function drawLaborSummarySection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, "Duración e intervención");
  const { labor } = detail;
  fieldLine(doc, "Duración real", labor.actualReportDurationMinutes === null ? "Duración real no disponible" : durationLabel(labor.actualReportDurationMinutes));
  fieldLine(doc, "Duración estimada (agenda)", labor.scheduledEstimateMinutes === null ? "Sin registrar" : `${durationLabel(labor.scheduledEstimateMinutes)} (estimado, no medido)`);
  fieldLine(doc, "Participantes", String(labor.participantCount));
  fieldLine(doc, "Minutos-persona", labor.totalLaborMinutes === null ? "Sin datos suficientes" : `${labor.totalLaborMinutes.toLocaleString("es-CL")} min-persona`);
}

function drawEquipmentSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  const { equipment } = detail;
  sectionTitle(doc, `Equipos (${equipment.items.length})`);
  if (equipment.items.length === 0) {
    paragraph(doc, `${TEAM_IDENTIFICATION_STATUS_LABEL[equipment.status] ?? "Sin equipo identificado"}.`);
    return;
  }
  for (const item of equipment.items) {
    const suffix = item.confirmed ? "" : " (sin confirmar)";
    paragraph(doc, `• ${item.internalId} — ${EQUIPMENT_SOURCE_LABEL[item.source]}${suffix}`, { color: item.confirmed ? INK_SECONDARY : WARNING_COLOR });
  }
}

function drawTicketsSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, `Tickets (${detail.tickets.length})`);
  if (detail.tickets.length === 0) {
    paragraph(doc, "Sin tickets informados.");
    return;
  }
  for (const ticket of detail.tickets) {
    paragraph(doc, `#${ticket.zendeskTicketId} — ${ticket.status ?? "Sin información"}`, { color: INK_PRIMARY, size: 9.5 });
    if (ticket.subject) paragraph(doc, ticket.subject);
  }
}

function drawPartsSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, `Repuestos (${detail.parts.length})`);
  if (detail.parts.length === 0) {
    paragraph(doc, "Sin repuestos registrados.");
    return;
  }
  for (const part of detail.parts) {
    // HOTFIX de integridad de datos: nombre y número de parte SIEMPRE ambos
    // impresos - el número real NUNCA se oculta detrás del nombre (bug real
    // que motivó este hotfix: reporte 3453, "CX1551G" nunca aparecía en el PDF).
    const name = part.rawName ?? "Sin descripción";
    const quantity = part.quantity === null ? "Sin registrar" : String(part.quantity);
    paragraph(doc, `${name} — Cant.: ${quantity}`, { color: INK_PRIMARY, size: 9.5 });
    paragraph(doc, `N° de parte: ${part.rawPartNumber ?? "Sin número declarado"}`, { size: 9.5 });

    const matchLabel = CATALOG_MATCH_STATUS_LABEL[part.catalogMatchStatus] ?? part.catalogMatchStatus;
    const skuLabel = part.matchedSku ? ` · ${part.matchedSku}` : "";
    paragraph(doc, `${matchLabel}${skuLabel}`);

    if (part.sourceLocation || part.sourceComment) {
      const comment = part.sourceComment ? ` — ${part.sourceComment}` : "";
      paragraph(doc, `Origen: ${part.sourceLocation ?? "Sin información"}${comment}`);
    }

    // "Equivalencias históricas disponibles solo cuando existe alias
    // validado" (Phase 5, preservado en el HOTFIX): matchEvidence.kind
    // discrimina esto - nunca se imprime un alias sin evidencia real en
    // manual_review.part_aliases (ver shapePartOccurrence() en
    // lib/fieldbeat-part-occurrence.ts).
    if (part.matchEvidence.kind === "AMBIGUOUS_CANDIDATES") {
      paragraph(doc, `Candidatos (sin confirmar): ${part.matchEvidence.candidateProductIds.join(", ")}`, { italic: true, color: WARNING_COLOR });
    }
    if (part.matchEvidence.kind === "HISTORICAL_ALIAS") {
      const reason = part.matchEvidence.reason ? ` (${part.matchEvidence.reason})` : "";
      paragraph(doc, `Alias histórico: ${part.matchEvidence.aliasValue}${reason}`, { italic: true });
    }
    if (part.attachment) {
      const availability = part.attachment.bytesAvailable ? "" : " (no disponible en el dataset local)";
      paragraph(doc, `Adjunto: ${part.attachment.filename}${availability}`, { italic: true });
    }
    doc.moveDown(0.2);
  }
}

function drawAuditSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, "Auditoría");
  fieldLine(doc, "Versión de contrato", detail.audit.contractVersion);
  fieldLine(doc, "Generado", formatFieldbeatDateTime(detail.audit.generatedAt));
}

export async function generateFieldbeatReportPdf(detail: FieldbeatReportDetail): Promise<Buffer> {
  const logoPng = await getLogoPngBuffer();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `Reporte FieldBeat ${detail.report.fieldbeatTaskId}`,
        Author: "NEXUS BI - E&G Medical Systems",
        Subject: "Detalle de reporte FieldBeat"
      }
    });

    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Encabezado repetido: se dibuja para la página 1 (llamada manual, ver
    // abajo) y para cada página agregada después - `addPage()` reposiciona
    // x/y al margen ANTES de emitir "pageAdded", así que este listener
    // dibuja sobre esa base y luego fuerza el cursor al inicio real del
    // contenido (bajo el área reservada del encabezado).
    const drawHeader = () => {
      // Logo y título en FILAS separadas (nunca en línea): el ancho real
      // del logo depende de su aspect ratio, así que apilar verticalmente
      // es lo único agnóstico a ese ancho - un layout en línea colisionaba
      // el texto del título contra el logo (bug real encontrado al
      // inspeccionar visualmente el primer PDF de prueba).
      const top = 24;
      if (logoPng) {
        try {
          doc.image(logoPng, PAGE_MARGIN.left, top, { height: 22 });
        } catch {
          // degrada sin logo - nunca bloquea la generación del PDF
        }
      }
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK_MUTED)
        .text("NEXUS BI · E&G Medical Systems", PAGE_MARGIN.left, top + 5, { width: CONTENT_WIDTH, align: "right" });
      doc.font("Helvetica-Bold").fontSize(14).fillColor(INK_PRIMARY)
        .text(`Reporte FieldBeat #${detail.report.fieldbeatTaskId}`, PAGE_MARGIN.left, top + 34, { width: CONTENT_WIDTH });
      const ruleY = top + 58;
      doc.moveTo(PAGE_MARGIN.left, ruleY).lineTo(PAGE_WIDTH - PAGE_MARGIN.right, ruleY).strokeColor(RULE_COLOR).lineWidth(1).stroke();
      doc.y = PAGE_MARGIN.top;
      doc.x = PAGE_MARGIN.left;
    };

    doc.on("pageAdded", drawHeader);
    drawHeader(); // "pageAdded" no se dispara para la página inicial del constructor

    drawIdentitySection(doc, detail);
    drawQualitySummarySection(doc, detail);
    drawInconsistenciesSection(doc, detail);
    drawTemporalSections(doc, detail);
    drawTechnicianClientSection(doc, detail);
    drawParticipantsSection(doc, detail);
    drawLaborSummarySection(doc, detail);
    drawEquipmentSection(doc, detail);
    drawTicketsSection(doc, detail);
    drawPartsSection(doc, detail);
    drawAuditSection(doc, detail);

    // Numeración final de páginas: pdfkit no sabe el total hasta terminar
    // de dibujar - con bufferPages:true se puede volver a cualquier
    // página ya generada (switchToPage) para agregar el pie ANTES de
    // cerrar el stream con end().
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // El pie se dibuja DENTRO del margen inferior reservado (y >
      // page.height - margins.bottom): escribir ahí con el margen normal
      // todavía activo hace que pdfkit interprete que el texto no cabe y
      // agregue una página fantasma en blanco (bug real encontrado al
      // inspeccionar visualmente el PDF de prueba - aparecían 2 páginas
      // extra casi vacías, solo con el pie, al final del documento). Se
      // anula el margen inferior SOLO para esta escritura puntual y se
      // restaura de inmediato.
      const savedBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - 35;
      doc.font("Helvetica").fontSize(8).fillColor(INK_MUTED)
        .text(`Página ${i - range.start + 1} de ${range.count}`, PAGE_MARGIN.left, footerY, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
      doc.page.margins.bottom = savedBottomMargin;
    }

    doc.end();
  });
}
