import React, { useState, useEffect } from 'react';
import { X, Save, User, Calendar, Briefcase, Hash } from 'lucide-react';
import type { Employee, EmployeeCreateInput, EmployeeUpdateInput } from './types';

interface EmployeeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: EmployeeCreateInput | EmployeeUpdateInput) => Promise<void>;
  employee?: Employee | null;
  loading?: boolean;
}

export const EmployeeFormModal: React.FC<EmployeeFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  employee,
  loading = false,
}) => {
  const [employeeNo, setEmployeeNo] = useState('');
  const [name, setName] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [employmentType, setEmploymentType] = useState<
    'full_time' | 'part_time' | 'contract' | 'temporary'
  >('full_time');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (employee) {
      setEmployeeNo(employee.employee_no);
      setName(employee.name);
      setHireDate(employee.hire_date);
      setEmploymentType(employee.employment_type);
      setStatus(employee.status);
    } else {
      setEmployeeNo('');
      setName('');
      setHireDate(new Date().toISOString().split('T')[0]!);
      setEmploymentType('full_time');
      setStatus('active');
    }
    setError(null);
  }, [employee, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('氏名を入力してください');
      return;
    }
    if (!employee && !employeeNo.trim()) {
      setError('社員番号を入力してください');
      return;
    }

    try {
      if (employee) {
        await onSubmit({
          name: name.trim(),
          hire_date: hireDate,
          employment_type: employmentType,
          status,
        });
      } else {
        await onSubmit({
          employee_no: employeeNo.trim(),
          name: name.trim(),
          hire_date: hireDate,
          employment_type: employmentType,
          status,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? err.message ?? '保存に失敗しました');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-semibold text-slate-800 text-lg flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-600" />
            {employee ? '従業員情報の編集' : '新規従業員の登録'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 text-rose-600 rounded-lg text-sm border border-rose-100">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              社員番号
            </label>
            <div className="relative">
              <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={employeeNo}
                onChange={(e) => setEmployeeNo(e.target.value)}
                disabled={Boolean(employee)}
                placeholder="例: EMP001"
                className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm transition-colors ${
                  employee
                    ? 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed'
                    : 'border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                }`}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              氏名
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 山田 太郎"
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                雇用区分
              </label>
              <div className="relative">
                <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value as any)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white"
                >
                  <option value="full_time">正社員</option>
                  <option value="part_time">パート・アルバイト</option>
                  <option value="contract">契約社員</option>
                  <option value="temporary">派遣・臨時</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                ステータス
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white"
              >
                <option value="active">在籍中 (active)</option>
                <option value="inactive">休職・退職 (inactive)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              入社日
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="date"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
