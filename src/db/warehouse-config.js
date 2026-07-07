export const DB_DIR = "data/warehouse";
export const DB_PATH = `${DB_DIR}/eyg_nexus.duckdb`;

// "reports" queda creado pero vacío en v1 - no hay una lista de CSV de
// data/reports/ a cargar todavía (son mayormente JSON de resumen, no
// tablas). Se documenta explícitamente en docs/SQL_WAREHOUSE.md.
// "rules" - schema de la Business Rules Layer (ver business-rules/README.md).
// Sus tablas son opcionales (ver flag `optional` en TABLES más abajo): el
// schema existe siempre, pero las tablas solo se cargan si el negocio ya
// completó el archivo real (sin ".example.csv").
export const SCHEMAS = ["processed", "marts", "gold", "reports", "rules"];

export const TABLES = [
  { schema: "processed", table: "zendesk_tickets", csv: "data/processed/zendesk/DB_Zendesk_Tickets.csv" },
  { schema: "processed", table: "fieldbeat_tasks", csv: "data/processed/fieldbeat/DB_FieldBeat_Tasks.csv" },
  { schema: "processed", table: "fieldbeat_used_parts", csv: "data/processed/fieldbeat/DB_FieldBeat_Used_Parts.csv" },
  { schema: "processed", table: "dolibarr_products", csv: "data/processed/dolibarr/DB_Dolibarr_Products.csv" },

  // Añadidas en v1.1 - tablas auxiliares/dimensionales que ya existían
  // como CSV pero no estaban cargadas en el warehouse.
  { schema: "processed", table: "fieldbeat_clients", csv: "data/processed/fieldbeat/DIM_Clients.csv" },
  { schema: "processed", table: "fieldbeat_equipments", csv: "data/processed/fieldbeat/DIM_Equipments.csv" },
  { schema: "processed", table: "fieldbeat_task_equipments", csv: "data/processed/fieldbeat/DB_FieldBeat_Task_Equipments.csv" },
  { schema: "processed", table: "zendesk_ticket_tags", csv: "data/processed/zendesk/DB_Zendesk_Ticket_Tags.csv" },
  { schema: "processed", table: "zendesk_custom_fields", csv: "data/processed/zendesk/DB_Zendesk_Custom_Fields.csv" },
  { schema: "processed", table: "dolibarr_product_identity_map", csv: "data/processed/dolibarr/DIM_Dolibarr_Product_Identity_Map.csv" },

  // Cierre de Fase 1 - texto libre de los reportes FieldBeat (grupos/campos
  // crudos), para búsqueda textual profunda (ej. "cambio de tubo", "RX").
  { schema: "processed", table: "fieldbeat_report_fields", csv: "data/processed/fieldbeat/DB_FieldBeat_Report_Fields.csv" },

  { schema: "marts", table: "ticket_fieldbeat_operational_view", csv: "data/marts/Ticket_FieldBeat_Operational_View.csv" },
  { schema: "marts", table: "ticket_fieldbeat_dolibarr_operational_view", csv: "data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv" },
  { schema: "marts", table: "used_parts_dolibarr_match", csv: "data/marts/Used_Parts_Dolibarr_Match.csv" },
  { schema: "marts", table: "ticket_fieldbeat_report_detail", csv: "data/marts/Ticket_FieldBeat_Report_Detail.csv" },

  // Mart FieldBeat-first (report-centric) - 1 fila por fieldbeat_task_id,
  // complementario al mart ticket-céntrico de arriba (no lo reemplaza).
  { schema: "marts", table: "fieldbeat_report_dolibarr_operational_view", csv: "data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv" },

  // Mart "Trabajo Fuera de Horario" - 1 fila por fieldbeat_task_id con
  // clasificación business/after-hours/weekend/holiday + score de
  // confiabilidad. Alimenta la vista independiente /dashboard/after-hours,
  // ver docs/AFTER_HOURS_METRICS.md y docs/CALCULATION_CONFIDENCE_MODEL.md.
  { schema: "marts", table: "fieldbeat_working_hours_analysis", csv: "data/marts/FieldBeat_Working_Hours_Analysis.csv" },

  // Mart "Vida Útil de Repuestos por Máquina" - grano task x equipo x
  // repuesto (eventos) y equipo+repuesto x intervalo consecutivo
  // (intervalos). Inferencia preliminar, no un evento de reemplazo
  // confirmado. Alimenta la vista independiente
  // /dashboard/equipment-lifecycle, ver
  // docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md.
  { schema: "marts", table: "equipment_part_lifecycle_events", csv: "data/marts/Equipment_Part_Lifecycle_Events.csv" },
  { schema: "marts", table: "equipment_part_lifecycle_intervals", csv: "data/marts/Equipment_Part_Lifecycle_Intervals.csv" },

  { schema: "gold", table: "operational_dashboard", csv: "data/gold/GOLD_Operational_Dashboard.csv" },
  { schema: "gold", table: "data_quality_report", csv: "data/gold/GOLD_Data_Quality_Report.csv" },
  { schema: "gold", table: "client_service_profile", csv: "data/gold/GOLD_Client_Service_Profile.csv" },
  { schema: "gold", table: "equipment_service_profile", csv: "data/gold/GOLD_Equipment_Service_Profile.csv" },
  { schema: "gold", table: "used_parts_analysis", csv: "data/gold/GOLD_Used_Parts_Analysis.csv" },
  { schema: "gold", table: "scope_metadata", csv: "data/gold/GOLD_Scope_Metadata.csv" },

  // GOLD FieldBeat-first (report-centric) - complementario a las tablas
  // GOLD ticket-céntricas de arriba.
  { schema: "gold", table: "fieldbeat_report_analysis", csv: "data/gold/GOLD_FieldBeat_Report_Analysis.csv" },
  { schema: "gold", table: "client_parts_consumption", csv: "data/gold/GOLD_Client_Parts_Consumption.csv" },
  { schema: "gold", table: "client_report_volume_by_period", csv: "data/gold/GOLD_Client_Report_Volume_By_Period.csv" },
  { schema: "gold", table: "equipment_parts_consumption", csv: "data/gold/GOLD_Equipment_Parts_Consumption.csv" },
  { schema: "gold", table: "fieldbeat_data_quality", csv: "data/gold/GOLD_FieldBeat_Data_Quality.csv" },

  // GOLD "Trabajo Fuera de Horario" - complementario, ver
  // docs/AFTER_HOURS_METRICS.md y docs/CALCULATION_CONFIDENCE_MODEL.md.
  { schema: "gold", table: "after_hours_work_analysis", csv: "data/gold/GOLD_After_Hours_Work_Analysis.csv" },
  { schema: "gold", table: "after_hours_by_client", csv: "data/gold/GOLD_After_Hours_By_Client.csv" },
  { schema: "gold", table: "after_hours_by_task_type", csv: "data/gold/GOLD_After_Hours_By_Task_Type.csv" },
  { schema: "gold", table: "after_hours_by_technician", csv: "data/gold/GOLD_After_Hours_By_Technician.csv" },
  { schema: "gold", table: "after_hours_by_period", csv: "data/gold/GOLD_After_Hours_By_Period.csv" },

  // GOLD "Vida Útil de Repuestos por Máquina" - complementario, ver
  // docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md.
  { schema: "gold", table: "equipment_part_lifecycle_summary", csv: "data/gold/GOLD_Equipment_Part_Lifecycle_Summary.csv" },
  { schema: "gold", table: "equipment_part_lifecycle_by_machine", csv: "data/gold/GOLD_Equipment_Part_Lifecycle_By_Machine.csv" },
  { schema: "gold", table: "equipment_part_lifecycle_by_client", csv: "data/gold/GOLD_Equipment_Part_Lifecycle_By_Client.csv" },
  { schema: "gold", table: "equipment_part_lifecycle_by_part", csv: "data/gold/GOLD_Equipment_Part_Lifecycle_By_Part.csv" },
  { schema: "gold", table: "equipment_part_lifecycle_insights", csv: "data/gold/GOLD_Equipment_Part_Lifecycle_Insights.csv" },

  // Business Rules Layer (ver business-rules/README.md) - entidades
  // contractuales/catálogos. `optional: true` porque hoy solo existen los
  // *.example.csv (plantillas) - db:validate no debe romper el build
  // completo mientras el negocio no cargue el archivo real de cada una
  // (ver src/db/validate-duckdb.js).
  { schema: "rules", table: "client_contracts", csv: "business-rules/entities/client_contracts.csv", optional: true },
  { schema: "rules", table: "worker_contracts", csv: "business-rules/entities/worker_contracts.csv", optional: true },
  { schema: "rules", table: "equipment_contracts", csv: "business-rules/entities/equipment_contracts.csv", optional: true },
  { schema: "rules", table: "part_manufacturer_life", csv: "business-rules/entities/part_manufacturer_life.csv", optional: true },
  { schema: "rules", table: "equipment_usage_profiles", csv: "business-rules/entities/equipment_usage_profiles.csv", optional: true },
  { schema: "rules", table: "part_families", csv: "business-rules/entities/part_families.csv", optional: true }
];
