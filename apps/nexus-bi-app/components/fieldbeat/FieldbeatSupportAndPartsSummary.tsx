import { FieldbeatTicketLinkage } from "./FieldbeatTicketLinkage";
import { FieldbeatPartsPresence } from "./FieldbeatPartsPresence";
import type { FieldbeatPartsPresenceViewModel, FieldbeatTicketLinkageViewModel } from "@/lib/fieldbeat-metrics";

interface FieldbeatSupportAndPartsSummaryProps {
  linkage: FieldbeatTicketLinkageViewModel;
  presence: FieldbeatPartsPresenceViewModel;
}

// Las 2 tarjetas secundarias del mockup, lado a lado (se apilan en móvil).
export function FieldbeatSupportAndPartsSummary({ linkage, presence }: FieldbeatSupportAndPartsSummaryProps) {
  return (
    <div className="flex flex-wrap gap-3.5">
      <div className="min-w-[320px] flex-1">
        <FieldbeatTicketLinkage linkage={linkage} />
      </div>
      <div className="min-w-[320px] flex-1">
        <FieldbeatPartsPresence presence={presence} />
      </div>
    </div>
  );
}
