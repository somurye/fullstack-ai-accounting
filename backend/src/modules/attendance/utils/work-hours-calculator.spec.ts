import { calculateWorkingHours } from './work-hours-calculator';

describe('work-hours-calculator (労働時間区分ロジック境界値検証)', () => {
  describe('境界値: 8時間基準 (所定内 vs 時間外)', () => {
    it('ちょうど8時間00分(480分)の場合: 所定内8.00、時間外0.00', () => {
      const clockIn = new Date(2026, 8, 13, 9, 0, 0);
      const clockOut = new Date(2026, 8, 13, 18, 0, 0); // 拘束9時間、休憩60分 = 実働8時間
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: false,
      });

      expect(res.totalActualMinutes).toBe(480);
      expect(res.totalActualHours).toBe(8.0);
      expect(res.regularHours).toBe(8.0);
      expect(res.overtimeHours).toBe(0.0);
      expect(res.lateNightHours).toBe(0.0);
      expect(res.holidayHours).toBe(0.0);
    });

    it('8時間未満 (7時間00分) の場合: 所定内7.00、時間外0.00', () => {
      const clockIn = new Date(2026, 8, 13, 9, 0, 0);
      const clockOut = new Date(2026, 8, 13, 17, 0, 0); // 拘束8時間、休憩60分 = 実働7時間
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: false,
      });

      expect(res.totalActualMinutes).toBe(420);
      expect(res.regularHours).toBe(7.0);
      expect(res.overtimeHours).toBe(0.0);
      expect(res.lateNightHours).toBe(0.0);
    });

    it('8時間30分 (510分) の場合: 所定内8.00、時間外0.50', () => {
      const clockIn = new Date(2026, 8, 13, 9, 0, 0);
      const clockOut = new Date(2026, 8, 13, 18, 30, 0); // 拘束9.5時間、休憩60分 = 実働8.5時間
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: false,
      });

      expect(res.totalActualMinutes).toBe(510);
      expect(res.regularHours).toBe(8.0);
      expect(res.overtimeHours).toBe(0.5);
      expect(res.lateNightHours).toBe(0.0);
    });
  });

  describe('境界値: 22:00および05:00基準 (深夜労働時間)', () => {
    it('22:00ちょうど退勤の場合: 深夜0.00 (22:00境界値)', () => {
      // 13:00 〜 22:00 (拘束9h, 休憩1h, 実働8h)
      const clockIn = new Date(2026, 8, 13, 13, 0, 0);
      const clockOut = new Date(2026, 8, 13, 22, 0, 0);
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: false,
      });

      expect(res.regularHours).toBe(8.0);
      expect(res.overtimeHours).toBe(0.0);
      expect(res.lateNightHours).toBe(0.0); // 22:00ちょうどは深夜0
    });

    it('23:00退勤の場合: 22:00〜23:00の1時間が深夜に加算', () => {
      // 13:00 〜 23:00 (拘束10h, 休憩1h, 実働9h -> 所定8h, 残業1h, 深夜1h)
      const clockIn = new Date(2026, 8, 13, 13, 0, 0);
      const clockOut = new Date(2026, 8, 13, 23, 0, 0);
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: false,
      });

      expect(res.regularHours).toBe(8.0);
      expect(res.overtimeHours).toBe(1.0);
      expect(res.lateNightHours).toBe(1.0);
    });

    it('翌朝05:00ちょうど退勤 (夜勤): 22:00〜05:00の7時間が深夜に加算', () => {
      // 20:00 〜 翌05:00 (拘束9h, 休憩1h, 実働8h -> 所定8h, 深夜7h)
      const clockIn = new Date(2026, 8, 13, 20, 0, 0);
      const clockOut = new Date(2026, 8, 14, 5, 0, 0);
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: false,
      });

      expect(res.regularHours).toBe(8.0);
      expect(res.overtimeHours).toBe(0.0);
      expect(res.lateNightHours).toBe(7.0);
    });

    it('翌朝06:00退勤 (夜勤残業): 05:00以降は通常時間帯', () => {
      // 20:00 〜 翌06:00 (拘束10h, 休憩1h, 実働9h -> 所定8h, 残業1h, 深夜7h)
      const clockIn = new Date(2026, 8, 13, 20, 0, 0);
      const clockOut = new Date(2026, 8, 14, 6, 0, 0);
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: false,
      });

      expect(res.regularHours).toBe(8.0);
      expect(res.overtimeHours).toBe(1.0);
      expect(res.lateNightHours).toBe(7.0);
    });
  });

  describe('法定休日労働 (isHoliday = true)', () => {
    it('休日昼間労働: 所定内・時間外は0となり全て休日労働時間として計上', () => {
      const clockIn = new Date(2026, 8, 13, 9, 0, 0);
      const clockOut = new Date(2026, 8, 13, 18, 0, 0);
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: true,
      });

      expect(res.regularHours).toBe(0.0);
      expect(res.overtimeHours).toBe(0.0);
      expect(res.holidayHours).toBe(8.0);
      expect(res.lateNightHours).toBe(0.0);
    });

    it('休日深夜労働: 休日労働かつ深夜労働が重複計上される', () => {
      // 13:00 〜 23:00 (拘束10h, 休憩1h, 実働9h, 22:00以降1h)
      const clockIn = new Date(2026, 8, 13, 13, 0, 0);
      const clockOut = new Date(2026, 8, 13, 23, 0, 0);
      const res = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes: 60,
        isHoliday: true,
      });

      expect(res.regularHours).toBe(0.0);
      expect(res.overtimeHours).toBe(0.0);
      expect(res.holidayHours).toBe(9.0);
      expect(res.lateNightHours).toBe(1.0);
    });
  });

  describe('エッジケース・異常値処理', () => {
    it('clockIn または clockOut が欠落している場合は全て0', () => {
      const res = calculateWorkingHours({
        clockIn: new Date(2026, 8, 13, 9, 0, 0),
        clockOut: null,
      });
      expect(res.regularHours).toBe(0);
      expect(res.totalActualHours).toBe(0);
    });

    it('clockOut が clockIn より前または同時刻の場合は全て0', () => {
      const res = calculateWorkingHours({
        clockIn: new Date(2026, 8, 13, 18, 0, 0),
        clockOut: new Date(2026, 8, 13, 9, 0, 0),
      });
      expect(res.regularHours).toBe(0);
      expect(res.totalActualHours).toBe(0);
    });
  });
});
