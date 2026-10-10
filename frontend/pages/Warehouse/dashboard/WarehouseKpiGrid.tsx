import { StatCard } from '../../../components/StatCard';

export interface WarehouseKpiItem {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
  alert?: boolean;
}

export function WarehouseKpiGrid({ items }: { items: WarehouseKpiItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4">
      {items.map((item, idx) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value}
          icon={item.icon}
          color={item.color}
          subtitle={item.subtitle}
          alert={item.alert}
          delay={idx * 80}
        />
      ))}
    </div>
  );
}
