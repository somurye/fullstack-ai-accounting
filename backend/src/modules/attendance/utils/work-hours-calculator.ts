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

export interface DailyWorkRecordForAggregation {
  workDate: string; // YYYY-MM-DD
  clockIn: Date | string | null | undefined;
  clockOut: Date | string | null | undefined;
  breakMinutes?: number | null;
  isHoliday?: boolean | null;
}

export interface WeeklyCalculationDayResult extends WorkHoursCalculationResult {
  workDate: string;
  isHoliday: boolean;
  /** 日単位の法定超過時間（1日8時間を超える部分） */
  dailyOvertimeHours: number;
  /** 当該週において週40時間を超えたため時間外へ振り替えられた時間 */
  weeklyOvertimeHours: number;
}

export interface WeeklyWorkHoursResult {
  records: WeeklyCalculationDayResult[];
  /** 所定内労働時間合計（週40時間を上限にキャップされた後の時間） */
  totalRegularHours: number;
  /** 1日8時間超の時間外労働合計 */
  totalDailyOvertimeHours: number;
  /** 週40時間超の時間外労働合計（日の時間外との重複を除く） */
  totalWeeklyOvertimeHours: number;
  /** 総時間外労働時間（日単位超過 + 週単位超過） */
  totalOvertimeHours: number;
  /** 総深夜労働時間 */
  totalLateNightHours: number;
  /** 法定休日労働時間 */
  totalHolidayHours: number;
  /** 実総労働時間 */
  totalActualHours: number;
}

/**
 * 1週間単位（原則7日間）の労働時間集計・週40時間超過判定ロジック
 *
 * 労働基準法第32条第1項に基づく週単位時間外労働の計算規則:
 * 1. 各日の労働時間について、1日8時間を超える部分は「日の時間外」として計上。
 * 2. 法定休日労働（isHoliday=true）は35%割増の対象であり、週40時間の算定対象から除外（昭22.11.27 基発401号）。
 * 3. 各日の法定内労働時間（実労働時間から日単位超過を除いた部分、最大8時間）を当該週で累積。
 * 4. 累積法定内時間が週40時間（2400分）を超過した場合、その超過分を「週の時間外労働」として時間外に振り替える。
 *    （すでに日単位時間外として計上された部分は二重計上しない）
 */
export function calculateWeeklyWorkHours(
  days: DailyWorkRecordForAggregation[],
  options?: { weeklyLimitMinutes?: number },
): WeeklyWorkHoursResult {
  const weeklyLimitMinutes =
    options?.weeklyLimitMinutes ?? LABOR_STANDARDS.WEEKLY_REGULAR_LIMIT_MINUTES;

  // 日付昇順でソート
  const sortedDays = [...days].sort((a, b) => a.workDate.localeCompare(b.workDate));

  let cumulativeRegularMinutes = 0;
  let totalDailyOvertimeMinutes = 0;
  let totalWeeklyOvertimeMinutes = 0;
  let totalRegularMinutes = 0;
  let totalLateNightMinutes = 0;
  let totalHolidayMinutes = 0;
  let totalActualMinutes = 0;

  const resultRecords: WeeklyCalculationDayResult[] = [];

  for (const day of sortedDays) {
    const daily = calculateWorkingHours({
      clockIn: day.clockIn,
      clockOut: day.clockOut,
      breakMinutes: day.breakMinutes,
      isHoliday: day.isHoliday,
    });

    const isHoliday = Boolean(day.isHoliday);

    if (isHoliday) {
      // 法定休日労働: 週40時間の累積には算入しない
      totalHolidayMinutes += daily.totalActualMinutes;
      totalLateNightMinutes += Math.round(daily.lateNightHours * 60);
      totalActualMinutes += daily.totalActualMinutes;

      resultRecords.push({
        ...daily,
        workDate: day.workDate,
        isHoliday: true,
        dailyOvertimeHours: 0,
        weeklyOvertimeHours: 0,
      });
      continue;
    }

    const dayActualMinutes = daily.totalActualMinutes;
    totalActualMinutes += dayActualMinutes;
    totalLateNightMinutes += Math.round(daily.lateNightHours * 60);

    // 日単位の法定超過（1日8時間＝480分超）
    const dayRegularCandidateMinutes = Math.min(
      dayActualMinutes,
      LABOR_STANDARDS.DAILY_REGULAR_LIMIT_MINUTES,
    );
    const dayOvertimeMinutes = Math.max(
      0,
      dayActualMinutes - LABOR_STANDARDS.DAILY_REGULAR_LIMIT_MINUTES,
    );
    totalDailyOvertimeMinutes += dayOvertimeMinutes;

    // 週40時間（2400分）判定
    let dayWeeklyOvertimeMinutes = 0;
    let dayFinalRegularMinutes = 0;

    if (cumulativeRegularMinutes + dayRegularCandidateMinutes <= weeklyLimitMinutes) {
      // 週40時間以内
      dayFinalRegularMinutes = dayRegularCandidateMinutes;
      cumulativeRegularMinutes += dayRegularCandidateMinutes;
    } else {
      // 週40時間を超過する境界または既に超過している場合
      const remainingRegularMinutes = Math.max(0, weeklyLimitMinutes - cumulativeRegularMinutes);
      dayFinalRegularMinutes = remainingRegularMinutes;
      dayWeeklyOvertimeMinutes = dayRegularCandidateMinutes - remainingRegularMinutes;
      cumulativeRegularMinutes = weeklyLimitMinutes; // 上限に到達
    }

    totalRegularMinutes += dayFinalRegularMinutes;
    totalWeeklyOvertimeMinutes += dayWeeklyOvertimeMinutes;

    const dayTotalOvertimeMinutes = dayOvertimeMinutes + dayWeeklyOvertimeMinutes;

    resultRecords.push({
      workDate: day.workDate,
      isHoliday: false,
      regularHours: roundToTwo(dayFinalRegularMinutes / 60),
      overtimeHours: roundToTwo(dayTotalOvertimeMinutes / 60),
      dailyOvertimeHours: roundToTwo(dayOvertimeMinutes / 60),
      weeklyOvertimeHours: roundToTwo(dayWeeklyOvertimeMinutes / 60),
      lateNightHours: daily.lateNightHours,
      holidayHours: 0,
      totalActualHours: daily.totalActualHours,
      totalActualMinutes: daily.totalActualMinutes,
    });
  }

  const totalOvertimeMinutes = totalDailyOvertimeMinutes + totalWeeklyOvertimeMinutes;

  return {
    records: resultRecords,
    totalRegularHours: roundToTwo(totalRegularMinutes / 60),
    totalDailyOvertimeHours: roundToTwo(totalDailyOvertimeMinutes / 60),
    totalWeeklyOvertimeHours: roundToTwo(totalWeeklyOvertimeMinutes / 60),
    totalOvertimeHours: roundToTwo(totalOvertimeMinutes / 60),
    totalLateNightHours: roundToTwo(totalLateNightMinutes / 60),
    totalHolidayHours: roundToTwo(totalHolidayMinutes / 60),
    totalActualHours: roundToTwo(totalActualMinutes / 60),
  };
}
