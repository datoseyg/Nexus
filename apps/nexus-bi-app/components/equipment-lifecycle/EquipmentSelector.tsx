import { SelectWithAll } from "@/components/ui/SelectWithAll";
import type { MachineListItem } from "@/types/equipment-lifecycle";

interface EquipmentSelectorProps {
  machines: MachineListItem[];
  value: string | undefined;
  onChange: (equipmentId: string | undefined) => void;
}

// Selector de máquina - incluye "Todas" (SelectWithAll, mismo patrón que
// el resto de filtros de la vista) para poder ver la tabla de repuestos
// de todas las máquinas a la vez en vez de tener que elegir una primero.
// Ordenado por cantidad de repuestos rastreados para que las máquinas con
// más historial aparezcan primero.
export function EquipmentSelector({ machines, value, onChange }: EquipmentSelectorProps) {
  return (
    <SelectWithAll
      allLabel="Todas"
      value={value}
      options={machines.map(machine => ({
        value: machine.equipment_internal_id,
        label: `${machine.equipment_internal_id} - ${machine.client_name ?? "sin cliente"} (${machine.parts_tracked} repuestos)`
      }))}
      onChange={onChange}
      title="Máquina"
    />
  );
}
