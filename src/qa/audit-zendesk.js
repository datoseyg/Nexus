import fs from "node:fs/promises";
import path from "node:path";
import { readCsv } from "../lib/csv.js";

const BASE_DIR = "data/processed/zendesk";

const FILES = {
  tickets: "DB_Zendesk_Tickets.csv",
  tags: "DB_Zendesk_Ticket_Tags.csv",
  customFields: "DB_Zendesk_Custom_Fields.csv"
};

function countDuplicates(rows, keyName) {
  const seen = new Set();
  const duplicates = [];

  for (const row of rows) {
    const key = String(row[keyName] || "").trim();

    if (!key) continue;

    if (seen.has(key)) {
      duplicates.push(key);
    }

    seen.add(key);
  }

  return duplicates;
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

async function auditZendesk() {
  console.log("=== AUDITORÍA ZENDESK NORMALIZADO ===");

  const tickets = await readCsv(path.join(BASE_DIR, FILES.tickets));
  const tags = await readCsv(path.join(BASE_DIR, FILES.tags));
  const customFields = await readCsv(path.join(BASE_DIR, FILES.customFields));

  const ticketIds = new Set(tickets.map(t => String(t.zendesk_ticket_id || "").trim()).filter(Boolean));

  const ticketsWithTags = new Set(tags.map(t => String(t.zendesk_ticket_id || "").trim()).filter(Boolean));
  const ticketsWithoutTags = tickets.filter(t => !ticketsWithTags.has(String(t.zendesk_ticket_id || "").trim()));

  const customFieldsWithValue = customFields.filter(f => String(f.field_value || "").trim());
  const customFieldsWithoutValue = customFields.filter(f => !String(f.field_value || "").trim());

  const tagRowsOrphaned = tags.filter(t => !ticketIds.has(String(t.zendesk_ticket_id || "").trim()));
  const customFieldRowsOrphaned = customFields.filter(f => !ticketIds.has(String(f.zendesk_ticket_id || "").trim()));

  const duplicateTickets = countDuplicates(tickets, "zendesk_ticket_id");
  const duplicateTags = countDuplicates(tags, "ticket_tag_id");
  const duplicateCustomFields = countDuplicates(customFields, "ticket_custom_field_id");

  const statusBreakdown = {};
  for (const t of tickets) {
    const status = t.status || "(sin status)";
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
  }

  const report = {
    generated_at: new Date().toISOString(),
    row_counts: {
      DB_Zendesk_Tickets: tickets.length,
      DB_Zendesk_Ticket_Tags: tags.length,
      DB_Zendesk_Custom_Fields: customFields.length
    },
    coverage: {
      tickets_with_tags: ticketsWithTags.size,
      tickets_without_tags: ticketsWithoutTags.length,
      tag_coverage: percent(ticketsWithTags.size, tickets.length)
    },
    custom_fields: {
      total_custom_fields: customFields.length,
      custom_fields_with_value: customFieldsWithValue.length,
      custom_fields_without_value: customFieldsWithoutValue.length,
      value_coverage: percent(customFieldsWithValue.length, customFields.length)
    },
    referential_integrity: {
      tag_rows_orphaned: tagRowsOrphaned.length,
      custom_field_rows_orphaned: customFieldRowsOrphaned.length
    },
    duplicates: {
      duplicate_tickets: duplicateTickets.length,
      duplicate_tag_rows: duplicateTags.length,
      duplicate_custom_field_rows: duplicateCustomFields.length
    },
    status_breakdown: statusBreakdown,
    samples: {
      first_10_tickets: tickets.slice(0, 10).map(t => ({
        zendesk_ticket_id: t.zendesk_ticket_id,
        subject: t.subject,
        status: t.status,
        priority: t.priority
      })),
      first_10_tags: tags.slice(0, 10),
      first_10_custom_fields_with_value: customFieldsWithValue.slice(0, 10)
    }
  };

  await fs.mkdir("data/reports", { recursive: true });

  await fs.writeFile(
    "data/reports/zendesk_audit_report.json",
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(report, null, 2));
  console.log("Reporte guardado en data/reports/zendesk_audit_report.json");
}

auditZendesk().catch(error => {
  console.error("ERROR AUDITANDO ZENDESK:");
  console.error(error);
  process.exit(1);
});
