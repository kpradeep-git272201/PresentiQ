export type AttendanceCategory =
  | 'COMPLETED_ONTIME'
  | 'INCOMPLETE_ONTIME'
  | 'COMPLETED_LATE'
  | 'INCOMPLETE_LATE'
  | 'MISSED'
  | 'HOLIDAY'
  | 'WEEKEND'
  | 'TOTAL_EMP';

export interface DailyLogAnalysis {
  sNo: number;
  date: string;
  status: 'P' | 'A' | 'H' | 'HD' | 'W';
  inTime: string;
  outTime: string;
  duration: string;
  category: AttendanceCategory;
  lateDuration?: string;
  isWeekend?: boolean;
}

export interface AttendanceKPIs {
  totalEmployees: number;
  completedWorkingHours: number;
  completedWorkingHoursEmployees: number;
  incompletedWorkingHours: number;
  incompletedWorkingHoursEmployees: number;
  lateCompletedHours: number;
  lateCompletedEmployees: number;
  lateIncompletedHours: number;
  lateIncompletedEmployees: number;
  missedAttendance: number;
  missedEmployees: number;
}

export interface DrilldownRow {
  employeeName: string;
  attendanceId: string;
  designation: string;
  date: string;
  status: 'P' | 'A' | 'H' | 'HD' | 'W';
  inTime: string;
  outTime: string;
  duration: string;
  lateDuration?: string;
  category: AttendanceCategory;
  reason?: string;
  isLate?: boolean;
  isWeekend?: boolean;
}

export type KpiFilterType =
  | 'TOTAL_EMPLOYEES'
  | 'COMPLETED_ONTIME'
  | 'INCOMPLETE_ONTIME'
  | 'COMPLETED_LATE'
  | 'INCOMPLETE_LATE'
  | 'MISSED';
