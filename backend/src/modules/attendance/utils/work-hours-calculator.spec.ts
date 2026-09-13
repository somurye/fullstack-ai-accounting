import {
  calculateWorkingHours,
  calculateWeeklyWorkHours,
} from './work-hours-calculator';

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

  describe('週40時間超過判定ロジック (calculateWeeklyWorkHours)', () => {
    it('1日8時間×5日 (計40時間): 週40時間ちょうどで週時間外0h', () => {
      const days = [
        { workDate: '2026-09-07', clockIn: '2026-09-07T09:00:00+09:00', clockOut: '2026-09-07T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-08', clockIn: '2026-09-08T09:00:00+09:00', clockOut: '2026-09-08T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-09', clockIn: '2026-09-09T09:00:00+09:00', clockOut: '2026-09-09T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-10', clockIn: '2026-09-10T09:00:00+09:00', clockOut: '2026-09-10T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-11', clockIn: '2026-09-11T09:00:00+09:00', clockOut: '2026-09-11T18:00:00+09:00', breakMinutes: 60 },
      ];

      const res = calculateWeeklyWorkHours(days);

      expect(res.totalRegularHours).toBe(40.0);
      expect(res.totalDailyOvertimeHours).toBe(0.0);
      expect(res.totalWeeklyOvertimeHours).toBe(0.0);
      expect(res.totalOvertimeHours).toBe(0.0);
      expect(res.totalActualHours).toBe(40.0);
    });

    it('1日8時間×6日 (計48時間): 日単位超過は0だが週40時間超で8時間が週時間外に計上', () => {
      // 月〜土まで毎日8時間労働
      const days = [
        { workDate: '2026-09-07', clockIn: '2026-09-07T09:00:00+09:00', clockOut: '2026-09-07T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-08', clockIn: '2026-09-08T09:00:00+09:00', clockOut: '2026-09-08T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-09', clockIn: '2026-09-09T09:00:00+09:00', clockOut: '2026-09-09T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-10', clockIn: '2026-09-10T09:00:00+09:00', clockOut: '2026-09-10T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-11', clockIn: '2026-09-11T09:00:00+09:00', clockOut: '2026-09-11T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-12', clockIn: '2026-09-12T09:00:00+09:00', clockOut: '2026-09-12T18:00:00+09:00', breakMinutes: 60 },
      ];

      const res = calculateWeeklyWorkHours(days);

      expect(res.totalRegularHours).toBe(40.0); // 40hでキャップ
      expect(res.totalDailyOvertimeHours).toBe(0.0); // 日単位超過はなし
      expect(res.totalWeeklyOvertimeHours).toBe(8.0); // 土曜の8時間が週時間外に
      expect(res.totalOvertimeHours).toBe(8.0);
      expect(res.totalActualHours).toBe(48.0);

      // 土曜（6日目）のレコードが週時間外8hになっていること
      expect(res.records[5]?.weeklyOvertimeHours).toBe(8.0);
      expect(res.records[5]?.regularHours).toBe(0.0);
    });

    it('1日7時間×6日 (計42時間): 1日8時間未満でも週40時間超の2時間が週時間外に計上', () => {
      // 毎日7時間労働（10:00〜18:00, 休憩1h）
      const days = [
        { workDate: '2026-09-07', clockIn: '2026-09-07T10:00:00+09:00', clockOut: '2026-09-07T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-08', clockIn: '2026-09-08T10:00:00+09:00', clockOut: '2026-09-08T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-09', clockIn: '2026-09-09T10:00:00+09:00', clockOut: '2026-09-09T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-10', clockIn: '2026-09-10T10:00:00+09:00', clockOut: '2026-09-10T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-11', clockIn: '2026-09-11T10:00:00+09:00', clockOut: '2026-09-11T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-12', clockIn: '2026-09-12T10:00:00+09:00', clockOut: '2026-09-12T18:00:00+09:00', breakMinutes: 60 },
      ];

      const res = calculateWeeklyWorkHours(days);

      // 月〜金で 7*5 = 35h。土曜は 7h のうち 5h が所定内（累計40h到達）、残る 2h が週時間外
      expect(res.totalRegularHours).toBe(40.0);
      expect(res.totalDailyOvertimeHours).toBe(0.0);
      expect(res.totalWeeklyOvertimeHours).toBe(2.0);
      expect(res.totalOvertimeHours).toBe(2.0);
      expect(res.totalActualHours).toBe(42.0);
      expect(res.records[5]?.regularHours).toBe(5.0);
      expect(res.records[5]?.weeklyOvertimeHours).toBe(2.0);
    });

    it('1日10時間×5日 (計50時間): 各日2hの時間外(計10h)があるため所定内は40h、週時間外は二重計上されない', () => {
      // 09:00〜20:00 (実働10h, 日時間外2h)
      const days = [
        { workDate: '2026-09-07', clockIn: '2026-09-07T09:00:00+09:00', clockOut: '2026-09-07T20:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-08', clockIn: '2026-09-08T09:00:00+09:00', clockOut: '2026-09-08T20:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-09', clockIn: '2026-09-09T09:00:00+09:00', clockOut: '2026-09-09T20:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-10', clockIn: '2026-09-10T09:00:00+09:00', clockOut: '2026-09-10T20:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-11', clockIn: '2026-09-11T09:00:00+09:00', clockOut: '2026-09-11T20:00:00+09:00', breakMinutes: 60 },
      ];

      const res = calculateWeeklyWorkHours(days);

      expect(res.totalRegularHours).toBe(40.0);
      expect(res.totalDailyOvertimeHours).toBe(10.0);
      expect(res.totalWeeklyOvertimeHours).toBe(0.0); // 二重計上なし
      expect(res.totalOvertimeHours).toBe(10.0);
      expect(res.totalActualHours).toBe(50.0);
    });

    it('法定休日労働を含む場合: 法定休日は週40時間算定対象外となり休日労働として集計', () => {
      // 月〜金 8h (40h) + 日曜 法定休日 8h
      const days = [
        { workDate: '2026-09-07', clockIn: '2026-09-07T09:00:00+09:00', clockOut: '2026-09-07T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-08', clockIn: '2026-09-08T09:00:00+09:00', clockOut: '2026-09-08T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-09', clockIn: '2026-09-09T09:00:00+09:00', clockOut: '2026-09-09T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-10', clockIn: '2026-09-10T09:00:00+09:00', clockOut: '2026-09-10T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-11', clockIn: '2026-09-11T09:00:00+09:00', clockOut: '2026-09-11T18:00:00+09:00', breakMinutes: 60 },
        { workDate: '2026-09-13', clockIn: '2026-09-13T09:00:00+09:00', clockOut: '2026-09-13T18:00:00+09:00', breakMinutes: 60, isHoliday: true },
      ];

      const res = calculateWeeklyWorkHours(days);

      expect(res.totalRegularHours).toBe(40.0);
      expect(res.totalDailyOvertimeHours).toBe(0.0);
      expect(res.totalWeeklyOvertimeHours).toBe(0.0);
      expect(res.totalOvertimeHours).toBe(0.0);
      expect(res.totalHolidayHours).toBe(8.0);
      expect(res.totalActualHours).toBe(48.0);
    });
  });
});
