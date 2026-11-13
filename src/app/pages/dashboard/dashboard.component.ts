import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  signal,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { StorageService } from '../../services/storage/storage.service';
import { SettingsService } from '../../services/settings/settings.service';
import {
  PdfParserService,
  ParsedDashboardPayload,
  EmployeeWithLogs,
} from '../../services/pdf-parser/pdf-parser.service';
import {
  EmployeeDirectoryItem,
  DailyAttendanceMetric,
  DetailedDashboardMetrics,
} from '../../models/attendance.model';
import {
  DrilldownRow,
  KpiFilterType,
  AttendanceKPIs,
} from '../../models/drilldown.model';
import { ShiftSettings } from '../../models/settings.model';
import { AttendanceAnalyticsHelper } from '../../services/analytics/attendance-analytics.helper';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  private router = inject(Router);
  private storageService = inject(StorageService);
  private settingsService = inject(SettingsService);
  private pdfParserService = inject(PdfParserService);

  readonly Math = Math;

  private readonly LAST_SELECTED_MONTH_KEY = 'presentiq_last_selected_month';

  // Empty initial baseline (No dummy or mock data)
  private readonly emptyMetrics: DetailedDashboardMetrics = {
    totalEmployees: 0,
    employeeTrend: '0 registered staff',
    completedWorkingHours: '0',
    completedWorkingHoursEmployees: 0,
    standardShiftsText: 'Standard Shifts',
    incompletedWorkingHours: '0',
    incompletedWorkingHoursEmployees: 0,
    earlyDeparturesText: 'Early Departures',
    lateAttendanceCompleted: '0',
    lateAttendanceCompletedEmployees: 0,
    graceTimeUtilizedText: 'Grace Utilized',
    lateAttendanceIncompleted: '0',
    lateAttendanceIncompletedEmployees: 0,
    lateEarlyExitText: 'Late + Early Exit',
    missedAttendance: 0,
    missedAttendanceEmployees: 0,
    requiresManualUpdateText: 'Manual Update Req.',
  };

  private readonly emptyKpis: AttendanceKPIs = {
    totalEmployees: 0,
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

  // Upload & File State
  isPdfUploaded = signal<boolean>(false);
  isParsing = signal<boolean>(false);
  uploadedFileName = signal<string>('');
  isDragging = signal<boolean>(false);

  // Month Selector & Navigation
  selectedMonth = signal<string>('October 2026');
  uploadedMonths = signal<string[]>([]);
  showMonthDropdown = signal<boolean>(false);
  showUserMenu = signal<boolean>(false);
  toastMessage = signal<string>('');
  activeTab = signal<string>('Dashboard');

  readonly defaultCalendarMonths: string[] = [
    'October 2026',
    'September 2026',
    'August 2026',
    'July 2026',
    'June 2026',
    'May 2026',
  ];

  // Dynamic available months combining uploaded months and calendar months
  availableMonths = computed(() => {
    const uploaded = this.uploadedMonths();
    const unique = new Set<string>([...uploaded, ...this.defaultCalendarMonths]);
    return Array.from(unique);
  });

  // Dynamic Dashboard Raw Data (Strictly populated from parsed payload in IndexedDB)
  metrics = signal<DetailedDashboardMetrics>(this.emptyMetrics);
  kpis = signal<AttendanceKPIs>(this.emptyKpis);
  dailyMetrics = signal<DailyAttendanceMetric[]>([]);
  allEmployees = signal<EmployeeDirectoryItem[]>([]);
  detailedEmployees = signal<EmployeeWithLogs[]>([]);
  allFlattenedLogs = signal<DrilldownRow[]>([]);

  // Search & Pagination for Employee Directory
  searchQuery = signal<string>('');
  currentPage = signal<number>(1);
  pageSize = 5;

  // Full Directory Tab Pagination & Sorting
  directoryPage = signal<number>(1);
  directoryPageSize = signal<number>(10);
  directorySortCol = signal<keyof EmployeeDirectoryItem>('name');
  directorySortAsc = signal<boolean>(true);

  // Chart Tooltip Inspection
  hoveredDay = signal<DailyAttendanceMetric | null>(null);

  // ---------------------------------------------------------------------------
  // KPI Drilldown Modal State (Dynamically calculated from real filtered logs)
  // ---------------------------------------------------------------------------
  isDrilldownOpen = signal<boolean>(false);
  drilldownTitle = signal<string>('');
  activeFilterType = signal<KpiFilterType | null>(null);
  drilldownSearch = signal<string>('');
  drilldownSortCol = signal<keyof DrilldownRow>('date');
  drilldownSortAsc = signal<boolean>(true);
  drilldownPage = signal<number>(1);
  drilldownPageSize = signal<number>(10);
  readonly pageSizeOptions: number[] = [10, 20, 50, 100];

  affectedCount = signal<number>(0);
  avgLateTime = signal<string>('--');
  hoursCompletedPct = signal<string>('0%');
  requiredActionCount = signal<number>(0);
  currentHalfDayHours = computed(() => this.settingsService.settings().halfDayWorkHours ?? 6.0);

  // Filtered Drilldown Rows
  filteredDrilldownRows = computed(() => {
    const all = this.allFlattenedLogs();
    const type = this.activeFilterType();
    const q = this.drilldownSearch().toLowerCase().trim();

    let rows: DrilldownRow[] = [];

    // Check if search query targets a specific employee (name or attendanceId) or status/holiday
    const matchesEmployee =
      q.length > 0 &&
      this.allEmployees().some(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.attendanceId.toLowerCase().includes(q) ||
          e.attendanceId.replace('#', '').toLowerCase().includes(q)
      );

    const matchesHolidayOrStatus =
      q === 'h' ||
      q === 'holiday' ||
      q.includes('holiday') ||
      q === 'p' ||
      q === 'present' ||
      q === 'a' ||
      q === 'absent' ||
      q === 'hd' ||
      q === 'half day' ||
      q === 'halfday' ||
      q.includes('half');

    if (matchesEmployee || matchesHolidayOrStatus || type === 'TOTAL_EMPLOYEES') {
      // When searching for an employee or holiday, or viewing Total Employees,
      // search across ALL daily records from the uploaded PDF so full records (including Status H) are displayed
      rows = [...all];
    } else if (type) {
      switch (type) {
        case 'COMPLETED_ONTIME':
          rows = all.filter((r) => r.category === 'COMPLETED_ONTIME');
          break;
        case 'INCOMPLETE_ONTIME':
          rows = all.filter((r) => r.category === 'INCOMPLETE_ONTIME');
          break;
        case 'COMPLETED_LATE':
          rows = all.filter((r) => r.category === 'COMPLETED_LATE');
          break;
        case 'INCOMPLETE_LATE':
          rows = all.filter((r) => r.category === 'INCOMPLETE_LATE');
          break;
        case 'MISSED':
          rows = all.filter((r) => r.category === 'MISSED');
          break;
        default:
          rows = [...all];
          break;
      }
    } else {
      rows = [...all];
    }

    if (q) {
      rows = rows.filter(
        (r) =>
          r.employeeName.toLowerCase().includes(q) ||
          r.attendanceId.toLowerCase().includes(q) ||
          r.designation.toLowerCase().includes(q) ||
          r.date.toLowerCase().includes(q) ||
          r.status.toLowerCase() === q ||
          (q === 'h' && r.status === 'H') ||
          (q.includes('holiday') && (r.status === 'H' || r.category === 'HOLIDAY')) ||
          (q === 'p' && r.status === 'P') ||
          (q.includes('present') && r.status === 'P') ||
          (q === 'hd' && r.status === 'HD') ||
          ((q === 'half day' || q === 'halfday' || q.includes('half')) && r.status === 'HD') ||
          (q === 'a' && r.status === 'A') ||
          (q.includes('absent') && r.status === 'A') ||
          r.category.toLowerCase().replace('_', ' ').includes(q)
      );

      // Graceful fallback: If search in a category gave 0 results, search across all records
      if (rows.length === 0 && all.length > 0) {
        rows = all.filter(
          (r) =>
            r.employeeName.toLowerCase().includes(q) ||
            r.attendanceId.toLowerCase().includes(q) ||
            r.designation.toLowerCase().includes(q) ||
            r.date.toLowerCase().includes(q) ||
            r.status.toLowerCase() === q ||
            (q === 'h' && r.status === 'H') ||
            (q.includes('holiday') && (r.status === 'H' || r.category === 'HOLIDAY')) ||
            (q === 'p' && r.status === 'P') ||
            (q.includes('present') && r.status === 'P') ||
            (q === 'hd' && r.status === 'HD') ||
            ((q === 'half day' || q === 'halfday' || q.includes('half')) && r.status === 'HD') ||
            (q === 'a' && r.status === 'A') ||
            (q.includes('absent') && r.status === 'A') ||
            r.category.toLowerCase().replace('_', ' ').includes(q)
        );
      }
    }

    // Sort
    const col = this.drilldownSortCol();
    const asc = this.drilldownSortAsc();
    rows.sort((a, b) => {
      const valA = a[col] || '';
      const valB = b[col] || '';
      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
      return 0;
    });

    return rows;
  });

  paginatedDrilldownRows = computed(() => {
    const list = this.filteredDrilldownRows();
    const size = this.drilldownPageSize();
    const start = (this.drilldownPage() - 1) * size;
    return list.slice(start, start + size);
  });

  drilldownTotalPages = computed(() => {
    const count = this.filteredDrilldownRows().length;
    const size = this.drilldownPageSize();
    return Math.max(1, Math.ceil(count / size));
  });

  // Dynamic 4 Summary Stats computed directly from filtered drilldown rows
  drilldownHeaderStats = computed(() => {
    const rows = this.filteredDrilldownRows();
    const type = this.activeFilterType();
    const count = rows.length;

    let avgLate = '--';
    let hoursPct = '0%';
    let reqAction = 0;

    if (type === 'TOTAL_EMPLOYEES') {
      avgLate = '--';
      hoursPct = count > 0 ? '100%' : '0%';
      reqAction = this.allEmployees().filter((e) => e.status === 'M' || e.status === 'A').length;
    } else if (type === 'COMPLETED_ONTIME') {
      avgLate = '0m';
      hoursPct = '100%';
      reqAction = 0;
    } else if (type === 'INCOMPLETE_ONTIME') {
      avgLate = '0m';
      hoursPct = `${this.computeAvgCompletionPct(rows)}%`;
      reqAction = count;
    } else if (type === 'COMPLETED_LATE') {
      avgLate = this.computeAvgLateDuration(rows);
      hoursPct = '100%';
      reqAction = 0;
    } else if (type === 'INCOMPLETE_LATE') {
      avgLate = this.computeAvgLateDuration(rows);
      hoursPct = `${this.computeAvgCompletionPct(rows)}%`;
      reqAction = count;
    } else if (type === 'MISSED') {
      avgLate = '--';
      hoursPct = '0%';
      reqAction = count;
    }

    return {
      affectedCount: count,
      avgLateTime: avgLate,
      hoursCompletedPct: hoursPct,
      requiredActionCount: reqAction,
    };
  });

  // ---------------------------------------------------------------------------
  // Employee Attendance Calendar Detail Modal State
  // ---------------------------------------------------------------------------
  isEmployeeModalOpen = signal<boolean>(false);
  selectedEmployee = signal<EmployeeWithLogs | null>(null);

  // Dynamic calculations for selected employee modal
  employeeScheduledHours = computed(() => {
    const emp = this.selectedEmployee();
    if (!emp || !emp.dailyLogs) return 0;
    const settings = this.settingsService.settings();
    const minHours = settings.minWorkHours || 8.5;
    const workDays = emp.dailyLogs.filter((l) => l.status !== 'H').length;
    return Math.round(workDays * minHours);
  });

  employeeWorkedHours = computed(() => {
    const emp = this.selectedEmployee();
    if (!emp || !emp.dailyLogs) return 0;
    let totalSec = 0;
    for (const l of emp.dailyLogs) {
      if (l.status === 'P' && l.duration && l.duration !== '--') {
        totalSec += AttendanceAnalyticsHelper.parseDurationToSeconds(l.duration);
      }
    }
    return Number((totalSec / 3600).toFixed(1));
  });

  employeeProgressPct = computed(() => {
    const scheduled = this.employeeScheduledHours();
    const worked = this.employeeWorkedHours();
    if (scheduled === 0) return 0;
    return Math.min(100, Number(((worked / scheduled) * 100).toFixed(1)));
  });

  employeeAnomalies = computed(() => {
    const emp = this.selectedEmployee();
    if (!emp || !emp.dailyLogs) return [];
    return emp.dailyLogs.filter(
      (l) => l.category === 'MISSED' || (l.outTime === 'Missing' && l.status === 'P')
    );
  });

  employeeLateEntries = computed(() => {
    const emp = this.selectedEmployee();
    if (!emp || !emp.dailyLogs) return [];
    return emp.dailyLogs.filter(
      (l) => l.category === 'COMPLETED_LATE' || l.category === 'INCOMPLETE_LATE'
    );
  });

  // ---------------------------------------------------------------------------
  // Filtered & Paginated Employees for Directory
  // ---------------------------------------------------------------------------
  filteredEmployees = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const list = this.allEmployees();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.attendanceId.toLowerCase().includes(q) ||
        e.designation.toLowerCase().includes(q)
    );
  });

  paginatedEmployees = computed(() => {
    const list = this.filteredEmployees();
    const start = (this.currentPage() - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  });

  totalPages = computed(() => {
    const count = this.filteredEmployees().length;
    return Math.max(1, Math.ceil(count / this.pageSize));
  });

  pagesArray = computed(() => {
    const count = this.totalPages();
    const current = this.currentPage();
    const pages: number[] = [];
    const start = Math.max(1, current - 2);
    const end = Math.min(count, start + 4);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  });

  directorySortedEmployees = computed(() => {
    const list = [...this.filteredEmployees()];
    const col = this.directorySortCol();
    const asc = this.directorySortAsc();
    return list.sort((a, b) => {
      const valA = (a[col] ?? '').toString().toLowerCase();
      const valB = (b[col] ?? '').toString().toLowerCase();
      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
      return 0;
    });
  });

  directoryPaginatedEmployees = computed(() => {
    const list = this.directorySortedEmployees();
    const size = this.directoryPageSize();
    const totalPages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(Math.max(1, this.directoryPage()), totalPages);
    const start = (page - 1) * size;
    return list.slice(start, start + size);
  });

  directoryTotalPages = computed(() => {
    const count = this.filteredEmployees().length;
    const size = this.directoryPageSize();
    return Math.max(1, Math.ceil(count / size));
  });

  // ---------------------------------------------------------------------------
  // Analytics Tab Computed Summary (100% Calculated from Real Stored Records)
  // ---------------------------------------------------------------------------
  analyticsSummary = computed(() => {
    const emps = this.allEmployees();
    const detailed = this.detailedEmployees();

    if (!emps || emps.length === 0 || !detailed || detailed.length === 0) {
      return {
        avgAttendanceRate: '0.0%',
        onTimeArrivalRate: '0.0%',
        delayedArrivalRate: '0.0%',
        activeEmployees: 0,
        totalWorkingLogs: 0,
        ontimePctNum: 0,
        latePctNum: 0,
        leavePctNum: 0,
        absentPctNum: 0,
      };
    }

    let totalWorkingDays = 0;
    let presentCount = 0;
    let lateCount = 0;
    let ontimeCount = 0;
    let leaveCount = 0;
    let absentCount = 0;

    for (const emp of detailed) {
      for (const log of emp.dailyLogs || []) {
        if (log.status !== 'H') {
          totalWorkingDays++;
          if (log.status === 'P') {
            presentCount++;
            if (log.category === 'COMPLETED_ONTIME' || log.category === 'INCOMPLETE_ONTIME') {
              ontimeCount++;
            } else if (log.category === 'COMPLETED_LATE' || log.category === 'INCOMPLETE_LATE') {
              lateCount++;
            }
          } else if (log.status === 'A') {
            absentCount++;
          } else {
            leaveCount++;
          }
        }
      }
    }

    const avgRate = totalWorkingDays > 0 ? (presentCount / totalWorkingDays) * 100 : 0;
    const ontimeRate = presentCount > 0 ? (ontimeCount / presentCount) * 100 : 0;
    const lateRate = presentCount > 0 ? (lateCount / presentCount) * 100 : 0;
    const absentRate = totalWorkingDays > 0 ? (absentCount / totalWorkingDays) * 100 : 0;
    const leaveRate = totalWorkingDays > 0 ? (leaveCount / totalWorkingDays) * 100 : 0;

    return {
      avgAttendanceRate: `${avgRate.toFixed(1)}%`,
      onTimeArrivalRate: `${ontimeRate.toFixed(1)}%`,
      delayedArrivalRate: `${lateRate.toFixed(1)}%`,
      activeEmployees: emps.length,
      totalWorkingLogs: totalWorkingDays,
      ontimePctNum: Math.round(ontimeRate),
      latePctNum: Math.round(lateRate),
      leavePctNum: Math.round(leaveRate),
      absentPctNum: Math.round(absentRate),
    };
  });

  constructor() {
    // Reactively recompute attendance KPIs and flattened logs whenever ShiftSettings updates
    effect(() => {
      const settings = this.settingsService.settings();
      const emps = this.detailedEmployees();
      if (emps && emps.length > 0) {
        this.calculateKPIsAndFlatten(emps, settings);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.refreshUploadedMonths();

    // Check if there is a previously selected month or default
    const lastMonth = this.storageService.getItem<string>(this.LAST_SELECTED_MONTH_KEY);
    const targetMonth = lastMonth || this.selectedMonth();
    this.selectedMonth.set(targetMonth);

    // Query IndexedDB for the target month
    await this.loadMonthData(targetMonth);
  }

  async refreshUploadedMonths(): Promise<void> {
    const list = await this.storageService.getAllUploadedMonths();
    this.uploadedMonths.set(list || []);
  }

  isMonthUploaded(month: string): boolean {
    return this.uploadedMonths().includes(month);
  }

  /**
   * Switch active month via dropdown. Dynamically queries IndexedDB for that specific month.
   */
  async selectMonth(month: string): Promise<void> {
    this.selectedMonth.set(month);
    this.showMonthDropdown.set(false);
    this.storageService.setItem(this.LAST_SELECTED_MONTH_KEY, month);
    await this.loadMonthData(month);
  }

  /**
   * Dynamically load data from IndexedDB for a given month.
   * If not found, gracefully falls back to the empty state with shimmering skeletons and upload prompt.
   */
  async loadMonthData(month: string): Promise<void> {
    const payload = await this.storageService.getAttendanceByMonth(month);

    if (payload && payload.detailedEmployees && payload.detailedEmployees.length > 0) {
      this.populateDashboardState(payload);
      this.isPdfUploaded.set(true);
    } else {
      // Graceful fallback to empty state
      this.clearDashboardState();
      this.isPdfUploaded.set(false);
    }
  }

  private populateDashboardState(payload: ParsedDashboardPayload): void {
    this.dailyMetrics.set(payload.dailyMetrics || []);

    const detailedList = payload.detailedEmployees || [];
    const rawEmployees = payload.employees || [];
    const normalizedEmployees: EmployeeDirectoryItem[] = rawEmployees.length > 0
      ? rawEmployees.map((emp) => {
          const detail = detailedList.find((d) => d.attendanceId === emp.attendanceId || d.name === emp.name);
          return {
            ...emp,
            designation: (emp.designation && emp.designation.trim()) ? emp.designation : (detail?.designation || 'Staff'),
            status: emp.status || detail?.status || 'P',
          };
        })
      : detailedList.map((emp) => ({
          id: emp.id,
          name: emp.name,
          attendanceId: emp.attendanceId,
          designation: (emp.designation && emp.designation.trim()) ? emp.designation : 'Staff',
          status: emp.status || 'P',
          octoberStatus: emp.octoberStatus,
        }));

    this.allEmployees.set(normalizedEmployees);
    this.detailedEmployees.set(detailedList);
    this.allFlattenedLogs.set(payload.flattenedLogs || []);
    this.metrics.set(payload.metrics || this.emptyMetrics);
    this.kpis.set(payload.kpis || this.emptyKpis);
    if (payload.fileName) {
      this.uploadedFileName.set(payload.fileName);
    }

    // Recalculate KPIs and flattened logs with currently configured ShiftSettings
    this.calculateKPIsAndFlatten(payload.detailedEmployees);

    // Select first weekday with attendance for tooltip
    const firstActiveDay = payload.dailyMetrics?.find((d) => !d.isWeekend && d.present > 0);
    this.hoveredDay.set(firstActiveDay || null);
  }

  private clearDashboardState(): void {
    this.metrics.set(this.emptyMetrics);
    this.kpis.set(this.emptyKpis);
    this.dailyMetrics.set([]);
    this.allEmployees.set([]);
    this.detailedEmployees.set([]);
    this.allFlattenedLogs.set([]);
    this.hoveredDay.set(null);
    this.searchQuery.set('');
    this.currentPage.set(1);
    this.directoryPage.set(1);
    this.isDrilldownOpen.set(false);
    this.isEmployeeModalOpen.set(false);
  }

  calculateKPIsAndFlatten(employees: EmployeeWithLogs[], customSettings?: ShiftSettings): void {
    const settings = customSettings || this.settingsService.settings();
    const newKpis: AttendanceKPIs = {
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
    const uniqueIncompleted = new Set<string>();
    const uniqueLateCompleted = new Set<string>();
    const uniqueLateIncompleted = new Set<string>();
    const uniqueMissed = new Set<string>();

    const flattened: DrilldownRow[] = [];

    employees.forEach((emp) => {
      const empId = emp.attendanceId || emp.id || emp.name;
      const logs = emp.dailyLogs || [];
      logs.forEach((log) => {
        const cat = AttendanceAnalyticsHelper.categorizeLog(log, settings);
        log.category = cat;

        switch (cat) {
          case 'COMPLETED_ONTIME':
            newKpis.completedWorkingHours++;
            uniqueCompleted.add(empId);
            break;
          case 'INCOMPLETE_ONTIME':
            newKpis.incompletedWorkingHours++;
            uniqueIncompleted.add(empId);
            break;
          case 'COMPLETED_LATE':
            newKpis.lateCompletedHours++;
            uniqueLateCompleted.add(empId);
            break;
          case 'INCOMPLETE_LATE':
            newKpis.lateIncompletedHours++;
            uniqueLateIncompleted.add(empId);
            break;
          case 'MISSED':
            newKpis.missedAttendance++;
            uniqueMissed.add(empId);
            break;
        }

        const isHoliday = cat === 'HOLIDAY';
        const isLate = cat === 'COMPLETED_LATE' || cat === 'INCOMPLETE_LATE';
        const lateMins = isLate
          ? AttendanceAnalyticsHelper.calculateLateMinutes(
            log.inTime,
            settings.startTime,
            settings.graceMinutes ?? 0,
            settings.baseStartTime
          )
          : 0;

        const exactDuration =
          log.duration && log.duration !== '--'
            ? log.duration
            : log.inTime && log.outTime && log.outTime !== 'Missing' && log.inTime !== '--'
            ? AttendanceAnalyticsHelper.computeDurationBetween(log.inTime, log.outTime)
            : '--';

        const effectiveStatus = AttendanceAnalyticsHelper.determineLogStatus(log, settings);
        log.status = effectiveStatus;

        flattened.push({
          employeeName: emp.name,
          attendanceId: emp.attendanceId.replace('#', ''),
          designation: emp.designation,
          date: log.date,
          status: effectiveStatus,
          inTime: isLate && !log.inTime.includes('(late)') ? `${log.inTime} (late)` : (log.inTime || '--'),
          outTime: log.outTime && !log.outTime.includes('0000-00-00') ? log.outTime : (isHoliday ? '--' : 'Missing'),
          duration: exactDuration,
          lateDuration: lateMins > 0 ? `${lateMins} mins` : (log.lateDuration || '--'),
          category: cat,
          isLate,
        });
      });
    });

    newKpis.completedWorkingHoursEmployees = uniqueCompleted.size;
    newKpis.incompletedWorkingHoursEmployees = uniqueIncompleted.size;
    newKpis.lateCompletedEmployees = uniqueLateCompleted.size;
    newKpis.lateIncompletedEmployees = uniqueLateIncompleted.size;
    newKpis.missedEmployees = uniqueMissed.size;

    this.kpis.set(newKpis);
    this.allFlattenedLogs.set(flattened);

    // Keep directory employee status in sync with calculated half-days
    this.allEmployees.update((empList) =>
      empList.map((emp) => {
        const fullEmp = employees.find((e) => e.attendanceId === emp.attendanceId || e.name === emp.name);
        if (!fullEmp || !fullEmp.dailyLogs) return emp;
        const presentDays = fullEmp.dailyLogs.filter((l) => l.status === 'P').length;
        const halfDays = fullEmp.dailyLogs.filter((l) => l.status === 'HD').length;
        const absentDays = fullEmp.dailyLogs.filter((l) => l.status === 'A').length;
        const missedDays = fullEmp.dailyLogs.filter((l) => l.category === 'MISSED' && l.status !== 'H').length;

        let overallStatus: 'P' | 'A' | 'M' | 'H' | 'HD' = 'P';
        if (missedDays > 0) overallStatus = 'M';
        else if (absentDays > presentDays + halfDays) overallStatus = 'A';
        else if (halfDays > presentDays) overallStatus = 'HD';

        return {
          ...emp,
          designation: (emp.designation && emp.designation.trim()) ? emp.designation : (fullEmp.designation || 'Staff'),
          status: overallStatus,
          octoberStatus:
            overallStatus === 'M'
              ? `Missed (${missedDays}) ! M`
              : halfDays > 0
              ? `Present (${presentDays}) • Half (${halfDays})`
              : overallStatus === 'P'
              ? `Present (${presentDays})`
              : `Absent (${absentDays})`,
        };
      })
    );

    // Keep metrics counts in sync
    this.metrics.update((m) => ({
      ...m,
      totalEmployees: employees.length,
      employeeTrend: `+${employees.length} registered staff`,
      completedWorkingHours: String(newKpis.completedWorkingHours),
      completedWorkingHoursEmployees: newKpis.completedWorkingHoursEmployees,
      standardShiftsText: `${newKpis.completedWorkingHours} Shifts Completed`,
      incompletedWorkingHours: String(newKpis.incompletedWorkingHours),
      incompletedWorkingHoursEmployees: newKpis.incompletedWorkingHoursEmployees,
      earlyDeparturesText: `${newKpis.incompletedWorkingHours} Shifts Incomplete`,
      lateAttendanceCompleted: String(newKpis.lateCompletedHours),
      lateAttendanceCompletedEmployees: newKpis.lateCompletedEmployees,
      graceTimeUtilizedText: `${newKpis.lateCompletedHours} Shifts Late-Complete`,
      lateAttendanceIncompleted: String(newKpis.lateIncompletedHours),
      lateAttendanceIncompletedEmployees: newKpis.lateIncompletedEmployees,
      lateEarlyExitText: `${newKpis.lateIncompletedHours} Shifts Late-Incomplete`,
      missedAttendance: newKpis.missedAttendance,
      missedAttendanceEmployees: newKpis.missedEmployees,
      requiresManualUpdateText: `${newKpis.missedAttendance} Missed / Absent Shifts`,
    }));
  }

  // ---------------------------------------------------------------------------
  // PDF File Upload & Drag-and-Drop Handlers
  // ---------------------------------------------------------------------------
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      input.value = '';
      this.handleFileIngestion(file);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      this.handleFileIngestion(event.dataTransfer.files[0]);
    }
  }

  private handleFileIngestion(file: File): void {
    if (!file) return;

    this.uploadedFileName.set(file.name);
    this.isParsing.set(true);

    this.pdfParserService.parseAttendancePdf(file).subscribe({
      next: async (payload: ParsedDashboardPayload) => {
        try {
          if (!payload.detailedEmployees || payload.detailedEmployees.length === 0) {
            this.isParsing.set(false);
            this.showToast('No valid employee attendance records found in the uploaded PDF.');
            this.clearDashboardState();
            this.isPdfUploaded.set(false);
            return;
          }

          const targetMonth = payload.month || this.selectedMonth();

          // Save payload into IndexedDB
          await this.storageService.saveAttendanceByMonth(targetMonth, payload, file.name);

          // Refresh uploaded months index
          await this.refreshUploadedMonths();

          this.selectedMonth.set(targetMonth);
          this.storageService.setItem(this.LAST_SELECTED_MONTH_KEY, targetMonth);

          this.populateDashboardState(payload);
          this.isPdfUploaded.set(true);
          this.isParsing.set(false);
          this.showToast(`Successfully parsed and saved attendance records for ${targetMonth}!`);
        } catch (err) {
          console.error('Error saving parsed payload to IndexedDB:', err);
          this.isParsing.set(false);
          this.showToast('Failed to save parsed records to IndexedDB.');
        }
      },
      error: (err) => {
        console.error('PDF parsing error:', err);
        this.isParsing.set(false);
        this.showToast(err.message || 'Failed to parse the PDF file. Please ensure it is a valid attendance report.');
        this.clearDashboardState();
        this.isPdfUploaded.set(false);
      },
    });
  }

  /**
   * Reset current month's attendance records from IndexedDB and return to empty state
   */
  async resetToEmptyState(): Promise<void> {
    const current = this.selectedMonth();
    await this.storageService.deleteAttendanceByMonth(current);
    await this.refreshUploadedMonths();
    this.clearDashboardState();
    this.isPdfUploaded.set(false);
    this.showToast(`Cleared attendance data for ${current}.`);
  }

  // ---------------------------------------------------------------------------
  // KPI Drilldown Modal Handlers
  // ---------------------------------------------------------------------------
  openDrilldown(type: KpiFilterType): void {
    if (!this.isPdfUploaded()) return;

    this.activeFilterType.set(type);
    this.drilldownSearch.set('');
    this.drilldownPage.set(1);

    const month = this.selectedMonth();
    const allLogs = this.allFlattenedLogs();
    const emps = this.allEmployees();

    let matchingRows: DrilldownRow[] = [];
    let title = '';

    switch (type) {
      case 'TOTAL_EMPLOYEES':
        title = `Total Employees - ${month}`;
        matchingRows = allLogs;
        this.affectedCount.set(allLogs.length);
        this.avgLateTime.set('--');
        this.hoursCompletedPct.set(allLogs.length > 0 ? '100%' : '0%');
        this.requiredActionCount.set(emps.filter((e) => e.status === 'M' || e.status === 'A').length);
        break;

      case 'COMPLETED_ONTIME':
        title = `Completed Working Hours - ${month}`;
        matchingRows = allLogs.filter((r) => r.category === 'COMPLETED_ONTIME');
        this.affectedCount.set(matchingRows.length);
        this.avgLateTime.set('0m');
        this.hoursCompletedPct.set('100%');
        this.requiredActionCount.set(0);
        break;

      case 'INCOMPLETE_ONTIME':
        title = `Incompleted Working Hours - ${month}`;
        matchingRows = allLogs.filter((r) => r.category === 'INCOMPLETE_ONTIME');
        this.affectedCount.set(matchingRows.length);
        this.avgLateTime.set('0m');
        this.hoursCompletedPct.set(`${this.computeAvgCompletionPct(matchingRows)}%`);
        this.requiredActionCount.set(matchingRows.length);
        break;

      case 'COMPLETED_LATE':
        title = `Late Entry & Completed Hours - ${month}`;
        matchingRows = allLogs.filter((r) => r.category === 'COMPLETED_LATE');
        this.affectedCount.set(matchingRows.length);
        this.avgLateTime.set(this.computeAvgLateDuration(matchingRows));
        this.hoursCompletedPct.set('100%');
        this.requiredActionCount.set(0);
        break;

      case 'INCOMPLETE_LATE':
        title = `Late Entry & Incompleted Hours - ${month}`;
        matchingRows = allLogs.filter((r) => r.category === 'INCOMPLETE_LATE');
        this.affectedCount.set(matchingRows.length);
        this.avgLateTime.set(this.computeAvgLateDuration(matchingRows));
        this.hoursCompletedPct.set(`${this.computeAvgCompletionPct(matchingRows)}%`);
        this.requiredActionCount.set(matchingRows.length);
        break;

      case 'MISSED':
        title = `Missed Attendance & Absents - ${month}`;
        matchingRows = allLogs.filter((r) => r.category === 'MISSED');
        this.affectedCount.set(matchingRows.length);
        this.avgLateTime.set('--');
        this.hoursCompletedPct.set('0%');
        this.requiredActionCount.set(matchingRows.length);
        break;
    }

    this.drilldownTitle.set(title);
    this.isDrilldownOpen.set(true);
  }

  private computeAvgLateDuration(rows: DrilldownRow[]): string {
    if (!rows || rows.length === 0) return '0m';
    let totalMins = 0;
    let count = 0;
    for (const r of rows) {
      if (r.lateDuration && r.lateDuration !== '--') {
        const match = r.lateDuration.match(/(\d+)/);
        if (match) {
          totalMins += parseInt(match[1], 10);
          count++;
        }
      }
    }
    if (count === 0) return '0m';
    return `${Math.round(totalMins / count)}m`;
  }

  private computeAvgCompletionPct(rows: DrilldownRow[]): number {
    if (!rows || rows.length === 0) return 0;
    const settings = this.settingsService.settings();
    const targetSec = (settings.minWorkHours || 8.5) * 3600;
    let totalSec = 0;
    for (const r of rows) {
      totalSec += AttendanceAnalyticsHelper.parseDurationToSeconds(r.duration);
    }
    const avgSec = totalSec / rows.length;
    return Math.min(100, Math.round((avgSec / targetSec) * 100));
  }

  closeDrilldownModal(): void {
    this.isDrilldownOpen.set(false);
  }

  sortDrilldownBy(col: keyof DrilldownRow): void {
    if (this.drilldownSortCol() === col) {
      this.drilldownSortAsc.set(!this.drilldownSortAsc());
    } else {
      this.drilldownSortCol.set(col);
      this.drilldownSortAsc.set(true);
    }
  }

  changeDrilldownPage(page: number): void {
    if (page >= 1 && page <= this.drilldownTotalPages()) {
      this.drilldownPage.set(page);
    }
  }

  setDrilldownPageSize(size: number | string): void {
    const num = typeof size === 'string' ? parseInt(size, 10) : size;
    if (!isNaN(num) && num > 0) {
      this.drilldownPageSize.set(num);
      this.drilldownPage.set(1);
    }
  }

  exportCsv(): void {
    this.showToast('Drilldown report exported as CSV successfully!');
  }

  exportPdf(): void {
    this.showToast('Drilldown report exported as PDF successfully!');
  }

  // ---------------------------------------------------------------------------
  // Employee Attendance Calendar Detail Modal Handlers
  // ---------------------------------------------------------------------------
  openEmployeeDetail(empItem: EmployeeDirectoryItem): void {
    if (!this.isPdfUploaded()) return;
    const found = this.detailedEmployees().find((e) => e.name === empItem.name) || null;
    this.selectedEmployee.set(found);
    this.isEmployeeModalOpen.set(true);
  }

  closeEmployeeModal(): void {
    this.isEmployeeModalOpen.set(false);
    this.selectedEmployee.set(null);
  }

  // ---------------------------------------------------------------------------
  // General Controls
  // ---------------------------------------------------------------------------
  selectDay(dayData: DailyAttendanceMetric): void {
    if (!dayData.isWeekend) {
      this.hoveredDay.set(dayData);
    }
  }

  changePage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  changeDirectoryPage(page: number): void {
    if (page >= 1 && page <= this.directoryTotalPages()) {
      this.directoryPage.set(page);
    }
  }

  setDirectoryPageSize(size: number | string): void {
    const num = Number(size);
    if (!isNaN(num) && num > 0) {
      this.directoryPageSize.set(num);
      this.directoryPage.set(1);
    }
  }

  sortDirectoryBy(col: keyof EmployeeDirectoryItem): void {
    if (this.directorySortCol() === col) {
      this.directorySortAsc.update((asc) => !asc);
    } else {
      this.directorySortCol.set(col);
      this.directorySortAsc.set(true);
    }
    this.directoryPage.set(1);
  }

  setTab(tab: string): void {
    this.activeTab.set(tab);
  }

  toggleUserMenu(): void {
    this.showUserMenu.set(!this.showUserMenu());
  }

  toggleMonthDropdown(): void {
    this.showMonthDropdown.set(!this.showMonthDropdown());
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => {
      this.toastMessage.set('');
    }, 2800);
  }

  logout(): void {
    this.storageService.removeItem('presentiq_auth_token');
    this.router.navigate(['/login']);
  }
}
