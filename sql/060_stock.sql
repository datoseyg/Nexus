-- Schema stock: tabla nueva, forward-looking — no es una migración de datos
-- existentes. PHASE_2_BACKLOG.md ítem 4 documenta que el pipeline actual
-- NO descuenta inventario en Dolibarr; esta tabla es el punto de partida
-- transaccional para cuando esa automatización se decida construir.

CREATE TABLE IF NOT EXISTS stock.stock_movements (
  id bigserial PRIMARY KEY,
  dolibarr_product_id bigint NOT NULL,
  dolibarr_ref text,
  movement_type text NOT NULL CHECK (movement_type IN ('OUT','IN','ADJUSTMENT')),
  quantity numeric NOT NULL,
  source_used_part_id text,
  source_fieldbeat_task_id bigint,
  warehouse_location text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','REVERSED')),
  confirmed_by text,
  confirmed_at timestamptz,
  reversed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
