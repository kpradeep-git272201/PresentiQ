import '@angular/compiler';
import { describe, it, expect, beforeEach } from 'vitest';
import { PdfParserService } from './pdf-parser.service';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs';

describe('PdfParserService - Strict MoPR Report Format Enforcement', () => {
  let service: PdfParserService;

  beforeEach(() => {
    service = new PdfParserService();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should strictly reject invalid non-MoPR PDF files', async () => {
    const invalidPdfContent = '%PDF-1.4\n1 0 obj\n<< /Title (Invoice 12345) /Author (Billing) >>\nendobj\ntrailer\n<<>>\n%%EOF';
    const fakeFile = new File([invalidPdfContent], 'invoice_october.pdf', { type: 'application/pdf' });

    await expect(firstValueFrom(service.parseAttendancePdf(fakeFile))).rejects.toThrow(
      'Invalid PDF format. Only Employee Detailed Attendance Report (Ministry of Panchayati Raj / NIC Biometric format) is allowed.'
    );
  });

  it('should strictly reject generic text documents uploaded as PDF', async () => {
    const randomContent = 'This is a sample document for testing purpose. No biometric table.';
    const fakeFile = new File([randomContent], 'notes.pdf', { type: 'application/pdf' });

    await expect(firstValueFrom(service.parseAttendancePdf(fakeFile))).rejects.toThrow(
      'Invalid PDF format. Only Employee Detailed Attendance Report (Ministry of Panchayati Raj / NIC Biometric format) is allowed.'
    );
  });

  it('should successfully parse authentic MoPR Reference Report PDF', async () => {
    const referencePdfPath = 'C:/Users/admin/.gemini/antigravity/brain/e218ac84-4b50-43ce-b963-d392bc2d1e6d/.user_uploaded/media_1794459903344_f5160fae.pdf';

    if (fs.existsSync(referencePdfPath)) {
      const buffer = fs.readFileSync(referencePdfPath);
      const file = new File([buffer], 'Employee_Detailed_report_015174_20261030110154.pdf', {
        type: 'application/pdf',
      });

      const payload = await firstValueFrom(service.parseAttendancePdf(file));

      expect(payload).toBeTruthy();
      expect(payload.month).toBe('October 2026');
      expect(payload.detailedEmployees.length).toBe(77);
      expect(payload.employees.length).toBe(77);

      // Verify Aakash Jaiswal
      const aakash = payload.detailedEmployees.find((e) => e.name.includes('Aakash Jaiswal'));
      expect(aakash).toBeDefined();
      expect(aakash?.roleId).toBe('182210');
      expect(aakash?.designation).toContain('Tester');

      // Verify Aakash Jaiswal's Day 29 Missed Punch
      const aakashDay29 = aakash?.dailyLogs.find((l) => l.day === 29);
      expect(aakashDay29).toBeDefined();
      expect(aakashDay29?.outTime).toBe('Missing');
      expect(aakashDay29?.category).toBe('MISSED');
      expect(aakash?.status).toBe('M');

      // Verify KPIs and Employee Counts are populated
      expect(payload.kpis.totalEmployees).toBe(77);
      expect(payload.kpis.completedWorkingHoursEmployees).toBeGreaterThan(0);
      expect(payload.kpis.missedEmployees).toBeGreaterThan(0);
      expect(payload.metrics.completedWorkingHoursEmployees).toBeGreaterThan(0);
      expect(payload.kpis.missedAttendance).toBeGreaterThan(0);
      expect(payload.dailyMetrics.length).toBe(31);
    }
  });
});
