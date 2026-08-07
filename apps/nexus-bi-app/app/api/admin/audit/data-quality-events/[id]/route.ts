import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Gate B (Familia 9/B19) - retirado: ver el mismo razonamiento en
// ../route.ts (POST) - audit.data_quality_events no puede seguir siendo
// mutable/eliminable (B21.3); el historial gobernado y append-only vive en
// governance.command_events. Confirmado sin consumidores reales.
function retired() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - el historial de eventos gobernado vive en governance.command_events (append-only, sin escritura CRUD posible desde ninguna ruta).",
      code: "ENDPOINT_RETIRED"
    },
    { status: 410 }
  );
}

export async function PATCH() {
  return retired();
}

export async function DELETE() {
  return retired();
}
