import React, { useState, useEffect } from 'react';
import { X, Save, Clock, Calendar, Coffee, FileText } from 'lucide-react';
import type {
  AttendanceRecord,
  AttendanceRecordCreateInput,
  AttendanceRecordUpdateInput,
} from './types';
import type { Employee } from '../employees/types';

interface AttendanceRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AttendanceRecordCreateInput | AttendanceRecordUpdateInput) => Promise<void>;
  record?: AttendanceRecord | null;
  employees: Employee[];
  loading?: boolean;
}

export const AttendanceRecordModal: React.FC<AttendanceRecordModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  record,
  employees,
  loading = false,
}) => {
  const [employeeId, setEmployeeId] = useState('');
  const [workDate, setWorkDate] = useState('');
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [breakMinutes, setBreakMinutes] = useState(60);
  const [isHoliday, setIsHoliday] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'draft' | 'submitted' | 'approved'>('draft');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      setEmployeeId(record.employee_id);
      setWorkDate(record.work_date);
      setClockInTime(record.clock_in ? record.clock_in.substring(11, 16) : '');
      setClockOutTime(record.clock_out ? record.clock_out.substring(11, 16) : '');
      setBreakMinutes(record.break_minutes);
      setIsHoliday(record.is_holiday);
      setNote(record.note ?? '');
      setStatus(record.status);
    } else {
      setEmployeeId(employees[0]?.id ?? '');
      setWorkDate(new Date().toISOString().split('T')[0]!);
      setClockInTime('09:00');
      setClockOutTime('18:00');
      setBreakMinutes(60);
      setIsHoliday(false);
      setNote('');
      setStatus('draft');
    }
    setError(null);
  }, [record, isOpen, employees]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record && !employeeId) {
      setError('従業員を選択してください');
      return;
    }
    if (!workDate) {
      setError('勤務日を指定してください');
      return;
    }

    try {
      // 日付と時刻からISO文字列を作成
      const clockInIso = clockInTime
        ? new Date(`${workDate}T${clockInTime}:00`).toISOString()
        : null;
      const clockOutIso = clockOutTime
        ? new Date(`${workDate}T${clockOutTime}:00`).toISOString()
        : null;

      if (record) {
        await onSubmit({
          clock_in: clockInIso,
          clock_out: clockOutIso,
          break_minutes: Number(breakMinutes),
          is_holiday: isHoliday,
          note: note.trim() ? note.trim() : null,
          status,
        });
      } else {
        await onSubmit({
          employee_id: employeeId,
          work_date: workDate,
          clock_in: clockInIso,
          clock_out: clockOutIso,
          break_minutes: Number(breakMinutes),
          is_holiday: isHoliday,
          note: note.trim() ? note.trim() : null,
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
            <Clock className="w-5 h-5 text-indigo-600" />
            {record ? '勤怠記録の修正' : '勤怠記録の手動登録'}
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

          {!record ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                対象従業員
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white"
                required
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    [{emp.employee_no}] {emp.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
              <span className="text-xs text-slate-400 font-semibold block">対象従業員</span>
              <span className="font-medium text-slate-800">
                [{record.employee_no}] {record.employee_name}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              勤務日
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                disabled={Boolean(record)}
                className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm ${
                  record
                    ? 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed'
                    : 'border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                }`}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                出勤時刻
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="time"
                  value={clockInTime}
                  onChange={(e) => setClockInTime(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                退勤時刻
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="time"
                  value={clockOutTime}
                  onChange={(e) => setClockOutTime(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                休憩時間 (分)
              </label>
              <div className="relative">
                <Coffee className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  min="0"
                  step="15"
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 p-2.5 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={isHoliday}
                  onChange={(e) => setIsHoliday(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-slate-700">法定休日として扱う</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              備考 / 申請理由
            </label>
            <div className="relative">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="直行直帰、打刻漏れ修正理由など..."
                rows={2}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
