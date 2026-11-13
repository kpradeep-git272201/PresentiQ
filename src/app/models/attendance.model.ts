export type AttendanceStatus = 'Present' | 'Absent' | 'Half-Day' | 'Leave' | 'Holiday';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  totalHours?: number;
  status: AttendanceStatus;
  isLate?: boolean;
  remarks?: string;
}

export interface AttendanceSummary {
  totalEmployees: number;
  presentToday: number;
  absentToday: number;
  halfDayToday: number;
  lateArrivals: number;
  attendancePercentage: number;
}

export interface AttendanceFilter {
  startDate?: string;
  endDate?: string;
  department?: string;
  status?: AttendanceStatus;
  searchQuery?: string;
}

export interface EmployeeDirectoryItem {
  id: string;
  name: string;
  attendanceId: string;
  designation: string;
  status: 'P' | 'A' | 'M' | 'H' | 'HD'; // P = Present, A = Absent, M = Missed Punch, H = Holiday, HD = Half Day
  octoberStatus?: string;
}

export interface DailyAttendanceMetric {
  day: number;
  present: number;
  leave: number;
  absent: number;
  isWeekend?: boolean;
}

export interface DetailedDashboardMetrics {
  totalEmployees: number;
  employeeTrend: string;
  completedWorkingHours: string;
  completedWorkingHoursEmployees: number;
  standardShiftsText: string;
  incompletedWorkingHours: string;
  incompletedWorkingHoursEmployees: number;
  earlyDeparturesText: string;
  lateAttendanceCompleted: string;
  lateAttendanceCompletedEmployees: number;
  graceTimeUtilizedText: string;
  lateAttendanceIncompleted: string;
  lateAttendanceIncompletedEmployees: number;
  lateEarlyExitText: string;
  missedAttendance: number;
  missedAttendanceEmployees: number;
  requiresManualUpdateText: string;
}
