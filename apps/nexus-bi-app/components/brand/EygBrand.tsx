import Image from "next/image";

export type EygBrandVariant = "full" | "mark";

interface EygBrandProps {
  /** "full" = logotipo horizontal completo (icono + "E&G Medical Systems").
   *  "mark" = solo el símbolo compacto, para espacios reducidos/sidebar contraído. */
  variant: EygBrandVariant;
  className?: string;
  priority?: boolean;
  sizes?: string;
}

// Fuente única de marca visual real (public/brand/eyg-logo.webp,
// public/brand/eyg-mark.webp - provistos directamente, resuelve para estos
// 2 assets la decisión D10 "OPEN" de docs/design-context/
// 11-product-decision-register.md: no existía antes un logo oficial
// verificado en el repo). Reemplaza components/ui/Brand.tsx (badge "EyG"
// heredado) en Sidebar/MobileSidebar/MobileTopBar/Inicio - Brand.tsx se
// deja intacto porque login/page.tsx todavía lo usa y esa pantalla está
// fuera de alcance de este encargo.
//
// width/height son las dimensiones INTRÍNSECAS reales de cada archivo
// (366x232 / 187x210, confirmadas leyendo el binario) - width:auto +
// height:100% (o al revés, según el className del consumidor) es el
// patrón documentado de next/image para escalar de forma responsive sin
// layout shift, dejando que el propio <Image> calcule el aspect-ratio.
const VARIANTS: Record<EygBrandVariant, { src: string; width: number; height: number }> = {
  full: { src: "/brand/eyg-logo.webp", width: 366, height: 232 },
  mark: { src: "/brand/eyg-mark.webp", width: 187, height: 210 }
};

export function EygBrand({ variant, className, priority = false, sizes }: EygBrandProps) {
  const { src, width, height } = VARIANTS[variant];

  return (
    <Image
      src={src}
      alt="E&G Medical Systems"
      width={width}
      height={height}
      priority={priority}
      sizes={sizes}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
