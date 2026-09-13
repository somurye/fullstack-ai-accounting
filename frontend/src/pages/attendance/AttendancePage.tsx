import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Calendar,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Edit2,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  TrendingUp,
  Moon,
  Sun,
  AlertCircle,
} from 'lucide-react';
import { attendanceApi } from './api';
import { employeesApi } from '../employees/api';
import type { AttendanceRecord, AttendanceRecordCreateInput, AttendanceRecordUpdateInput } from './types';
import type { Employee } from '../employees/types';
import { AttendanceRecordModal } from './AttendanceRecordModal';

export const AttendancePage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockLoading, setClockLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentYearMonth, setCurrentYearMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // デジタル時計更新
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 従業員一覧取得
  useEffect(() => {
    employeesApi.list({ status: 'active' }).then(({ employees }) => {
      setEmployees(employees);
      if (employees.length > 0 && !selectedEmployeeId) {
        setSelectedEmployeeId(employees[0]!.id);
      }
    });
  }, []);

  // 勤怠履歴取得
  const fetchRecords = useCallback(async () => {
    if (!selectedEmployeeId) return;
    try {
      setLoading(true);
      setMessage(null);

      const [year, month] = currentYearMonth.split('-').map(Number);
      const lastDay = new Date(year!, month!, 0).getDate();
      const startDate = `${currentYearMonth}-01`;
      const endDate = `${currentYearMonth}-${String(lastDay).padStart(2, '0')}`;

      const { records } = await attendanceApi.list({
        employee_id: selectedEmployeeId,
        start_date: startDate,
        end_date: endDate,
        limit: 31,
      });
      setRecords(records);
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.response?.data?.error?.message ?? err.message ?? 'データの取得に失敗しました',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedEmployeeId, currentYearMonth]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 今日の打刻記録
  const todayStr = currentTime.toISOString().split('T')[0]!;
  const todayRecord = records.find((r) => r.work_date === todayStr);

  // 打刻アクション (出勤 / 退勤)
  const handleClock = async (type: 'clock_in' | 'clock_out') => {
    if (!selectedEmployeeId) return;
    try {
      setClockLoading(true);
      setMessage(null);
      await attendanceApi.clock({
        employee_id: selectedEmployeeId,
        type,
        timestamp: new Date().toISOString(),
      });
      setMessage({
        type: 'success',
        text: type === 'clock_in' ? '出勤を記録しました' : '退勤を記録しました（労働時間を自動計算しました）',
      });
      await fetchRecords();
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.response?.data?.error?.message ?? err.message ?? '打刻に失敗しました',
      });
    } finally {
      setClockLoading(false);
    }
  };

  // 月間サマリ計算
  const monthlySummary = records.reduce(
    (acc, r) => {
      acc.regular += r.regular_hours;
      acc.overtime += r.overtime_hours;
      acc.lateNight += r.late_night_hours;
      acc.holiday += r.holiday_hours;
      return acc;
    },
    { regular: 0, overtime: 0, lateNight: 0, holiday: 0 },
  );

  const handlePrevMonth = () => {
    const [y, m] = currentYearMonth.split('-').map(Number);
    const d = new Date(y!, m! - 2, 1);
    setCurrentYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const [y, m] = currentYearMonth.split('-').map(Number);
    const d = new Date(y!, m!, 1);
    setCurrentYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleModalSubmit = async (data: AttendanceRecordCreateInput | AttendanceRecordUpdateInput) => {
    try {
      setModalLoading(true);
      if (selectedRecord) {
        await attendanceApi.updateRecord(selectedRecord.id, data as AttendanceRecordUpdateInput);
      } else {
        await attendanceApi.createRecord(data as AttendanceRecordCreateInput);
      }
      await fetchRecords();
    } finally {
      setModalLoading(false);
    }
  };

  const formatTimeOnly = (iso: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* 画面ヘッダー */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-7 h-7 text-indigo-600" />
            勤怠管理・打刻
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            日々の打刻、労働時間区分（所定内・時間外・深夜・休日）の自動集計および月次勤怠記録
          </p>
        </div>

        {/* 従業員セレクター */}
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
          <UserCheck className="w-5 h-5 text-indigo-500" />
          <span className="text-xs font-semibold text-slate-500">対象従業員:</span>
          <select
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            className="text-sm font-medium text-slate-800 bg-transparent border-none focus:ring-0 cursor-pointer pr-4"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                [{emp.employee_no}] {emp.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm border flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {message.text}
        </div>
      )}

      {/* ワンクリック打刻パネル */}
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8">
          {/* 現在時刻表示 */}
          <div className="text-center lg:text-left space-y-1">
            <div className="text-indigo-200 text-sm font-medium flex items-center justify-center lg:justify-start gap-1.5">
              <Calendar className="w-4 h-4" />
              {currentTime.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              })}
            </div>
            <div className="text-5xl lg:text-6xl font-extrabold tracking-tight font-mono text-white drop-shadow-sm">
              {currentTime.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
            <div className="text-xs text-indigo-300">
              ※退勤時に所定内(8h)・時間外・深夜(22〜5時)・休日が自動計算されます
            </div>
          </div>

          {/* 打刻アクションボタン群 */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => handleClock('clock_in')}
              disabled={clockLoading || Boolean(todayRecord?.clock_in)}
              className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-xl font-bold shadow-lg shadow-emerald-500/25 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
            >
              <LogIn className="w-6 h-6" />
              <div className="text-left">
                <div className="text-lg leading-tight">出勤</div>
                <div className="text-[11px] font-normal text-emerald-100">
                  {todayRecord?.clock_in ? `${formatTimeOnly(todayRecord.clock_in)} 済` : '打刻する'}
                </div>
              </div>
            </button>

            <button
              onClick={() => handleClock('clock_out')}
              disabled={
                clockLoading ||
                !todayRecord?.clock_in ||
                Boolean(todayRecord?.clock_out)
              }
              className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400 text-white rounded-xl font-bold shadow-lg shadow-rose-500/25 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
            >
              <LogOut className="w-6 h-6" />
              <div className="text-left">
                <div className="text-lg leading-tight">退勤</div>
                <div className="text-[11px] font-normal text-rose-100">
                  {todayRecord?.clock_out
                    ? `${formatTimeOnly(todayRecord.clock_out)} 済`
                    : todayRecord?.clock_in
                    ? '打刻する'
                    : '未出勤'}
                </div>
              </div>
            </button>
          </div>

          {/* 本日の状況バッジ */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10 min-w-[220px]">
            <div className="text-xs text-indigo-200 font-semibold mb-2">本日の勤務状況</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-indigo-200 text-xs">出勤時刻:</span>
                <span className="font-mono font-bold">
                  {formatTimeOnly(todayRecord?.clock_in ?? null)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-indigo-200 text-xs">退勤時刻:</span>
                <span className="font-mono font-bold">
                  {formatTimeOnly(todayRecord?.clock_out ?? null)}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-white/10">
                <span className="text-indigo-200 text-xs">本日実働:</span>
                <span className="font-mono font-bold text-amber-300">
                  {todayRecord?.clock_out
                    ? `${(todayRecord.regular_hours + todayRecord.overtime_hours + todayRecord.holiday_hours).toFixed(2)}h`
                    : todayRecord?.clock_in
                    ? '勤務中'
                    : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 月間集計サマリカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>所定内労働時間</span>
            <Sun className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-800">
            {monthlySummary.regular.toFixed(2)}
            <span className="text-sm font-normal text-slate-500 ml-1">時間</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>時間外労働時間 (25%割増)</span>
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-600">
            {monthlySummary.overtime.toFixed(2)}
            <span className="text-sm font-normal text-slate-500 ml-1">時間</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>深夜労働時間 (25%割増)</span>
            <Moon className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-purple-600">
            {monthlySummary.lateNight.toFixed(2)}
            <span className="text-sm font-normal text-slate-500 ml-1">時間</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-1">
            <span>休日労働時間 (35%割増)</span>
            <Calendar className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-600">
            {monthlySummary.holiday.toFixed(2)}
            <span className="text-sm font-normal text-slate-500 ml-1">時間</span>
          </div>
        </div>
      </div>

      {/* 勤怠一覧コントロールバー */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        {/* 月度切り替え */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold font-mono text-slate-800 text-lg px-2">
            {currentYearMonth}
          </span>
          <button
            onClick={handleNextMonth}
            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedRecord(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            勤怠を手動追加
          </button>

          <button
            onClick={() => fetchRecords()}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="再読み込み"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 勤怠履歴テーブル */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-semibold text-slate-500 tracking-wider">
              <tr>
                <th className="px-6 py-3.5">勤務日</th>
                <th className="px-4 py-3.5">出勤</th>
                <th className="px-4 py-3.5">退勤</th>
                <th className="px-4 py-3.5">休憩</th>
                <th className="px-4 py-3.5">所定内(h)</th>
                <th className="px-4 py-3.5">時間外(h)</th>
                <th className="px-4 py-3.5">深夜(h)</th>
                <th className="px-4 py-3.5">休日(h)</th>
                <th className="px-6 py-3.5">備考</th>
                <th className="px-6 py-3.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-400 font-sans">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    勤怠記録を読み込み中...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-400 font-sans">
                    対象月の勤怠記録がありません
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      r.is_holiday ? 'bg-rose-50/30' : ''
                    }`}
                  >
                    <td className="px-6 py-3 font-semibold text-slate-900 font-mono">
                      {r.work_date}
                      {r.is_holiday && (
                        <span className="ml-2 px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-sans font-medium rounded">
                          法定休日
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{formatTimeOnly(r.clock_in)}</td>
                    <td className="px-4 py-3 text-slate-800">{formatTimeOnly(r.clock_out)}</td>
                    <td className="px-4 py-3 text-slate-500">{r.break_minutes}分</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {r.regular_hours.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-amber-600 font-semibold">
                      {r.overtime_hours > 0 ? r.overtime_hours.toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 text-purple-600 font-semibold">
                      {r.late_night_hours > 0 ? r.late_night_hours.toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 text-rose-600 font-semibold">
                      {r.holiday_hours > 0 ? r.holiday_hours.toFixed(2) : '-'}
                    </td>
                    <td className="px-6 py-3 font-sans text-slate-500 truncate max-w-[200px]">
                      {r.note ?? '-'}
                    </td>
                    <td className="px-6 py-3 text-right font-sans">
                      <button
                        onClick={() => {
                          setSelectedRecord(r);
                          setIsModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        修正
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 修正・手動登録モーダル */}
      <AttendanceRecordModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleModalSubmit}
        record={selectedRecord}
        employees={employees}
        loading={modalLoading}
      />
    </div>
  );
};
