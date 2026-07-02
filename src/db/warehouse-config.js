export const DB_DIR = "data/warehouse";
export const DB_PATH = `${DB_DIR}/eyg_nexus.duckdb`;

// "reports" queda creado pero vacío en v1 — no hay una lista de CSV de
// data/reports/ a cargar todavía (son mayormente JSON de resumen, no
// tablas). Se documenta explícitamente en docs/SQL_WAREHOUSE.md.
export const SCHEMAS = ["processed", "marts", "gold", "reports"];

export const TABLES = [
  { schema: "processed", table: "zendesk_tickets", csv: "data/processed/zendesk/DB_Zendesk_Tickets.csv" },
  { schema: "processed", table: "fieldbeat_tasks", csv: "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv" },
  { schema: "processed", table: "fieldbeat_used_parts", csv: "data/processed/fieldbeat/DB_FieldBeat_Used_Parts.csv" },
  { schema: "processed", table: "dolibarr_products", csv: "data/processed/dolibarr/DB_Dolibarr_Products.csv" },

  { schema: "marts", table: "ticket_fieldbeat_operational_view", csv: "data/marts/Ticket_FieldBeat_Operational_View.csv" },
  { schema: "marts", table: "ticket_fieldbeat_dolibarr_operational_view", csv: "data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv" },
  { schema: "marts", table: "used_parts_dolibarr_match", csv: "data/marts/Used_Parts_Dolibarr_Match.csv" },

  { schema: "gold", table: "operational_dashboard", csv: "data/gold/GOLD_Operational_Dashboard.csv" },
  { schema: "gold", table: "data_quality_report", csv: "data/gold/GOLD_Data_Quality_Report.csv" },
  { schema: "gold", table: "client_service_profile", csv: "data/gold/GOLD_Client_Service_Profile.csv" },
  { schema: "gold", table: "equipment_service_profile", csv: "data/gold/GOLD_Equipment_Service_Profile.csv" },
  { schema: "gold", table: "used_parts_analysis", csv: "data/gold/GOLD_Used_Parts_Analysis.csv" },
  { schema: "gold", table: "scope_metadata", csv: "data/gold/GOLD_Scope_Metadata.csv" }
];
