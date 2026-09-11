import { useEffect, useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  Mail,
  Phone,
  CreditCard,
  User,
  Edit2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';
import type { SupplierDto, SupplierFormValues } from './types';
import { SupplierModal } from './SupplierModal';

type SupplierListResponse = components['schemas']['SupplierListResponse'];

export function SupplierListPage() {
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // モーダル管理
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierDto | null>(null);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: 20 };
      if (search) params.search = search;
      if (selectedStatus) params.status = selectedStatus;

      const res = await apiClient.get<SupplierListResponse>('/suppliers', { params });
      setSuppliers(res.data.data);
      if (res.data.meta?.pagination) {
        setTotalPages(res.data.meta.pagination.total_pages || 1);
        setTotalCount(res.data.meta.pagination.total_count || 0);
      }
    } catch {
      toast.error('サプライヤー一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, [page, selectedStatus]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchSuppliers();
  };

  const handleOpenCreateModal = () => {
    setEditingSupplier(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (supplier: SupplierDto) => {
    setEditingSupplier(supplier);
    setIsModalOpen(true);
  };

  const handleSaveSupplier = async (values: SupplierFormValues) => {
    try {
      if (editingSupplier) {
        await apiClient.put(`/suppliers/${editingSupplier.id}`, values);
        toast.success(`サプライヤー「${values.name}」の情報を更新しました`);
      } else {
        await apiClient.post('/suppliers', values);
        toast.success(`サプライヤー「${values.name}」を新規登録しました`);
      }
      fetchSuppliers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存に失敗しました';
      toast.error(msg);
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 shadow-sm ring-1 ring-indigo-500/10">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                サプライヤー（取引先）マスタ
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                購買・発注先となる取引先情報を一元管理します（全 {totalCount} 件）
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <Plus className="h-4 w-4" />
          新規サプライヤー登録
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        {/* Status Tabs */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {[
            { label: 'すべて', value: '' },
            { label: '有効のみ', value: 'active' },
            { label: '無効', value: 'inactive' },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setSelectedStatus(tab.value);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                selectedStatus === tab.value
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="サプライヤー名・担当者・メールで検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 py-1.5 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200"
          >
            検索
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(1);
                fetchSuppliers();
              }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            >
              クリア
            </button>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
          </div>
        ) : suppliers.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <Building2 className="h-12 w-12 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-900">
              サプライヤーが見つかりません
            </p>
            <p className="mt-1 text-xs text-gray-500">
              検索条件を変更するか、右上のボタンから新規サプライヤーを登録してください。
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50/75">
              <tr>
                <th className="px-6 py-3.5 font-semibold text-gray-900">サプライヤー名</th>
                <th className="px-6 py-3.5 font-semibold text-gray-900">担当者 / 連絡先</th>
                <th className="px-6 py-3.5 font-semibold text-gray-900">支払条件</th>
                <th className="px-6 py-3.5 font-semibold text-gray-900">ステータス</th>
                <th className="px-6 py-3.5 font-semibold text-gray-900">登録日</th>
                <th className="px-6 py-3.5 text-right font-semibold text-gray-900">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {suppliers.map((sup) => (
                <tr key={sup.id} className="hover:bg-gray-50/80 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-indigo-500 shrink-0" />
                      <span>{sup.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    <div className="space-y-1">
                      {sup.contact_name && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <User className="h-3.5 w-3.5 text-gray-400" />
                          <span>{sup.contact_name}</span>
                        </div>
                      )}
                      {sup.contact_email && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Mail className="h-3.5 w-3.5 text-gray-400" />
                          <span>{sup.contact_email}</span>
                        </div>
                      )}
                      {sup.contact_phone && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Phone className="h-3.5 w-3.5 text-gray-400" />
                          <span>{sup.contact_phone}</span>
                        </div>
                      )}
                      {!sup.contact_name && !sup.contact_email && !sup.contact_phone && (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {sup.payment_terms ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <CreditCard className="h-3.5 w-3.5 text-gray-400" />
                        <span>{sup.payment_terms}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {sup.status === 'active' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                        <CheckCircle2 className="h-3 w-3" />
                        有効
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        <XCircle className="h-3 w-3" />
                        無効
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-500">
                    {new Date(sup.created_at).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleOpenEditModal(sup)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      編集
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-3">
            <div className="text-xs text-gray-500">
              ページ {page} / {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                前へ
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                次へ
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 新規登録・編集モーダル */}
      <SupplierModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSaveSupplier}
        supplier={editingSupplier}
      />
    </div>
  );
}
