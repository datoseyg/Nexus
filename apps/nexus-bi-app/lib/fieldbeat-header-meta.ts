// Meta liviana que overview/quality reportan hacia FieldbeatQualityShell
// para la cabecera (§5) - sin un fetch dedicado solo para el header: se
// reutiliza el meta que cada pestaña YA trae en su propia respuesta.
export interface FieldbeatHeaderMeta {
  generatedAt: string;
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
  totalReports: number;
}
