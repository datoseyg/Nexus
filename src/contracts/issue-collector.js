/**
 * Acumulador simple de issues para un registro candidato. Cada módulo de
 * normalización devuelve su propio array `issues` con `{issueType,
 * details}`; record-builder.js los junta todos acá.
 * @returns {{ addAll: (issues: Array<{issueType: string, details: object}>) => void, list: () => Array<{issueType: string, details: object}>, requiresReview: () => boolean }}
 */
export function createIssueCollector() {
  /** @type {Array<{issueType: string, details: object}>} */
  const issues = [];

  return {
    addAll(newIssues) {
      if (newIssues && newIssues.length) issues.push(...newIssues);
    },
    list() {
      return issues.slice();
    },
    requiresReview() {
      return issues.length > 0;
    }
  };
}
