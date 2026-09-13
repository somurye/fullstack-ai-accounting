import { LABOR_STANDARDS } from '../constants/labor-standards.constants';

export interface WorkHoursCalculationInput {
  clockIn: Date | string | null | undefined;
  clockOut: Date | string | null | undefined;
  breakMinutes?: number | null;
  isHoliday?: boolean | null;
}

export interface WorkHoursCalculationResult {
  regularHours: number;
  overtimeHours: number;
  lateNightHours: number;
  holidayHours: number;
  totalActualHours: number;
  totalActualMinutes: number;
}

/**
 * 小数点第2位に四捨五入するヘルパー
 */
function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * 深夜時間帯 (22:00〜翌朝05:00) の労働分数を計算
 * 1分刻みの正確な判定により、日付跨ぎ・境界値（22:00ジャスト、05:00ジャスト）の誤差を完全排除
 */
function calculateLateNightMinutes(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) {
    return 0;
  }

  let lateNightMinutes = 0;
  let current = start.getTime();
  const endTime = end.getTime();

  // 1分ごとに該当分（スロット）の開始時刻の hour を判定
  while (current < endTime) {
    const d = new Date(current);
    const hour = d.getHours();
    if (
      hour >= LABOR_STANDARDS.LATE_NIGHT_START_HOUR ||
      hour < LABOR_STANDARDS.LATE_NIGHT_END_HOUR
    ) {
      lateNightMinutes++;
    }
    current += 60 * 1000;
  }

  return lateNightMinutes;
}

/**
 * 労働時間区分（所定内・時間外・深夜・休日）の計算
 *
 * 境界値仕様:
 * - 実労働時間がちょうど8時間00分(480分): regular=8.00, overtime=0.00
 * - 実労働時間が8時間30分(510分): regular=8.00, overtime=0.50
 * - 22:00ちょうど退勤: lateNight=0.00 (22:00を超えた時点から深夜加算)
 * - 23:00退勤: 22:00〜23:00の1時間が深夜加算
 * - 翌朝05:00ちょうど退勤: 05:00までが深夜加算
 * - 法定休日(isHoliday=true): 通常時間外は発生せず、全てholidayHoursに計上（深夜は重複加算）
 */
export function calculateWorkingHours(
  input: WorkHoursCalculationInput,
): WorkHoursCalculationResult {
  if (!input.clockIn || !input.clockOut) {
    return {
      regularHours: 0,
      overtimeHours: 0,
      lateNightHours: 0,
      holidayHours: 0,
      totalActualHours: 0,
      totalActualMinutes: 0,
    };
  }

  const start = new Date(input.clockIn);
  const end = new Date(input.clockOut);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return {
      regularHours: 0,
      overtimeHours: 0,
      lateNightHours: 0,
      holidayHours: 0,
      totalActualHours: 0,
      totalActualMinutes: 0,
    };
  }

  const breakMinutes = Math.max(0, input.breakMinutes ?? 0);
  const totalMinutes = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
  const actualMinutes = Math.max(0, totalMinutes - breakMinutes);

  // 深夜枠の重複分数を計算
  let lateNightMinutes = calculateLateNightMinutes(start, end);
  // 休憩時間が深夜帯に取られた可能性も考慮し、実働時間を超えないよう安全にキャップ
  lateNightMinutes = Math.min(lateNightMinutes, actualMinutes);

  const isHoliday = Boolean(input.isHoliday);

  if (isHoliday) {
    // 法定休日労働の場合:
    // 所定内・通常時間外は計上せず、すべて休日労働として集計 (深夜割増は重複加算)
    return {
      regularHours: 0,
      overtimeHours: 0,
      lateNightHours: roundToTwo(lateNightMinutes / 60),
      holidayHours: roundToTwo(actualMinutes / 60),
      totalActualHours: roundToTwo(actualMinutes / 60),
      totalActualMinutes: actualMinutes,
    };
  }

  // 平日労働の場合:
  const regularMinutes = Math.min(actualMinutes, LABOR_STANDARDS.DAILY_REGULAR_LIMIT_MINUTES);
  const overtimeMinutes = Math.max(0, actualMinutes - LABOR_STANDARDS.DAILY_REGULAR_LIMIT_MINUTES);

  return {
    regularHours: roundToTwo(regularMinutes / 60),
    overtimeHours: roundToTwo(overtimeMinutes / 60),
    lateNightHours: roundToTwo(lateNightMinutes / 60),
    holidayHours: 0,
    totalActualHours: roundToTwo(actualMinutes / 60),
    totalActualMinutes: actualMinutes,
  };
}
