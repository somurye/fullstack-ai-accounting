import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Plus,
  Search,
  RefreshCw,
  Edit2,
  CheckCircle2,
  XCircle,
  Building2,
} from 'lucide-react';
import { employeesApi } from './api';
import type { Employee, EmployeeCreateInput, EmployeeUpdateInput } from './types';
import { EmployeeFormModal } from './EmployeeFormModal';

export const EmployeeListPage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const query: any = {};
      if (search.trim()) query.search = search.trim();
      if (statusFilter !== 'all') query.status = statusFilter;

      const { employees } = await employeesApi.list(query);
      setEmployees(employees);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? err.message ?? 'データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleOpenCreate = () => {
    setSelectedEmployee(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (emp: Employee) => {
    setSelectedEmployee(emp);
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (data: EmployeeCreateInput | EmployeeUpdateInput) => {
    try {
      setModalLoading(true);
      if (selectedEmployee) {
        await employeesApi.update(selectedEmployee.id, data as EmployeeUpdateInput);
      } else {
        await employeesApi.create(data as EmployeeCreateInput);
      }
      await fetchEmployees();
    } finally {
      setModalLoading(false);
    }
  };

  const renderEmploymentTypeBadge = (type: string) => {
    switch (type) {
      case 'full_time':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
            正社員
          </span>
        );
      case 'part_time':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
            パート・アルバイト
          </span>
        );
      case 'contract':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
            契約社員
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-700 border border-slate-200">
            派遣・臨時
          </span>
        );
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-7 h-7 text-indigo-600" />
            従業員マスタ
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            社内従業員の登録・基本情報の管理および勤怠・給与計算の基礎マスタです
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm transition-all shadow-indigo-100 hover:shadow-md"
        >
          <Plus className="w-4 h-4" />
          新規従業員を登録
        </button>
      </div>

      {/* 検索・フィルターバー */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3 w-full">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="社員番号、氏名で検索..."
              className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">状態:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">すべて</option>
              <option value="active">在籍中のみ</option>
              <option value="inactive">休職・退職のみ</option>
            </select>
          </div>
        </div>

        <button
          onClick={() => fetchEmployees()}
          disabled={loading}
          className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          title="再読み込み"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* 従業員テーブル */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-semibold text-slate-500 tracking-wider">
              <tr>
                <th className="px-6 py-3.5">社員番号</th>
                <th className="px-6 py-3.5">氏名</th>
                <th className="px-6 py-3.5">雇用区分</th>
                <th className="px-6 py-3.5">所属部門</th>
                <th className="px-6 py-3.5">入社日</th>
                <th className="px-6 py-3.5">ステータス</th>
                <th className="px-6 py-3.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    従業員データを読み込み中...
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    登録されている従業員がいません
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-slate-900">
                      {emp.employee_no}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">
                        {emp.name.slice(0, 1)}
                      </div>
                      {emp.name}
                    </td>
                    <td className="px-6 py-4">{renderEmploymentTypeBadge(emp.employment_type)}</td>
                    <td className="px-6 py-4 text-slate-500">
                      {emp.department_name ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {emp.department_name}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">未配属</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-slate-600">{emp.hire_date}</td>
                    <td className="px-6 py-4">
                      {emp.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          在籍中
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
                          <XCircle className="w-3 h-3 text-slate-400" />
                          休職・退職
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleOpenEdit(emp)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        編集
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 登録・編集モーダル */}
      <EmployeeFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleModalSubmit}
        employee={selectedEmployee}
        loading={modalLoading}
      />
    </div>
  );
};
