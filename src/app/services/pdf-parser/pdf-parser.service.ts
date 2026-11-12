import { Injectable } from '@angular/core';
import { Observable, from, throwError } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import {
  AttendanceRecord,
  AttendanceSummary,
  EmployeeDirectoryItem,
  DailyAttendanceMetric,
  DetailedDashboardMetrics,
} from '../../models/attendance.model';
import { DrilldownRow, AttendanceKPIs } from '../../models/drilldown.model';
import { SettingsService } from '../settings/settings.service';
import { AttendanceAnalyticsHelper } from '../analytics/attendance-analytics.helper';

export interface EmployeeWithLogs extends EmployeeDirectoryItem {
  avatar?: string;
  roleId?: string;
  organization?: string;
  dailyLogs: Array<{
    date: string;
    day: number;
    status: 'P' | 'A' | 'H';
    inTime: string;
    outTime: string;
    duration: string;
    lateDuration?: string;
    category?: string;
  }>;
}

export interface ParsedDashboardPayload {
  metrics: DetailedDashboardMetrics;
  kpis: AttendanceKPIs;
  dailyMetrics: DailyAttendanceMetric[];
  employees: EmployeeDirectoryItem[];
  detailedEmployees: EmployeeWithLogs[];
  flattenedLogs: DrilldownRow[];
  month: string;
  fileName?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable({
  providedIn: 'root',
})
export class PdfParserService {
  constructor(private settingsService?: SettingsService) {}

  private getSettings(): any {
    return (
      this.settingsService?.settings() || {
        startTime: '09:00',
        endTime: '17:30',
        graceMinutes: 15,
        minWorkHours: 8.5,
      }
    );
  }

  /**
   * Parse an uploaded attendance report PDF file and extract structured attendance data.
   * Strictly allows ONLY the Employee Detailed Attendance Report (MoPR / NIC Biometric format).
   * Rejects any non-matching PDF files.
   */
  parseAttendancePdf(file: File): Observable<ParsedDashboardPayload> {
    if (!file) {
      return throwError(() => new Error('No file provided for parsing.'));
    }

    return from(file.arrayBuffer()).pipe(
      switchMap((buffer: ArrayBuffer) =>
        from(this.extractTextAndParse(buffer, file.name))
      )
    );
  }

  /**
   * Strict format validator: Checks whether the extracted text or raw PDF matches
   * the authentic "Employee Detailed Attendance Report" (MoPR / NIC format).
   */
  private validateReportFormat(extractedText: string, rawPdfHeader: string, fileName: string): boolean {
    const combined = (extractedText + '\n' + rawPdfHeader).toLowerCase();
    const fn = (fileName || '').toLowerCase();

    // Key signatures of this exact report format
    const hasReportTitle =
      combined.includes('employee detailed attendance report') ||
      fn.includes('employee_detailed_report');

    const hasMoPROrOrg =
      combined.includes('ministry of panchayati raj') ||
      combined.includes('mopr') ||
      combined.includes('facility management services') ||
      combined.includes('informatics division');

    const hasBiometricColumns =
      (combined.includes('attendance id') && combined.includes('designation')) ||
      (combined.includes('s.no') && combined.includes('in time') && combined.includes('out time'));

    // Valid if it meets the official report signature
    if (hasReportTitle || (hasMoPROrOrg && hasBiometricColumns)) {
      return true;
    }

    // Also valid if filename matches the authentic government report naming pattern
    if (/employee_detailed_report_\d+_\d+\.pdf/i.test(fileName)) {
      return true;
    }

    return false;
  }

  /**
   * Extract raw text from PDF ArrayBuffer (handling FlateDecode decompression)
   * and parse into structured attendance payload.
   */
  private async extractTextAndParse(
    buffer: ArrayBuffer,
    fileName: string
  ): Promise<ParsedDashboardPayload> {
    const rawText = await this.extractTextFromPdfBuffer(buffer);
    const latinHeader = new TextDecoder('latin1').decode(
      new Uint8Array(buffer.slice(0, Math.min(2048, buffer.byteLength)))
    );

    // 1. STRICT FORMAT VALIDATION: Only allow Employee Detailed Attendance Report format
    const isValidFormat = this.validateReportFormat(rawText, latinHeader, fileName);
    if (!isValidFormat) {
      throw new Error(
        'Invalid PDF format. Only Employee Detailed Attendance Report (Ministry of Panchayati Raj / NIC Biometric format) is allowed.'
      );
    }

    const monthInfo = this.extractMonthAndYear(rawText, fileName);
    const settings = this.getSettings();

    // 2. Parse real employees from the extracted text
    const employees = this.parseEmployeesFromText(rawText, monthInfo, settings);

    if (!employees || employees.length === 0) {
      throw new Error(
        `Unable to extract attendance records from "${fileName}". Please ensure the file contains valid employee attendance tables.`
      );
    }

    const payload = this.buildDashboardPayload(employees, monthInfo, settings, fileName);
    return payload;
  }

  // ---------------------------------------------------------------------------
  // PDF Text Extraction Engine with Safe Stream Decompression
  // ---------------------------------------------------------------------------
  private async extractTextFromPdfBuffer(buffer: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(buffer);
    const latinDecoder = new TextDecoder('latin1');
    const pdfRaw = latinDecoder.decode(bytes);

    const extractedChunks: string[] = [];

    const streamMarker = 'stream';
    const endStreamMarker = 'endstream';
    let searchPos = 0;

    while (searchPos < pdfRaw.length) {
      const streamIdx = pdfRaw.indexOf(streamMarker, searchPos);
      if (streamIdx === -1) break;

      // Extract dictionary text right before the stream keyword
      const dictText = pdfRaw.substring(Math.max(0, streamIdx - 200), streamIdx);
      const isFlate = dictText.includes('/FlateDecode');
      const lengthMatch = dictText.match(/\/Length\s+(\d+)/);

      let streamDataStart = streamIdx + streamMarker.length;
      if (bytes[streamDataStart] === 0x0d) streamDataStart++;
      if (bytes[streamDataStart] === 0x0a) streamDataStart++;

      let streamEnd = -1;
      if (lengthMatch) {
        const len = parseInt(lengthMatch[1], 10);
        if (len > 0 && streamDataStart + len <= bytes.length) {
          streamEnd = streamDataStart + len;
        }
      }

      if (streamEnd === -1) {
        const endStreamIdx = pdfRaw.indexOf(endStreamMarker, streamDataStart);
        if (endStreamIdx !== -1) {
          streamEnd = endStreamIdx;
          while (
            streamEnd > streamDataStart &&
            (bytes[streamEnd - 1] === 0x0a ||
              bytes[streamEnd - 1] === 0x0d ||
              bytes[streamEnd - 1] === 0x20 ||
              bytes[streamEnd - 1] === 0x00)
          ) {
            streamEnd--;
          }
        }
      }

      if (streamEnd > streamDataStart) {
        const streamBytes = bytes.slice(streamDataStart, streamEnd);

        if (isFlate) {
          try {
            const streamText = await this.decompressDeflateStream(streamBytes);
            if (streamText) {
              const textFromOperators = this.extractTextFromPdfContent(streamText);
              if (textFromOperators.trim()) {
                extractedChunks.push(textFromOperators);
              }
            }
          } catch {
            // Ignore non-standard streams (e.g. font binaries) without crashing
          }
        } else {
          // Uncompressed text stream
          const uncompressedText = latinDecoder.decode(streamBytes);
          const textFromOperators = this.extractTextFromPdfContent(uncompressedText);
          if (textFromOperators.trim()) {
            extractedChunks.push(textFromOperators);
          }
        }
      }

      const nextEnd = pdfRaw.indexOf(endStreamMarker, streamDataStart);
      searchPos = nextEnd !== -1 ? nextEnd + endStreamMarker.length : streamDataStart + 1;
    }

    // Also check uncompressed text outside streams
    const outsideText = this.extractTextFromPdfContent(pdfRaw);
    if (outsideText.trim()) {
      extractedChunks.push(outsideText);
    }

    return extractedChunks.join('\n');
  }

  /**
   * Decompress zlib/deflate stream bytes using native browser/node DecompressionStream
   */
  private async decompressDeflateStream(bytes: Uint8Array): Promise<string> {
    if (bytes.length === 0) return '';

    // Standard RFC 1950 zlib deflate
    try {
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        const writePromise = writer.write(bytes as any).then(() => writer.close());
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }

        await writePromise;

        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        return new TextDecoder('latin1').decode(merged);
      }
    } catch {
      // Fallback: Try raw deflate if zlib header was omitted
      try {
        if (typeof DecompressionStream !== 'undefined') {
          const dsRaw = new DecompressionStream('deflate-raw');
          const writer = dsRaw.writable.getWriter();
          const writePromise = writer.write(bytes as any).then(() => writer.close());
          const reader = dsRaw.readable.getReader();
          const chunks: Uint8Array[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }

          await writePromise;

          const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }

          return new TextDecoder('latin1').decode(merged);
        }
      } catch {
        // Return empty string on decompression failure
      }
    }

    return new TextDecoder('latin1').decode(bytes);
  }

  /**
   * Parse PDF text operators and map Td, TD, Tm, T*, ET to newlines
   */
  private extractTextFromPdfContent(content: string): string {
    let text = '';
    const regex =
      /(\((?:\\.|[^()\\])*\)|<[0-9a-fA-F\s]+>)\s*(Tj|'|")|(\[[\s\S]*?\])\s*TJ|(T\*|Td|TD|Tm|ET)/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) {
        text += this.decodePdfStringToken(match[1]) + ' ';
        if (match[2] === "'" || match[2] === '"') {
          text += '\n';
        }
      } else if (match[3]) {
        const arr = match[3];
        const strRegex = /(\((?:\\.|[^()\\])*\)|<[0-9a-fA-F\s]+>)/g;
        let sm: RegExpExecArray | null;
        while ((sm = strRegex.exec(arr)) !== null) {
          text += this.decodePdfStringToken(sm[1]) + ' ';
        }
      } else if (match[4]) {
        text += '\n';
      }
    }

    return text;
  }

  private decodePdfStringToken(token: string): string {
    if (token.startsWith('(')) {
      return token
        .slice(1, -1)
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
    } else if (token.startsWith('<')) {
      const hex = token.slice(1, -1).replace(/\s+/g, '');
      if (hex.length === 0) return '';
      try {
        const cleanHex = hex.length % 2 !== 0 ? hex + '0' : hex;
        const bytes = new Uint8Array(cleanHex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
        }
        if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
          return new TextDecoder('utf-16be').decode(bytes.slice(2));
        }
        if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[2] === 0x00) {
          return new TextDecoder('utf-16be').decode(bytes);
        }
        return new TextDecoder('latin1').decode(bytes);
      } catch {
        return '';
      }
    }
    return token;
  }

  // ---------------------------------------------------------------------------
  // Month & Metadata Parsing
  // ---------------------------------------------------------------------------
  private extractMonthAndYear(
    text: string,
    fileName: string
  ): { monthName: string; year: number; monthKey: string; daysInMonth: number } {
    // 1. Search in text for "Month & Year: 10 - 2026"
    const myMatch = text.match(/Month\s*&\s*Year\s*:\s*(\d{1,2})\s*[-/]\s*(\d{4})/i);
    if (myMatch) {
      const mNum = parseInt(myMatch[1], 10);
      const year = parseInt(myMatch[2], 10);
      if (mNum >= 1 && mNum <= 12) {
        const monthName = MONTH_NAMES[mNum - 1];
        const daysInMonth = new Date(year, mNum, 0).getDate();
        return {
          monthName,
          year,
          monthKey: `${monthName} ${year}`,
          daysInMonth,
        };
      }
    }

    // 2. Check filename for YYYYMMDD e.g. Employee_Detailed_report_015174_20261030110154.pdf -> 20261030 -> October 2026
    const fileDateMatch = fileName.match(/_(\d{4})(0[1-9]|1[0-2])\d{2}/);
    if (fileDateMatch) {
      const year = parseInt(fileDateMatch[1], 10);
      const mIdx = parseInt(fileDateMatch[2], 10) - 1;
      const monthName = MONTH_NAMES[mIdx];
      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
      return {
        monthName,
        year,
        monthKey: `${monthName} ${year}`,
        daysInMonth,
      };
    }

    // 3. Search in text content for named month e.g. "October 2026"
    const fullMonthRegex =
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s*[-_ ,]?\s*(\d{4})\b/i;
    let match = text.match(fullMonthRegex);

    if (!match) {
      const shortMonthRegex =
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s*[-_ ,]?\s*(\d{4})\b/i;
      match = text.match(shortMonthRegex);
    }

    if (!match) {
      match =
        fileName.match(fullMonthRegex) ||
        fileName.match(
          /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[-_ ]+(\d{4})\b/i
        );
    }

    let monthName = 'October';
    let year = 2026;

    if (match) {
      const rawMonth = match[1].toLowerCase();
      year = parseInt(match[2], 10);

      const foundIndex = MONTH_NAMES.findIndex((m) =>
        m.toLowerCase().startsWith(rawMonth.substring(0, 3))
      );
      if (foundIndex !== -1) {
        monthName = MONTH_NAMES[foundIndex];
      }
    }

    const monthIndex = MONTH_NAMES.indexOf(monthName);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    return {
      monthName,
      year,
      monthKey: `${monthName} ${year}`,
      daysInMonth,
    };
  }

  // ---------------------------------------------------------------------------
  // Employee Attendance Records Parser (MoPR / NIC Biometric Format)
  // ---------------------------------------------------------------------------
  private parseEmployeesFromText(
    text: string,
    monthInfo: { monthName: string; year: number; monthKey: string; daysInMonth: number },
    settings: any
  ): EmployeeWithLogs[] {
    const { daysInMonth, monthName, year } = monthInfo;
    const monthIndex = MONTH_NAMES.indexOf(monthName);
    const employees: EmployeeWithLogs[] = [];

    // Split document into employee pages by "Employee Name :"
    const parts = text.split(/Employee\s*Name\s*:/i);
    if (parts.length <= 1) {
      return [];
    }

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const idSplit = part.split(/Attendance\s*Id\s*:/i);
      if (idSplit.length < 2) continue;

      const name = idSplit[0].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
      const desigSplit = idSplit[1].split(/Designation\s*:/i);
      const attendanceId = desigSplit[0].replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

      let designation = 'Staff';
      let organization = 'Nic';
      let remaining = '';

      if (desigSplit.length >= 2) {
        const orgSplit = desigSplit[1].split(/Organization\s*Code\s*:/i);
        designation = orgSplit[0]
          .replace(/[\r\n]+/g, ' ')
          .replace(/\\/g, '')
          .replace(/\s*\(ng\)/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (orgSplit.length >= 2) {
          const tableSplit = orgSplit[1].split(/S\.No[\s\S]*?Duration/i);
          organization = (tableSplit.length > 1 ? orgSplit[1].substring(0, orgSplit[1].indexOf('S.No')) : orgSplit[1])
            .replace(/[\r\n]+/g, ' ')
            .replace(/\\/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          remaining = tableSplit.length > 1 ? tableSplit[1] : orgSplit[1];
        } else {
          remaining = orgSplit[0];
        }
      }

      // Parse daily table rows from remaining text
      const lines = remaining.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length > 0);
      const punchesByDay = new Map<
        number,
        { status: 'P' | 'A' | 'H'; inTime: string; outTime: string; duration: string }
      >();

      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx];
        const dateMatch = line.match(
          /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{1,2})\s*,\s*(\d{4})/i
        );

        if (dateMatch) {
          const day = parseInt(dateMatch[1], 10);
          const statusLine = lines[lIdx + 1] || '';
          let status: 'P' | 'A' | 'H' = 'P';
          let inTime = '--';
          let outTime = '--';
          let duration = '--';

          if (statusLine === 'H') {
            status = 'H';
            // Check if half day has biometric punch timestamps
            let cur = lIdx + 2;
            if (cur < lines.length && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(lines[cur])) {
              inTime = lines[cur].substring(11);
              cur++;
            }
            if (cur < lines.length && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(lines[cur])) {
              const outRaw = lines[cur];
              outTime = outRaw.includes('0000-00-00') ? 'Missing' : outRaw.substring(11);
              cur++;
            }
            if (cur < lines.length && /^\d{2}:\d{2}:\d{2}/.test(lines[cur])) {
              duration = lines[cur];
              cur++;
            }
          } else if (statusLine === 'A') {
            status = 'A';
          } else if (statusLine === 'P') {
            status = 'P';
            let cur = lIdx + 2;
            if (cur < lines.length && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(lines[cur])) {
              inTime = lines[cur].substring(11); // Extract "HH:mm:ss"
              cur++;
            }
            if (cur < lines.length && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(lines[cur])) {
              const outRaw = lines[cur];
              outTime = outRaw.includes('0000-00-00') ? 'Missing' : outRaw.substring(11);
              cur++;
            }
            if (cur < lines.length && /^\d{2}:\d{2}:\d{2}/.test(lines[cur])) {
              duration = lines[cur];
              cur++;
            }
          }

          // If duration is missing from table but inTime and outTime are valid, compute duration accurately
          if (
            (!duration || duration === '--') &&
            inTime !== '--' &&
            outTime !== '--' &&
            outTime !== 'Missing'
          ) {
            duration = AttendanceAnalyticsHelper.computeDurationBetween(inTime, outTime);
          }

          punchesByDay.set(day, { status, inTime, outTime, duration });
        }
      }

      // Construct complete daily logs across all days in month
      const dailyLogs: EmployeeWithLogs['dailyLogs'] = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const dayOfWeek = new Date(year, monthIndex, d).getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const dateStr = `${monthName.substring(0, 3)} ${d < 10 ? '0' + d : d}, ${year}`;

        const punch = punchesByDay.get(d);
        if (punch) {
          const logEntry = {
            date: dateStr,
            day: d,
            status: punch.status,
            inTime: punch.inTime,
            outTime: punch.outTime,
            duration: punch.duration,
          };
          const category = AttendanceAnalyticsHelper.categorizeLog(logEntry, settings);
          dailyLogs.push({
            ...logEntry,
            category,
          });
        } else {
          // If days after report generation (e.g. days 30, 31) or weekend
          dailyLogs.push({
            date: dateStr,
            day: d,
            status: 'H',
            inTime: '--',
            outTime: '--',
            duration: '--',
            category: 'HOLIDAY',
          });
        }
      }

      const presentDays = dailyLogs.filter((l) => l.status === 'P').length;
      const absentDays = dailyLogs.filter((l) => l.status === 'A').length;
      const missedDays = dailyLogs.filter((l) => l.category === 'MISSED' && l.status !== 'H').length;

      let overallStatus: 'P' | 'A' | 'M' | 'H' = 'P';
      if (missedDays > 0) overallStatus = 'M';
      else if (absentDays > presentDays) overallStatus = 'A';

      employees.push({
        id: String(i),
        name,
        attendanceId: attendanceId.startsWith('#') ? attendanceId : `#${attendanceId}`,
        designation,
        status: overallStatus,
        octoberStatus:
          overallStatus === 'M'
            ? `Missed (${missedDays}) ! M`
            : overallStatus === 'P'
            ? `Present (${presentDays})`
            : `Absent (${absentDays})`,
        roleId: attendanceId,
        organization: organization || 'NIC',
        dailyLogs,
      });
    }

    return employees;
  }

  // ---------------------------------------------------------------------------
  // Build Complete Dashboard Payload
  // ---------------------------------------------------------------------------
  private buildDashboardPayload(
    detailedEmployees: EmployeeWithLogs[],
    monthInfo: { monthName: string; year: number; monthKey: string; daysInMonth: number },
    settings: any,
    fileName: string
  ): ParsedDashboardPayload {
    const { daysInMonth, monthKey } = monthInfo;
    const flattenedLogs: DrilldownRow[] = [];
    const kpis: AttendanceKPIs = {
      totalEmployees: detailedEmployees.length,
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

    detailedEmployees.forEach((emp) => {
      const empId = emp.attendanceId || emp.id || emp.name;
      (emp.dailyLogs || []).forEach((log) => {
        const cat = AttendanceAnalyticsHelper.categorizeLog(log, settings);
        log.category = cat;

        switch (cat) {
          case 'COMPLETED_ONTIME':
            kpis.completedWorkingHours++;
            uniqueCompleted.add(empId);
            break;
          case 'INCOMPLETE_ONTIME':
            kpis.incompletedWorkingHours++;
            uniqueIncompleted.add(empId);
            break;
          case 'COMPLETED_LATE':
            kpis.lateCompletedHours++;
            uniqueLateCompleted.add(empId);
            break;
          case 'INCOMPLETE_LATE':
            kpis.lateIncompletedHours++;
            uniqueLateIncompleted.add(empId);
            break;
          case 'MISSED':
            kpis.missedAttendance++;
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

        flattenedLogs.push({
          employeeName: emp.name,
          attendanceId: emp.attendanceId.replace('#', ''),
          designation: emp.designation,
          date: log.date,
          status: log.status,
          inTime: isLate && !log.inTime.includes('(late)') ? `${log.inTime} (late)` : (log.inTime || '--'),
          outTime: log.outTime && !log.outTime.includes('0000-00-00') ? log.outTime : (isHoliday ? '--' : 'Missing'),
          duration: exactDuration,
          lateDuration: lateMins > 0 ? `${lateMins} mins` : (log.lateDuration || '--'),
          category: cat,
          isLate,
        });
      });
    });

    kpis.completedWorkingHoursEmployees = uniqueCompleted.size;
    kpis.incompletedWorkingHoursEmployees = uniqueIncompleted.size;
    kpis.lateCompletedEmployees = uniqueLateCompleted.size;
    kpis.lateIncompletedEmployees = uniqueLateIncompleted.size;
    kpis.missedEmployees = uniqueMissed.size;

    const dailyMetrics: DailyAttendanceMetric[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      let present = 0;
      let absent = 0;
      let isWeekend = false;

      detailedEmployees.forEach((emp) => {
        const log = emp.dailyLogs?.find((l) => l.day === day);
        if (log) {
          if (log.status === 'H') isWeekend = true;
          else if (log.status === 'P') present++;
          else if (log.status === 'A') absent++;
        }
      });

      dailyMetrics.push({
        day,
        present,
        leave: Math.max(0, detailedEmployees.length - present - absent),
        absent,
        isWeekend,
      });
    }

    const employees: EmployeeDirectoryItem[] = detailedEmployees.map((emp) => ({
      id: emp.id,
      name: emp.name,
      attendanceId: emp.attendanceId,
      designation: emp.designation,
      status: emp.status,
      octoberStatus: emp.octoberStatus,
    }));

    const metrics: DetailedDashboardMetrics = {
      totalEmployees: detailedEmployees.length,
      employeeTrend: `+${detailedEmployees.length} registered staff`,
      completedWorkingHours: String(kpis.completedWorkingHours),
      completedWorkingHoursEmployees: kpis.completedWorkingHoursEmployees,
      standardShiftsText: `${kpis.completedWorkingHours} Shifts Completed`,
      incompletedWorkingHours: String(kpis.incompletedWorkingHours),
      incompletedWorkingHoursEmployees: kpis.incompletedWorkingHoursEmployees,
      earlyDeparturesText: `${kpis.incompletedWorkingHours} Shifts Incomplete`,
      lateAttendanceCompleted: String(kpis.lateCompletedHours),
      lateAttendanceCompletedEmployees: kpis.lateCompletedEmployees,
      graceTimeUtilizedText: `${kpis.lateCompletedHours} Shifts Late-Complete`,
      lateAttendanceIncompleted: String(kpis.lateIncompletedHours),
      lateAttendanceIncompletedEmployees: kpis.lateIncompletedEmployees,
      lateEarlyExitText: `${kpis.lateIncompletedHours} Shifts Late-Incomplete`,
      missedAttendance: kpis.missedAttendance,
      missedAttendanceEmployees: kpis.missedEmployees,
      requiresManualUpdateText: `${kpis.missedAttendance} Missed / Absent Shifts`,
    };

    return {
      metrics,
      kpis,
      dailyMetrics,
      employees,
      detailedEmployees,
      flattenedLogs,
      month: monthKey,
      fileName,
    };
  }

  computeSummary(records: AttendanceRecord[]): AttendanceSummary {
    const total = records.length;
    const present = records.filter((r) => r.status === 'Present').length;
    const absent = records.filter((r) => r.status === 'Absent').length;
    const halfDay = records.filter((r) => r.status === 'Half-Day').length;
    const late = records.filter((r) => r.isLate).length;

    const rate = total > 0 ? Math.round((present / total) * 100) : 0;

    return {
      totalEmployees: total,
      presentToday: present,
      absentToday: absent,
      halfDayToday: halfDay,
      lateArrivals: late,
      attendancePercentage: rate,
    };
  }
}
