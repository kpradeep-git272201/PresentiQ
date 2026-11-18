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
   * Returns short weekday abbreviation: 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'
   * Guaranteed accurate calendar lookup based on date/day.
   */
  static getWeekdayName(dateStrOrDay?: string | number, monthName?: string, year?: number): string {
    const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (!dateStrOrDay) return '';

    if (typeof dateStrOrDay === 'number' && monthName && year) {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const mIdx = monthNames.findIndex((m) => m.toLowerCase().startsWith(monthName.substring(0, 3).toLowerCase()));
      if (mIdx !== -1) {
        return WEEKDAY_NAMES[new Date(year, mIdx, dateStrOrDay).getDay()] || '';
      }
    }

    if (typeof dateStrOrDay === 'string') {
      const match = dateStrOrDay.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
      if (match) {
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const mIdx = monthNames.indexOf(match[1].toLowerCase().substring(0, 3));
        const day = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        if (mIdx !== -1) {
          return WEEKDAY_NAMES[new Date(y, mIdx, day).getDay()] || '';
        }
      }
      const parsed = new Date(dateStrOrDay);
      if (!isNaN(parsed.getTime())) {
        return WEEKDAY_NAMES[parsed.getDay()] || '';
      }
    }
    return '';
  }

  /**
   * Check if a given date or day is a weekend (Saturday or Sunday) based on actual calendar.
   */
  static isDateWeekend(dateStrOrDay?: string | number, monthName?: string, year?: number): boolean {
    const weekday = this.getWeekdayName(dateStrOrDay, monthName, year);
    return weekday === 'Sat' || weekday === 'Sun';
  }

  /**
   * Determine attendance status ('P' | 'A' | 'H' | 'HD' | 'W') based on actual calendar date,
   * worked duration, and settings.
   *
   * Business Logic Rules:
   * 1. 'W' (Weekend): Saturday or Sunday with no punches (calculated dynamically from calendar)
   * 2. 'H' (Holiday): Scheduled weekday holiday/off with no punches (e.g. Gandhi Jayanti, Maharishi Valmiki Jayanti)
   * 3. 'A' (Absent): Explicitly absent on a weekday with no punches
   * 4. 'HD' (Half Day): If worked duration is strictly less than halfDayWorkHours threshold (default: 6.0 hours)
   * 5. 'P' (Present): Worked duration meets or exceeds halfDayWorkHours threshold (e.g. >= 6.0 hours)
   *
   * Note: Weekdays (Monday through Friday) MUST NEVER be marked as 'W' (Weekend).
   */
  static determineLogStatus(
    log: { status?: string; inTime?: string; outTime?: string; duration?: string; date?: string; isWeekend?: boolean; day?: number },
    settings?: ShiftSettings
  ): 'P' | 'A' | 'H' | 'HD' | 'W' {
    const rawStatus = (log.status || '').toUpperCase().trim();
    const isWeekend = Boolean(
      (log.date && this.isDateWeekend(log.date)) ||
      (log.day && this.isDateWeekend(log.day, 'October', 2026)) ||
      (log.isWeekend && !log.date) ||
      rawStatus === 'W'
    );

    const hasInTime = Boolean(log.inTime) && log.inTime !== '--' && !log.inTime!.includes('0000-00-00');
    const hasOutTime = Boolean(log.outTime) && log.outTime !== '--' && log.outTime !== 'Missing' && !log.outTime!.includes('0000-00-00');
    const hasAnyPunch = hasInTime || hasOutTime;
    const hasValidPunch = hasInTime && hasOutTime;

    // Rule 1: Saturday and Sunday without valid punches is ALWAYS 'W' (Weekend)
    if (isWeekend && !hasValidPunch) {
      return 'W';
    }

    // Rule 2: Weekdays (Monday to Friday) MUST NEVER be marked as 'W' (Weekend)
    if (!isWeekend && !hasValidPunch) {
      if (rawStatus === 'A') return 'A';
      // If there is any punch (e.g. In-time present but Out-time missing) or marked Present, it is Present (Anomaly/Missed out punch)
      if (hasAnyPunch || rawStatus === 'P') {
        return 'P';
      }
      return 'H'; // Scheduled weekday holiday / gazetted off
    }

    // Rule 3: Valid punches on either weekend or weekday
    // Calculate worked duration in seconds
    let durSec = this.parseDurationToSeconds(log.duration || '');
    if (durSec === 0 && hasValidPunch && log.inTime && log.outTime) {
      const inSec = this.parseTimeToSeconds(log.inTime);
      const outSec = this.parseTimeToSeconds(log.outTime);
      if (outSec > inSec) {
        durSec = outSec - inSec;
      }
    }

    if (durSec > 0) {
      const halfDayHours = Number(settings?.halfDayWorkHours) > 0 ? Number(settings?.halfDayWorkHours) : 6.0;
      const halfDaySeconds = halfDayHours * 3600;

      // If worked duration is strictly less than halfDayWorkHours threshold, it is considered Half Day (HD)
      if (durSec < halfDaySeconds) {
        return 'HD';
      }
      return 'P';
    }

    if (isWeekend) return 'W';
    if (rawStatus === 'A') return 'A';
    if (hasAnyPunch || rawStatus === 'P') return 'P';
    return 'H';
  }

  /**
   * Categorize an individual attendance daily log using dynamic ShiftSettings or defaults
   *
   * Business Logic & KPI Rules:
   * 1. Total Employees: Unique employee count from the uploaded PDF
   * 2. P (Present): Minimum 8.5 hours (or settings.minWorkHours) duration required
   * 3. W (Weekend): Saturday / Sunday (not counted in completed shift or worked hours)
   * 4. H (Holiday): Scheduled weekday holiday/off (e.g. festival holiday on a weekday)
   * 5. A (Absent): Marked absent or missing punch
   * 6. Completed Working Hours (COMPLETED_ONTIME): In <= 09:00:00 AND completed required hours
   * 7. Incompleted Working Hours (INCOMPLETE_ONTIME): In <= 09:00:00 AND failed required hours
   * 8. Late Entry & Completed (COMPLETED_LATE): In > 09:00:00 BUT completed required hours
   * 9. Late Entry & Incompleted (INCOMPLETE_LATE): In > 09:00:00 AND failed required hours
   * 10. Missed / Absent (MISSED): Absent ('A') or invalid/missing punches
   */
  static categorizeLog(
    log: { status?: string; inTime?: string; outTime?: string; duration?: string; date?: string; isWeekend?: boolean; day?: number },
    settings?: ShiftSettings
  ): AttendanceCategory {
    const isWeekend = Boolean(
      (log.date && this.isDateWeekend(log.date)) ||
      (log.day && this.isDateWeekend(log.day, 'October', 2026)) ||
      (log.isWeekend && !log.date) ||
      (log.status === 'W')
    );

    // Dynamic Weekend Rule:
    // Saturday and Sunday are categorized as 'WEEKEND'.
    // Weekends do NOT complete regular shifts or add to completed working hours.
    if (isWeekend) {
      return 'WEEKEND';
    }

    // Weekdays are NEVER categorized as WEEKEND.
    const hasInvalidPunch =
      !log.outTime ||
      log.outTime.includes('0000-00-00') ||
      log.outTime === '--' ||
      log.outTime.toLowerCase().includes('missing') ||
      !log.inTime ||
      log.inTime.includes('0000-00-00') ||
      log.inTime === '--' ||
      log.inTime.toLowerCase().includes('missing');

    const hasAnyPunch =
      Boolean(log.inTime && log.inTime !== '--' && !log.inTime.includes('0000-00-00')) ||
      Boolean(log.outTime && log.outTime !== '--' && !log.outTime.includes('0000-00-00') && !log.outTime.toLowerCase().includes('missing'));

    // Missed punch check: Absent ('A'), or any punch exists but invalid punch (e.g. In exists, Out missing), or status is 'P' with invalid punch
    if (log.status === 'A' || (hasInvalidPunch && (hasAnyPunch || log.status === 'P'))) {
      return 'MISSED';
    }

    // If status is 'H' (or no status) with no punches at all on a weekday, it represents a scheduled weekday holiday off
    if (hasInvalidPunch && !hasAnyPunch) {
      return 'HOLIDAY';
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

    const inSeconds = this.parseTimeToSeconds(log.inTime || '');
    const outSeconds = this.parseTimeToSeconds(log.outTime || '');

    // Duration in seconds: parse duration or calculate from in/out
    let durationSeconds = this.parseDurationToSeconds(log.duration || '');
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
