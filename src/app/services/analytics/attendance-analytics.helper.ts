import { ShiftSettings } from '../../models/settings.model';
import { AttendanceKPIs, DailyLogAnalysis, AttendanceCategory } from '../../models/drilldown.model';

export class AttendanceAnalyticsHelper {
  // 8.5 Hours = 8 * 3600 + 30 * 60 = 30600 seconds
  private static readonly REQUIRED_SECONDS = 8.5 * 3600;

  /**
   * Parse a time string ("YYYY-MM-DD HH:mm:ss", "HH:mm:ss", "09:55 AM", or with "(late)") into seconds from midnight
   */
  static parseTimeToSeconds(timeStr: string): number {
    if (!timeStr || timeStr.trim() === '' || timeStr.includes('0000-00-00')) {
      return 0;
    }

    // Clean markers like "(late)"
    const cleanStr = timeStr.replace(/\(late\)/gi, '').trim();
    const isPM = cleanStr.toUpperCase().includes('PM');
    const isAM = cleanStr.toUpperCase().includes('AM');

    // Remove AM/PM for splitting
    const timeOnly = cleanStr.replace(/ AM| PM/gi, '').trim();
    const parts = timeOnly.split(' ');
    const clock = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    const [hRaw, mRaw, sRaw] = clock.split(':').map(Number);

    let h = hRaw || 0;
    const m = mRaw || 0;
    const s = sRaw || 0;

    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;

    return h * 3600 + m * 60 + s;
  }

  /**
   * Parse a duration string ("HH:mm:ss" or "HH:mm") into total elapsed seconds
   */
  static parseDurationToSeconds(durationStr: string): number {
    if (!durationStr || durationStr === '--' || durationStr.trim() === '') {
      return 0;
    }
    const [h, m, s] = durationStr.trim().split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
  }

  /**
   * Format seconds into "HHh MMm" or "HH:mm:ss"
   */
  static secondsToHoursAndMins(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  /**
   * Compute exact duration string "HH:mm:ss" between inTime and outTime
   */
  static computeDurationBetween(inTime: string, outTime: string): string {
    const inSec = this.parseTimeToSeconds(inTime);
    const outSec = this.parseTimeToSeconds(outTime);
    if (outSec <= inSec) return '--';
    const diff = outSec - inSec;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Categorize an individual attendance daily log using dynamic ShiftSettings or defaults
   *
   * Business Logic & KPI Rules:
   * 1. Total Employees: Unique employee count from the uploaded PDF
   * 2. P (Present): Minimum 8.5 hours (or settings.minWorkHours) duration required
   * 3. H (Holiday): Scheduled holiday/off (e.g. weekend or festival holiday)
   * 4. A (Absent): Marked absent or missing punch
   * 5. Completed Working Hours (COMPLETED_ONTIME): In <= 09:00:00 AND completed required hours
   * 6. Incompleted Working Hours (INCOMPLETE_ONTIME): In <= 09:00:00 AND failed required hours
   * 7. Late Entry & Completed (COMPLETED_LATE): In > 09:00:00 BUT completed required hours
   * 8. Late Entry & Incompleted (INCOMPLETE_LATE): In > 09:00:00 AND failed required hours
   * 9. Missed / Absent (MISSED): Absent ('A') or invalid/missing punches
   */
  static categorizeLog(
    log: { status: string; inTime: string; outTime: string; duration: string },
    settings?: ShiftSettings
  ): 'COMPLETED_ONTIME' | 'INCOMPLETE_ONTIME' | 'COMPLETED_LATE' | 'INCOMPLETE_LATE' | 'MISSED' | 'HOLIDAY' {
    const hasInvalidPunch =
      !log.outTime ||
      log.outTime.includes('0000-00-00') ||
      log.outTime === '--' ||
      log.outTime.toLowerCase().includes('missing') ||
      !log.inTime ||
      log.inTime.includes('0000-00-00') ||
      log.inTime === '--' ||
      log.inTime.toLowerCase().includes('missing');

    // If status is 'H' with no valid punches, it represents a scheduled holiday off (e.g. weekend or national holiday)
    if (log.status === 'H' && hasInvalidPunch) {
      return 'HOLIDAY';
    }

    // Missed punch check: Absent ('A') or missing In/Out time
    if (log.status === 'A' || hasInvalidPunch) {
      return 'MISSED';
    }

    // Resolve base and effective shift timings
    const graceMinutes = Number(settings?.graceMinutes) || 0;
    const graceSeconds = graceMinutes * 60;

    let baseStartSeconds = settings?.baseStartTime
      ? this.parseTimeToSeconds(settings.baseStartTime)
      : this.parseTimeToSeconds('09:00');

    let baseEndSeconds = settings?.baseEndTime
      ? this.parseTimeToSeconds(settings.baseEndTime)
      : this.parseTimeToSeconds('17:30');

    let effectiveStartSeconds: number;
    let effectiveEndSeconds: number;

    const rawStartSeconds = this.parseTimeToSeconds(settings?.startTime || '09:00');
    const rawEndSeconds = this.parseTimeToSeconds(settings?.endTime || '17:30');

    // If startTime is already shifted by graceMinutes (e.g. 09:30 when base is 09:00 and grace is 30m)
    if (rawStartSeconds === baseStartSeconds + graceSeconds) {
      effectiveStartSeconds = rawStartSeconds;
    } else if (rawStartSeconds === baseStartSeconds) {
      effectiveStartSeconds = baseStartSeconds + graceSeconds;
    } else {
      effectiveStartSeconds = rawStartSeconds;
      baseStartSeconds = Math.max(0, rawStartSeconds - graceSeconds);
    }

    if (rawEndSeconds === baseEndSeconds + graceSeconds) {
      effectiveEndSeconds = rawEndSeconds;
    } else if (rawEndSeconds === baseEndSeconds) {
      effectiveEndSeconds = baseEndSeconds + graceSeconds;
    } else {
      effectiveEndSeconds = rawEndSeconds;
      baseEndSeconds = Math.max(0, rawEndSeconds - graceSeconds);
    }

    // Minimum Required Work Duration:
    // Standard Shift: 8.5 Hours minimum (or settings.minWorkHours)
    const minHours = settings?.minWorkHours ?? 8.5;
    const requiredWorkSeconds = minHours * 3600;

    const inSeconds = this.parseTimeToSeconds(log.inTime);
    const outSeconds = this.parseTimeToSeconds(log.outTime);

    // Duration in seconds: parse duration or calculate from in/out
    let durationSeconds = this.parseDurationToSeconds(log.duration);
    if (durationSeconds === 0 && outSeconds > inSeconds) {
      durationSeconds = outSeconds - inSeconds;
    }

    // Late Entry: Punched in strictly after effective start cutoff (> effectiveStartSeconds)
    const isLate = inSeconds > effectiveStartSeconds;

    // Completed Hours check:
    // Completed required duration (>= 8.5h) OR punched out at/after effective end time (>= effectiveEndSeconds)
    const isCompleted =
      durationSeconds >= requiredWorkSeconds ||
    outSeconds >= effectiveEndSeconds;

    // Rule 2: On-time entry (<= effectiveStartSeconds) and completed required hours
    if (!isLate && isCompleted) return 'COMPLETED_ONTIME';

    // Rule 3: On-time entry (<= effectiveStartSeconds) but failed to complete required hours
    if (!isLate && !isCompleted) return 'INCOMPLETE_ONTIME';

    // Rule 4: Late entry (> effectiveStartSeconds) but completed >= required hours
    if (isLate && durationSeconds >= requiredWorkSeconds) return 'COMPLETED_LATE';

    // Rule 5: Late entry (> effectiveStartSeconds) and failed to complete required hours
    return 'INCOMPLETE_LATE';
  }

  /**
   * Calculate late delay in minutes beyond shift start + grace cutoff
   */
  static calculateLateMinutes(
    inTime: string,
    startTime = '09:00',
    graceMinutes = 0,
    baseStartTime?: string
  ): number {
    const inSeconds = this.parseTimeToSeconds(inTime);
    const graceSec = (Number(graceMinutes) || 0) * 60;

    let baseSec = baseStartTime
      ? this.parseTimeToSeconds(baseStartTime)
      : this.parseTimeToSeconds('09:00');

    const startSec = this.parseTimeToSeconds(startTime);

    let effectiveStartSec: number;
    if (startSec === baseSec + graceSec) {
      effectiveStartSec = startSec;
    } else if (startSec === baseSec) {
      effectiveStartSec = baseSec + graceSec;
    } else {
      effectiveStartSec = startSec;
      baseSec = Math.max(0, startSec - graceSec);
    }

    if (inSeconds <= effectiveStartSec) return 0;
    return Math.round((inSeconds - baseSec) / 60);
  }

  /**
   * Calculate KPIs across all employees
   */
  static calculateKPIs(employees: any[], settings?: ShiftSettings): AttendanceKPIs {
    const kpis: AttendanceKPIs = {
      totalEmployees: employees.length,
      completedWorkingHours: 0,
      completedWorkingHoursEmployees: 0,
      incompletedWorkingHours: 0,
      incompletedWorkingHoursEmployees: 0,
      lateCompletedHours: 0,
      lateCompletedEmployees: 0,
      lateIncompletedHours: 0,
      lateIncompletedEmployees: 0,
      missedAttendance: 0,
      missedEmployees: 0,
    };

    const uniqueCompleted = new Set<string>();
    const uniqueIncomplete = new Set<string>();
    const uniqueLateCompleted = new Set<string>();
    const uniqueLateIncomplete = new Set<string>();
    const uniqueMissed = new Set<string>();

    employees.forEach((emp) => {
      const empId = emp.attendanceId || emp.id || emp.name;
      const logs = emp.dailyLogs || [];
      logs.forEach((log: any) => {
        const cat = this.categorizeLog(log, settings);
        log.category = cat;

        switch (cat) {
          case 'COMPLETED_ONTIME':
            kpis.completedWorkingHours++;
            uniqueCompleted.add(empId);
            break;
          case 'INCOMPLETE_ONTIME':
            kpis.incompletedWorkingHours++;
            uniqueIncomplete.add(empId);
            break;
          case 'COMPLETED_LATE':
            kpis.lateCompletedHours++;
            uniqueLateCompleted.add(empId);
            break;
          case 'INCOMPLETE_LATE':
            kpis.lateIncompletedHours++;
            uniqueLateIncomplete.add(empId);
            break;
          case 'MISSED':
            kpis.missedAttendance++;
            uniqueMissed.add(empId);
            break;
        }
      });
    });

    kpis.completedWorkingHoursEmployees = uniqueCompleted.size;
    kpis.incompletedWorkingHoursEmployees = uniqueIncomplete.size;
    kpis.lateCompletedEmployees = uniqueLateCompleted.size;
    kpis.lateIncompletedEmployees = uniqueLateIncomplete.size;
    kpis.missedEmployees = uniqueMissed.size;

    return kpis;
  }
}
