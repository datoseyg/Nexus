// Encapsula el badge "EyG" que hoy vive inline en NavBar.tsx:35-40, como
// punto único de reemplazo cuando exista un archivo de logo real. Todavía
// no se importa desde ningún lado - lo conectará la Etapa 2 (App
// Shell/sidebar) en vez de tocar NavBar.tsx en esta pasada.
//
// Representa temporalmente la marca heredada (el badge CSS ya existente en
// el código, no un isotipo nuevo). No debe documentarse ni presentarse como
// "logo oficial de EyG" mientras la decisión D10
// (docs/design-context/11-product-decision-register.md) siga OPEN - ver
// docs/design-context/07-brand-system.md para el detalle de por qué no
// existe un logo oficial verificado en este repositorio.
export function Brand() {
  return (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
      style={{ background: "linear-gradient(135deg, var(--eyg-green-dark), var(--eyg-teal))" }}
    >
      EyG
    </span>
  );
}
