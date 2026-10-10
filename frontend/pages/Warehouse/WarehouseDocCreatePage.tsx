import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { WarehouseTransactionForm } from './WarehouseTransactionForm';

interface Props {
  presetType: 'IN' | 'OUT';
  title: string;
  subtitle: string;
  successTo: string;
  toLocationLabel?: string;
}

// Dedicated create pages: /warehouse/inbound/new (IN), /warehouse/outbound/new (OUT).
export default function WarehouseDocCreatePage({ presetType, title, subtitle, successTo, toLocationLabel }: Props) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link to={successTo} className="inline-flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-700 mb-2">
          <ArrowLeft size={15} /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">{title}</h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">{subtitle}</p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      <WarehouseTransactionForm
        presetType={presetType}
        title={title}
        submitLabel="Tạo phiếu"
        toLocationLabel={toLocationLabel}
        onCreated={() => navigate(successTo)}
        onError={setError}
      />
    </div>
  );
}
