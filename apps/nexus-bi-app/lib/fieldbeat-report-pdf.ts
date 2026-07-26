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
import { EQUIPMENT_SOURCE_LABEL, TEAM_IDENTIFICATION_STATUS_LABEL, formatFieldbeatDateTime } from "./fieldbeat-report-labels";
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
  fieldLine(
    doc,
    "Consistencia temporal",
    quality.hasSufficientTimestamps ? (quality.chronologyImpossible ? "Cronología imposible" : "Consistente") : "Sin información suficiente"
  );
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

function drawChronologySection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, "Cronología");
  const { chronology } = detail;
  fieldLine(doc, "Creación", formatFieldbeatDateTime(chronology.createdAt));
  fieldLine(doc, "Inicio", formatFieldbeatDateTime(chronology.startTime));
  fieldLine(doc, "Última transición", formatFieldbeatDateTime(chronology.lastTransitionAt));
  fieldLine(doc, "Duración", durationLabel(chronology.durationMinutes));
  if (chronology.chronologyImpossible) {
    paragraph(doc, "Cronología imposible: la última transición ocurre antes del inicio registrado.", { color: DANGER_COLOR, size: 9.5 });
  }
}

function drawTechnicianClientSection(doc: PDFKit.PDFDocument, detail: FieldbeatReportDetail): void {
  sectionTitle(doc, "Técnico y cliente");
  fieldLine(doc, "Técnico", detail.technician?.name ?? "Sin información");
  fieldLine(doc, "Cliente", detail.client?.clientName ?? "Sin información");
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
    const name = part.partName ?? part.rawPartIdentifier ?? "Sin descripción";
    const quantity = part.quantity === null ? "Sin registrar" : String(part.quantity);
    paragraph(doc, `${name} — Cant.: ${quantity}`, { color: INK_PRIMARY, size: 9.5 });

    const matchLabel = part.historicalMatchStatus ?? "Sin clasificar";
    const productLabel = part.dolibarrProduct ? ` · ${part.dolibarrProduct.label ?? part.dolibarrProduct.ref ?? part.dolibarrProduct.productId}` : "";
    paragraph(doc, `${matchLabel}${productLabel}`);

    // "Equivalencias históricas disponibles solo cuando existe alias
    // validado" (Phase 5): nunca se imprime un alias aunque
    // historicalMatchStatus lo sugiera si no hay fila real en
    // manual_review.part_aliases (ver shapePart() en
    // lib/fieldbeat-report-detail-queries.ts - historicalAlias ya viene
    // en null en ese caso).
    if (part.ambiguousCandidateProductIds.length > 0) {
      paragraph(doc, `Candidatos (sin confirmar): ${part.ambiguousCandidateProductIds.join(", ")}`, { italic: true, color: WARNING_COLOR });
    }
    if (part.historicalAlias) {
      const reason = part.historicalAlias.reason ? ` (${part.historicalAlias.reason})` : "";
      paragraph(doc, `Alias histórico: ${part.historicalAlias.aliasValue}${reason}`, { italic: true });
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
    drawChronologySection(doc, detail);
    drawTechnicianClientSection(doc, detail);
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
