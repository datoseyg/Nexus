import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Gate B (B19) - retirado: la reversión gobernada de un alias vive ahora en
// governance.fn_reverse_correction (sql/092), vía la sesión + capacidad
// correction:reverse - nunca este endpoint legacy de token compartido.
// Confirmado sin consumidores reales (Gate A). Escritura deshabilitada en
// el mismo cambio que activó la función nueva.
function retired() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - la reversión de una corrección de alias usa el comando gobernado (correction:reverse).",
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
