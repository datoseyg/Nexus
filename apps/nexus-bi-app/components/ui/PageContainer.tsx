interface PageContainerProps {
  children: React.ReactNode;
  wide?: boolean;
}

// Contenedor de ancho por página, centrado sobre el fondo E&G
// (--page-plane). `wide` amplía el ancho máximo para pantallas con
// grillas de 12 columnas (Dashboard, Auditoría) - el resto de las
// pantallas (Explorer, Search, landing) usa el ancho angosto original.
// Antes (Etapa 1) también renderizaba NavBar dentro de un <main> propio;
// desde la Etapa 2 la navegación y el único <main> de la app viven en
// components/layout/AppShell.tsx (montado una vez en app/layout.tsx), así
// que este componente pasó a ser solo el contenedor de ancho - de ahí el
// renombre de AppShell a PageContainer.
export function PageContainer({ children, wide = false }: PageContainerProps) {
  return <div className={`mx-auto ${wide ? "max-w-[1400px]" : "max-w-6xl"} px-4 py-6`}>{children}</div>;
}
