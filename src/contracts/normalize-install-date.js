const MONTH_ABBREVIATIONS = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, sept: 9, oct: 10, nov: 11, dic: 12
};

// "ago-2015" / "feb-2021" / "nov-24" / "sept-2021" -mes abreviado (3 o 4
// letras, el archivo real usa ambas formas) + año de 2 o 4 dígitos.
const MONTH_YEAR_PATTERN = /^([a-zé]{3,4})-(\d{2}|\d{4})$/i;
// Año aislado, ej. "2009".
const BARE_YEAR_PATTERN = /^\d{4}$/;

function expandTwoDigitYear(yy) {
  // Todos los valores reales observados en el archivo (24, 21, 23...) son
  // instalaciones recientes -se asume siglo 2000, sin ambigüedad práctica
  // para este dataset.
  return 2000 + yy;
}

/**
 * Año Instalación -> {installationMonth, installationDatePrecision, issues}.
 * Nunca inventa un mes: "2009" sin mes se guarda como 1 de enero con
 * precision=YEAR, no como si fuera realmente enero.
 * @param {string} raw
 * @returns {{ installationMonth: string | null, installationDatePrecision: 'MONTH'|'YEAR'|'UNKNOWN', issues: Array<{issueType: string, details: object}> }}
 */
export function parseInstallationDate(raw) {
  const value = String(raw ?? "").trim();

  if (value === "") {
    return {
      installationMonth: null,
      installationDatePrecision: "UNKNOWN",
      issues: [{ issueType: "INVALID_INSTALLATION_DATE", details: { raw: value, reason: "vacío" } }]
    };
  }

  const monthYearMatch = value.match(MONTH_YEAR_PATTERN);
  if (monthYearMatch) {
    const [, monthAbbrRaw, yearRaw] = monthYearMatch;
    const monthAbbr = monthAbbrRaw.toLowerCase();
    const month = MONTH_ABBREVIATIONS[monthAbbr];

    if (month) {
      const year = yearRaw.length === 2 ? expandTwoDigitYear(Number(yearRaw)) : Number(yearRaw);
      const iso = `${year}-${String(month).padStart(2, "0")}-01`;
      return { installationMonth: iso, installationDatePrecision: "MONTH", issues: [] };
    }
  }

  if (BARE_YEAR_PATTERN.test(value)) {
    const year = Number(value);
    return { installationMonth: `${year}-01-01`, installationDatePrecision: "YEAR", issues: [] };
  }

  return {
    installationMonth: null,
    installationDatePrecision: "UNKNOWN",
    issues: [{ issueType: "INVALID_INSTALLATION_DATE", details: { raw: value, reason: "formato no reconocido" } }]
  };
}
