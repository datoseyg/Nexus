import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Gate B (Familia 9/B19) - retirado: ver el mismo razonamiento en
// ../route.ts (POST). audit.pipeline_runs sigue viva y en uso real por
// src/working-hours/build-working-hours.js (escritura directa vía SQL,
// nunca por esta ruta HTTP) - retirar PATCH/DELETE acá evita además que un
// token admin legado pueda alterar/borrar corridas reales de ese pipeline
// por accidente.
function retired() {
  return NextResponse.json(
    {
      error: "Este endpoint ya no acepta escrituras - sin consumidor real; audit.pipeline_runs sigue escrita directamente por el pipeline de horas trabajadas vía SQL, no por esta ruta.",
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
