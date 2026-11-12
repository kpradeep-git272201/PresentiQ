import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardComponent } from './dashboard.component';
import { Router } from '@angular/router';
import { StorageService } from '../../services/storage/storage.service';
import { PdfParserService, ParsedDashboardPayload } from '../../services/pdf-parser/pdf-parser.service';
import { of } from 'rxjs';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  const mockStorage = new Map<string, any>();
  const mockIndexedDb = new Map<string, ParsedDashboardPayload>();

  const routerMock = {
    navigate: (commands: any[]) => Promise.resolve(commands),
  };

  const storageServiceMock = {
    getItem: <T>(key: string): T | null => mockStorage.get(key) ?? null,
    setItem: (key: string, value: any) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
    hasItem: (key: string) => mockStorage.has(key),
    clear: () => {
      mockStorage.clear();
      mockIndexedDb.clear();
    },
    getAttendanceByMonth: (month: string): Promise<ParsedDashboardPayload | null> => {
      return Promise.resolve(mockIndexedDb.get(month) || null);
    },
    saveAttendanceByMonth: (month: string, payload: ParsedDashboardPayload, fileName?: string): Promise<void> => {
      mockIndexedDb.set(month, payload);
      return Promise.resolve();
    },
    getAllUploadedMonths: (): Promise<string[]> => {
      return Promise.resolve(Array.from(mockIndexedDb.keys()));
    },
    deleteAttendanceByMonth: (month: string): Promise<void> => {
      mockIndexedDb.delete(month);
      return Promise.resolve();
    },
  };

  beforeEach(async () => {
    mockStorage.clear();
    mockIndexedDb.clear();

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: StorageService, useValue: storageServiceMock },
        PdfParserService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the DashboardComponent', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize in empty state when no PDF has been uploaded for the month', () => {
    expect(component.isPdfUploaded()).toBe(false);
    expect(component.allEmployees().length).toBe(0);
    expect(component.dailyMetrics().length).toBe(0);
    expect(component.metrics().totalEmployees).toBe(0);
  });

  it('should dynamically render data when a month with stored records is loaded', async () => {
    const testPayload: ParsedDashboardPayload = {
      month: 'October 2026',
      fileName: 'Attendance_October_2026.pdf',
      employees: [
        { id: '1', name: 'Rajesh Kumar', attendanceId: '#1001', designation: 'Developer', status: 'P', octoberStatus: 'Present (20)' },
        { id: '2', name: 'Pooja Hegde', attendanceId: '#1002', designation: 'Designer', status: 'P', octoberStatus: 'Present (21)' },
      ],
      detailedEmployees: [
        {
          id: '1',
          name: 'Rajesh Kumar',
          attendanceId: '#1001',
          designation: 'Developer',
          status: 'P',
          dailyLogs: [
            { date: 'Oct 01, 2026', day: 1, status: 'P', inTime: '09:00:00', outTime: '17:30:00', duration: '08:30:00', category: 'COMPLETED_ONTIME' },
          ],
        },
      ],
      dailyMetrics: [{ day: 1, present: 1, leave: 0, absent: 0, isWeekend: false }],
      flattenedLogs: [],
      kpis: {
        totalEmployees: 2,
        completedWorkingHours: 1,
        incompletedWorkingHours: 0,
        lateCompletedHours: 0,
        lateIncompletedHours: 0,
        missedAttendance: 0,
      },
      metrics: {
        totalEmployees: 2,
        employeeTrend: '+2 staff',
        completedWorkingHours: '1',
        standardShiftsText: 'Standard Shifts',
        incompletedWorkingHours: '0',
        earlyDeparturesText: 'Early Departures',
        lateAttendanceCompleted: '0',
        graceTimeUtilizedText: 'Grace Utilized',
        lateAttendanceIncompleted: '0',
        lateEarlyExitText: 'Late + Early Exit',
        missedAttendance: 0,
        requiresManualUpdateText: 'Manual Update Req.',
      },
    };

    mockIndexedDb.set('October 2026', testPayload);
    await component.loadMonthData('October 2026');

    expect(component.isPdfUploaded()).toBe(true);
    expect(component.allEmployees().length).toBe(2);
    expect(component.metrics().totalEmployees).toBe(1);
    expect(component.dailyMetrics().length).toBe(1);
  });

  it('should gracefully fall back to empty state when switching to a month without uploaded PDF', async () => {
    // First load October with data
    component.isPdfUploaded.set(true);

    // Switch to September where no PDF has been uploaded
    await component.selectMonth('September 2026');

    expect(component.selectedMonth()).toBe('September 2026');
    expect(component.isPdfUploaded()).toBe(false);
    expect(component.allEmployees().length).toBe(0);
    expect(component.metrics().totalEmployees).toBe(0);
  });

  it('should filter employees correctly by search query', () => {
    component.allEmployees.set([
      { id: '1', name: 'Rajesh Kumar', attendanceId: '#1001', designation: 'Developer', status: 'P' },
      { id: '2', name: 'Pooja Hegde', attendanceId: '#1002', designation: 'Designer', status: 'P' },
    ]);

    component.searchQuery.set('Rajesh');
    const filtered = component.filteredEmployees();
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('Rajesh Kumar');
  });

  it('should paginate employees correctly', () => {
    component.allEmployees.set([
      { id: '1', name: 'Emp 1', attendanceId: '#1', designation: 'Dev', status: 'P' },
      { id: '2', name: 'Emp 2', attendanceId: '#2', designation: 'Dev', status: 'P' },
      { id: '3', name: 'Emp 3', attendanceId: '#3', designation: 'Dev', status: 'P' },
      { id: '4', name: 'Emp 4', attendanceId: '#4', designation: 'Dev', status: 'P' },
      { id: '5', name: 'Emp 5', attendanceId: '#5', designation: 'Dev', status: 'P' },
      { id: '6', name: 'Emp 6', attendanceId: '#6', designation: 'Dev', status: 'P' },
    ]);

    expect(component.totalPages()).toBe(2);
    expect(component.paginatedEmployees().length).toBe(5);
    component.changePage(2);
    expect(component.currentPage()).toBe(2);
    expect(component.paginatedEmployees().length).toBe(1);
  });

  it('should reset back to empty state when resetToEmptyState is called', async () => {
    component.isPdfUploaded.set(true);
    await component.resetToEmptyState();

    expect(component.isPdfUploaded()).toBe(false);
    expect(component.allEmployees().length).toBe(0);
  });
});
