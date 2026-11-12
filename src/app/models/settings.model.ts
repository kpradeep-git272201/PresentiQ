export interface ShiftSettings {
  startTime: string; // "09:00" or updated with grace "09:30"
  endTime: string; // "17:30" or updated with grace "18:00"
  baseStartTime?: string; // "09:00"
  baseEndTime?: string; // "17:30"
  graceMinutes: number; // e.g. 15 or 30 minutes
  minWorkHours: number; // e.g. 8.5
  allowOvertime?: boolean;
  enforceStrictCheckout?: boolean;
  sendMissedPunchAlerts?: boolean;
  enableLateDeductions?: boolean;
  autoBackupActive?: boolean;
}

export interface AppSettings extends ShiftSettings {
  organizationName: string;
  workdayStartTime: string;
  workdayEndTime: string;
  gracePeriodMinutes: number;
  minimumHoursForFullDay: number;
  minimumHoursForHalfDay: number;
  darkMode: boolean;
  dateFormat: string;
  autoSaveReports: boolean;
}

export const DEFAULT_SHIFT_SETTINGS: ShiftSettings = {
  startTime: '09:00',
  endTime: '17:30',
  baseStartTime: '09:00',
  baseEndTime: '17:30',
  graceMinutes: 0,
  minWorkHours: 8.5,
  allowOvertime: true,
  enforceStrictCheckout: true,
  sendMissedPunchAlerts: true,
  enableLateDeductions: false,
  autoBackupActive: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_SHIFT_SETTINGS,
  organizationName: 'PresentiQ Organization',
  workdayStartTime: '09:00',
  workdayEndTime: '17:30',
  gracePeriodMinutes: 15,
  minimumHoursForFullDay: 8.5,
  minimumHoursForHalfDay: 4.25,
  darkMode: true,
  dateFormat: 'DD/MM/YYYY',
  autoSaveReports: true,
};
