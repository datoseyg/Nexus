import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Gate B (B19) - retirado: la reversión gobernada de un vínculo de ticket
// vive ahora en governance.fn_reverse_correction (sql/092, DELETE real sobre
// manual_review.ticket_link_overrides - misma semántica "revertir a no
// resuelto" que este endpoint ya tenía), vía sesión + capacidad
// correction:reverse. Confirmado sin consumidores reales (Gate A) y con el
// reemplazo probado de punta a punta antes de este retiro.
function retired() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - la reversión de un vínculo de ticket usa el comando gobernado (correction:reverse).",
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
