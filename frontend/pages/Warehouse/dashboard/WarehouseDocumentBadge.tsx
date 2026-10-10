import { TX_TYPE_META } from './warehouseLabels';

export function WarehouseDocumentBadge({ type }: { type: string }) {
  const meta = TX_TYPE_META[type] || { label: type, badge: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded font-bold text-xs whitespace-nowrap ${meta.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
