// Extracción ACOTADA de fecha de garantía dentro de "Notas" -solo 2 patrones
// demostrables ("termina en <Mes>/<Año>", "hasta DD/MM/AA(AA)"). Cualquier
// otro contenido de Notas (incluida una nota de "Equipo Desinstalado en...")
// se ignora para este propósito -no se inventa una fecha de ningún otro
// patrón. Las líneas que parecen firma personal (empiezan con "-" y no
// contienen dígitos) se excluyen del texto analizado ANTES de correr los
// regex, para nunca tratar el nombre de una persona como dato analítico.

const SPANISH_MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

const TERMINA_EN_PATTERN = /termina en ([a-zé]+)\/(\d{4})/i;
const HASTA_DATE_PATTERN = /hasta\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;

function stripSignatureLines(rawNotes) {
  return String(rawNotes ?? "")
    .split("\n")
    .filter(line => {
      const trimmed = line.trim();
      // Línea de firma típica de este dataset: empieza con "-" y no
      // contiene ningún dígito (una fecha real siempre tiene dígitos).
      return !(trimmed.startsWith("-") && !/\d/.test(trimmed));
    })
    .join("\n");
}

function expandTwoDigitYear(yy) {
  return yy < 100 ? 2000 + yy : yy;
}

function toIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * @param {string | null} rawNotes
 * @param {string} effectiveDate ISO YYYY-MM-DD de la corrida actual
 * @returns {{ warrantyEndDate: string | null, warrantyEndDateSource: 'NOTES_PATTERN_MATCH' | 'NONE', issues: Array<{issueType: string, details: object}> }}
 */
export function parseNotes(rawNotes, effectiveDate) {
  const cleaned = stripSignatureLines(rawNotes);

  let warrantyEndDate = null;

  const monthYearMatch = cleaned.match(TERMINA_EN_PATTERN);
  if (monthYearMatch) {
    const monthName = monthYearMatch[1].toLowerCase();
    const year = Number(monthYearMatch[2]);
    const month = SPANISH_MONTHS[monthName];
    if (month) {
      warrantyEndDate = toIsoDate(year, month, 1);
    }
  }

  if (!warrantyEndDate) {
    const dateMatch = cleaned.match(HASTA_DATE_PATTERN);
    if (dateMatch) {
      const day = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const year = expandTwoDigitYear(Number(dateMatch[3]));
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        warrantyEndDate = toIsoDate(year, month, day);
      }
    }
  }

  if (!warrantyEndDate) {
    return { warrantyEndDate: null, warrantyEndDateSource: "NONE", issues: [] };
  }

  const issues = [];
  if (warrantyEndDate < effectiveDate) {
    issues.push({ issueType: "WARRANTY_END_DATE_PASSED", details: { warrantyEndDate, effectiveDate } });
  }

  return { warrantyEndDate, warrantyEndDateSource: "NOTES_PATTERN_MATCH", issues };
}
