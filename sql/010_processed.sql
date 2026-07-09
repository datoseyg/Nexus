-- AUTOGENERADO por src/db/generate-postgres-ddl.js — NO EDITAR A MANO.
-- Fuente: information_schema.columns de data/warehouse/eyg_nexus.duckdb (introspección en vivo).
-- Para regenerar: npm run db:pg:ddl
-- Ver docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md para las tablas sin script generador propio.

CREATE TABLE IF NOT EXISTS processed."dolibarr_product_identity_map" (
  "identity_id" TEXT,
  "dolibarr_product_id" BIGINT,
  "identity_type" TEXT,
  "identity_value" TEXT,
  "identity_value_normalized" TEXT,
  "dolibarr_ref" TEXT,
  "dolibarr_barcode" BIGINT,
  "dolibarr_label" TEXT,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."dolibarr_products" (
  "dolibarr_product_id" BIGINT,
  "ref" TEXT,
  "barcode" BIGINT,
  "label" TEXT,
  "status" BIGINT,
  "status_buy" BIGINT,
  "price" DOUBLE PRECISION,
  "cost_price" DOUBLE PRECISION,
  "date_creation" TIMESTAMP,
  "date_modification" TIMESTAMP,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."fieldbeat_clients" (
  "client_key" TEXT,
  "client_name" TEXT,
  "rut" TEXT,
  "fieldbeat_client_name" TEXT,
  "address_raw" TEXT,
  "city" TEXT,
  "commune" TEXT,
  "country" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "updated_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."fieldbeat_equipments" (
  "equipment_key" TEXT,
  "equipment_uuid" TEXT,
  "internal_id" TEXT,
  "client_key" TEXT,
  "equipment_type" TEXT,
  "source_system" TEXT,
  "updated_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."fieldbeat_report_fields" (
  "report_field_id" TEXT,
  "fieldbeat_task_id" BIGINT,
  "group_name" TEXT,
  "group_index" BIGINT,
  "group_copy_of" TEXT,
  "is_group_copy" BOOLEAN,
  "field_name" TEXT,
  "field_index" BIGINT,
  "field_type" TEXT,
  "field_value" TEXT,
  "mandatory" BOOLEAN,
  "possible_values" TEXT,
  "etag" TEXT,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."fieldbeat_task_equipments" (
  "task_equipment_id" TEXT,
  "fieldbeat_task_id" BIGINT,
  "equipment_uuid" TEXT,
  "equipment_internal_id" TEXT,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."fieldbeat_tasks" (
  "fieldbeat_task_id" BIGINT,
  "linked_zendesk_ticket_id" TEXT,
  "task_type" TEXT,
  "priority" BIGINT,
  "state" TEXT,
  "description" TEXT,
  "client_key" TEXT,
  "assigned_to" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ,
  "start_time" TIMESTAMPTZ,
  "duration_minutes" BIGINT,
  "last_transition_at" TIMESTAMPTZ,
  "finished_data_synced_at" TIMESTAMP,
  "created_in" TEXT,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."fieldbeat_used_parts" (
  "used_part_id" TEXT,
  "fieldbeat_task_id" BIGINT,
  "zendesk_ticket_id" TEXT,
  "part_number" TEXT,
  "part_name" TEXT,
  "quantity" BIGINT,
  "raw_original_part_number" TEXT,
  "raw_original_part_name" TEXT,
  "origin_location" TEXT,
  "photo_ref" TEXT,
  "dolibarr_product_id" TEXT,
  "dolibarr_ref" TEXT,
  "unit_cost" TEXT,
  "estimated_total_cost" TEXT,
  "needs_manual_review" BOOLEAN,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."zendesk_custom_fields" (
  "ticket_custom_field_id" TEXT,
  "zendesk_ticket_id" BIGINT,
  "field_id" BIGINT,
  "field_value" TEXT,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."zendesk_ticket_tags" (
  "ticket_tag_id" TEXT,
  "zendesk_ticket_id" BIGINT,
  "tag" TEXT,
  "extracted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed."zendesk_tickets" (
  "zendesk_ticket_id" BIGINT,
  "external_id" TEXT,
  "type" TEXT,
  "subject" TEXT,
  "raw_subject" TEXT,
  "description" TEXT,
  "priority" TEXT,
  "status" TEXT,
  "via_channel" TEXT,
  "requester_id" BIGINT,
  "submitter_id" BIGINT,
  "assignee_id" BIGINT,
  "organization_id" BIGINT,
  "group_id" BIGINT,
  "is_public" BOOLEAN,
  "has_incidents" BOOLEAN,
  "due_at" TEXT,
  "satisfaction_rating" TEXT,
  "ticket_form_id" BIGINT,
  "brand_id" BIGINT,
  "created_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ,
  "extracted_at" TIMESTAMPTZ
);
