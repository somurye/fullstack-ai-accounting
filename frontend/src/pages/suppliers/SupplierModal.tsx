import React, { useState, useEffect } from 'react';
import { X, Building2, User, Mail, Phone, CreditCard, Loader2 } from 'lucide-react';
import type { SupplierDto, SupplierFormValues } from './types';

interface SupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: SupplierFormValues) => Promise<void>;
  supplier?: SupplierDto | null;
}

export const SupplierModal: React.FC<SupplierModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  supplier,
}) => {
  const [values, setValues] = useState<SupplierFormValues>({
    name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    payment_terms: '月末締め翌月末払い',
    status: 'active',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (supplier) {
      setValues({
        name: supplier.name,
        contact_name: supplier.contact_name ?? '',
        contact_email: supplier.contact_email ?? '',
        contact_phone: supplier.contact_phone ?? '',
        payment_terms: supplier.payment_terms ?? '月末締め翌月末払い',
        status: supplier.status,
      });
    } else {
      setValues({
        name: '',
        contact_name: '',
        contact_email: '',
        contact_phone: '',
        payment_terms: '月末締め翌月末払い',
        status: 'active',
      });
    }
    setError(null);
  }, [supplier, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) {
      setError('サプライヤー名を入力してください');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(values);
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('保存に失敗しました');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-gray-900">
              {supplier ? 'サプライヤー情報の編集' : 'サプライヤー新規登録'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* サプライヤー名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                サプライヤー名 <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="例: 株式会社テックサプライ"
                  value={values.name}
                  onChange={(e) => setValues({ ...values, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* 担当者名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                担当者名
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <User className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="例: 山田 太郎"
                  value={values.contact_name}
                  onChange={(e) => setValues({ ...values, contact_name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* 連絡先 (メール & 電話) */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  メールアドレス
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Mail className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="email"
                    placeholder="info@example.com"
                    value={values.contact_email}
                    onChange={(e) => setValues({ ...values, contact_email: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  電話番号
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Phone className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="tel"
                    placeholder="03-1234-5678"
                    value={values.contact_phone}
                    onChange={(e) => setValues({ ...values, contact_phone: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* 支払条件 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                支払条件
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <CreditCard className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="例: 月末締め翌月末払い"
                  value={values.payment_terms}
                  onChange={(e) => setValues({ ...values, payment_terms: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* ステータス */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ステータス
              </label>
              <select
                value={values.status}
                onChange={(e) => setValues({ ...values, status: e.target.value as 'active' | 'inactive' })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="active">有効 (active)</option>
                <option value="inactive">無効 (inactive)</option>
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {supplier ? '更新する' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
