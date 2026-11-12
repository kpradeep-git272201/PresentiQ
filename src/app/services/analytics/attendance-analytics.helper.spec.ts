import { describe, it, expect } from 'vitest';
import { AttendanceAnalyticsHelper } from './attendance-analytics.helper';
import { ShiftSettings } from '../../models/settings.model';

describe('AttendanceAnalyticsHelper', () => {
  const customSettings: ShiftSettings = {
    startTime: '09:00',
    endTime: '17:30',
    graceMinutes: 15,
    minWorkHours: 8.5,
  };

  describe('parseTimeToSeconds', () => {
    it('parses valid HH:mm:ss strings', () => {
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('09:00:00')).toBe(9 * 3600);
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('09:30:15')).toBe(9 * 3600 + 30 * 60 + 15);
    });

    it('parses timestamp format with date', () => {
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('2026-10-12 09:15:00')).toBe(9 * 3600 + 15 * 60);
    });

    it('handles AM/PM format and markers like (late)', () => {
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('09:55 AM')).toBe(9 * 3600 + 55 * 60);
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('09:55:29 (late)')).toBe(9 * 3600 + 55 * 60 + 29);
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('02:30 PM')).toBe(14 * 3600 + 30 * 60);
    });

    it('returns 0 for empty or invalid times', () => {
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('')).toBe(0);
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('--')).toBe(0);
      expect(AttendanceAnalyticsHelper.parseTimeToSeconds('0000-00-00 00:00:00')).toBe(0);
    });
  });

  describe('parseDurationToSeconds', () => {
    it('parses duration string correctly', () => {
      expect(AttendanceAnalyticsHelper.parseDurationToSeconds('08:30:00')).toBe(30600);
      expect(AttendanceAnalyticsHelper.parseDurationToSeconds('07:15:30')).toBe(7 * 3600 + 15 * 60 + 30);
    });

    it('returns 0 for missing or dash durations', () => {
      expect(AttendanceAnalyticsHelper.parseDurationToSeconds('--')).toBe(0);
      expect(AttendanceAnalyticsHelper.parseDurationToSeconds('')).toBe(0);
    });
  });

  describe('computeDurationBetween', () => {
    it('computes exact HH:mm:ss duration between two timestamps', () => {
      expect(AttendanceAnalyticsHelper.computeDurationBetween('09:00:00', '17:30:00')).toBe('08:30:00');
      expect(AttendanceAnalyticsHelper.computeDurationBetween('09:40:42', '18:14:29')).toBe('08:33:47');
      expect(AttendanceAnalyticsHelper.computeDurationBetween('09:00:00', '13:30:00')).toBe('04:30:00');
    });

    it('returns -- if outTime is before or equal to inTime', () => {
      expect(AttendanceAnalyticsHelper.computeDurationBetween('17:00:00', '09:00:00')).toBe('--');
    });
  });

  describe('categorizeLog', () => {
      it('categorizes scheduled holiday without punches as HOLIDAY', () => {
        const log = { status: 'H', inTime: '--', outTime: '--', duration: '--' };
        expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('HOLIDAY');
      });

        it('categorizes Holiday (H) shift with completed working hours as COMPLETED_ONTIME', () => {
          const log = { status: 'H', inTime: '08:50:00', outTime: '17:30:00', duration: '08:40:00' };
          expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('COMPLETED_ONTIME');
        });

          it('categorizes Holiday (H) shift with late entry but completed full hours as COMPLETED_LATE', () => {
            const log = { status: 'H', inTime: '09:30:00', outTime: '18:15:00', duration: '08:45:00' };
            expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('COMPLETED_LATE');
          });

            it('categorizes Holiday (H) shift with incomplete hours (< 8.5h) as INCOMPLETE_ONTIME', () => {
              const log = { status: 'H', inTime: '08:55:00', outTime: '12:00:00', duration: '03:05:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('INCOMPLETE_ONTIME');
            });

            it('categorizes absent or missing punches as MISSED', () => {
              const absentLog = { status: 'A', inTime: '--', outTime: '--', duration: '--' };
              expect(AttendanceAnalyticsHelper.categorizeLog(absentLog, customSettings)).toBe('MISSED');

              const missingOutLog = { status: 'P', inTime: '09:00:00', outTime: '--', duration: '08:30:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(missingOutLog, customSettings)).toBe('MISSED');
            });

            it('categorizes on-time full shift (<= 09:00:00 and duration >= 8.5h / outTime >= 17:30) as COMPLETED_ONTIME', () => {
              const log = { status: 'P', inTime: '08:58:00', outTime: '17:40:00', duration: '08:42:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('COMPLETED_ONTIME');
            });

            it('categorizes punch within grace period (09:12:00 with 15m grace) as COMPLETED_ONTIME when hours completed', () => {
              const log = { status: 'P', inTime: '09:12:00', outTime: '17:45:00', duration: '08:33:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('COMPLETED_ONTIME');
            });

            it('categorizes on-time entry with incomplete hours (< 8.5h) as INCOMPLETE_ONTIME', () => {
              const log = { status: 'P', inTime: '08:55:00', outTime: '16:00:00', duration: '07:05:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('INCOMPLETE_ONTIME');
            });

            it('categorizes late entry (> 09:15:00 with 15m grace) with completed hours (>= 8.5h) as COMPLETED_LATE', () => {
              const log = { status: 'P', inTime: '09:30:00', outTime: '18:15:00', duration: '08:45:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('COMPLETED_LATE');
            });

            it('categorizes late entry (> 09:15:00 with 15m grace) with incomplete hours (< 8.5h) as INCOMPLETE_LATE', () => {
              const log = { status: 'P', inTime: '09:30:00', outTime: '16:30:00', duration: '07:00:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(log, customSettings)).toBe('INCOMPLETE_LATE');
            });

            it('supports dynamic 30-minute grace period settings (09:00 -> 09:30 start, 17:30 -> 18:00 end)', () => {
              const settings30Grace: ShiftSettings = {
                startTime: '09:00',
                endTime: '17:30',
                graceMinutes: 30,
                minWorkHours: 8.5,
              };

              // 09:25:00 is within 30 min grace period (effective start 09:30:00)
              const onTimeComplete = { status: 'P', inTime: '09:25:00', outTime: '18:00:00', duration: '08:35:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(onTimeComplete, settings30Grace)).toBe('COMPLETED_ONTIME');

              const onTimeIncomplete = { status: 'P', inTime: '09:25:00', outTime: '17:30:00', duration: '08:05:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(onTimeIncomplete, settings30Grace)).toBe('INCOMPLETE_ONTIME');

              // 09:35:00 is after 30 min grace period
              const lateComplete = { status: 'P', inTime: '09:35:00', outTime: '18:10:00', duration: '08:35:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(lateComplete, settings30Grace)).toBe('COMPLETED_LATE');

              const lateIncomplete = { status: 'P', inTime: '09:35:00', outTime: '17:30:00', duration: '07:55:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(lateIncomplete, settings30Grace)).toBe('INCOMPLETE_LATE');
            });

            it('supports 0 grace minutes (strict 09:00:00 start cutoff)', () => {
              const settingsZeroGrace: ShiftSettings = {
                startTime: '09:00',
                endTime: '17:30',
                graceMinutes: 0,
                minWorkHours: 8.5,
              };

              const strictOnTime = { status: 'P', inTime: '09:00:00', outTime: '17:30:00', duration: '08:30:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(strictOnTime, settingsZeroGrace)).toBe('COMPLETED_ONTIME');

              const strictLate = { status: 'P', inTime: '09:05:00', outTime: '17:35:00', duration: '08:30:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(strictLate, settingsZeroGrace)).toBe('COMPLETED_LATE');
            });

            it('accurately categorizes when startTime and endTime are updated to 09:30 and 18:00 based on 30m grace', () => {
              const updatedConfig: ShiftSettings = {
                startTime: '09:30',
                endTime: '18:00',
                baseStartTime: '09:00',
                baseEndTime: '17:30',
                graceMinutes: 30,
                minWorkHours: 8.5,
              };

              const withinGrace = { status: 'P', inTime: '09:28:00', outTime: '18:00:00', duration: '08:32:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(withinGrace, updatedConfig)).toBe('COMPLETED_ONTIME');

              const afterGrace = { status: 'P', inTime: '09:35:00', outTime: '18:15:00', duration: '08:40:00' };
              expect(AttendanceAnalyticsHelper.categorizeLog(afterGrace, updatedConfig)).toBe('COMPLETED_LATE');

              expect(AttendanceAnalyticsHelper.calculateLateMinutes('09:35:00', '09:30', 30, '09:00')).toBe(35);
            });
          });

          describe('calculateLateMinutes', () => {
            it('returns 0 if inTime is within grace period', () => {
              expect(AttendanceAnalyticsHelper.calculateLateMinutes('09:12:00', '09:00', 15)).toBe(0);
              expect(AttendanceAnalyticsHelper.calculateLateMinutes('09:25:00', '09:00', 30)).toBe(0);
            });

            it('returns total minutes late from shift start when exceeding grace period', () => {
              expect(AttendanceAnalyticsHelper.calculateLateMinutes('09:35:00', '09:00', 30)).toBe(35);
              expect(AttendanceAnalyticsHelper.calculateLateMinutes('09:20:00', '09:00', 15)).toBe(20);
              expect(AttendanceAnalyticsHelper.calculateLateMinutes('09:05:00', '09:00', 0)).toBe(5);
            });
          });

          describe('calculateKPIs', () => {
            it('correctly aggregates all employee daily logs', () => {
              const mockEmployees = [
                {
                  name: 'Emp 1',
                  dailyLogs: [
                    { status: 'P', inTime: '09:00:00', outTime: '17:30:00', duration: '08:30:00' }, // COMPLETED_ONTIME
                    { status: 'P', inTime: '09:00:00', outTime: '16:00:00', duration: '07:00:00' }, // INCOMPLETE_ONTIME
                    { status: 'P', inTime: '09:30:00', outTime: '18:30:00', duration: '09:00:00' }, // COMPLETED_LATE
                    { status: 'P', inTime: '09:30:00', outTime: '16:00:00', duration: '06:30:00' }, // INCOMPLETE_LATE
                    { status: 'A', inTime: '--', outTime: '--', duration: '--' },                   // MISSED
                    { status: 'H', inTime: '--', outTime: '--', duration: '--' },                   // HOLIDAY
                  ],
                },
              ];

              const kpis = AttendanceAnalyticsHelper.calculateKPIs(mockEmployees, customSettings);
              expect(kpis.totalEmployees).toBe(1);
              expect(kpis.completedWorkingHours).toBe(1);
              expect(kpis.incompletedWorkingHours).toBe(1);
              expect(kpis.lateCompletedHours).toBe(1);
              expect(kpis.lateIncompletedHours).toBe(1);
              expect(kpis.missedAttendance).toBe(1);
            });
          });
        });
