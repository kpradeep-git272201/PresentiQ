import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ParsedDashboardPayload } from '../pdf-parser/pdf-parser.service';

export interface StoredMonthlyAttendance {
  month: string;
  fileName: string;
  uploadedAt: number;
  payload: ParsedDashboardPayload;
}

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  private readonly DB_NAME = 'PresentiQ_DB';
  private readonly DB_VERSION = 2;
  private readonly STORE_NAME = 'monthly_attendance';
  private readonly MONTHS_LIST_KEY = 'presentiq_uploaded_months_list';

  private dbPromise: Promise<IDBDatabase | null> | null = null;

  // ---------------------------------------------------------------------------
  // Synchronous LocalStorage Utility Methods (Preserved for compatibility)
  // ---------------------------------------------------------------------------
  getItem<T>(key: string): T | null {
    if (!this.isBrowser) return null;
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : null;
    } catch (e) {
      console.error(`Error reading key "${key}" from localStorage:`, e);
      return null;
    }
  }

  setItem<T>(key: string, value: T): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Error writing key "${key}" to localStorage:`, e);
    }
  }

  removeItem(key: string): void {
    if (!this.isBrowser) return;
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`Error removing key "${key}" from localStorage:`, e);
    }
  }

  hasItem(key: string): boolean {
    if (!this.isBrowser) return false;
    return localStorage.getItem(key) !== null;
  }

  clear(): void {
    if (!this.isBrowser) return;
    localStorage.clear();
  }

  // ---------------------------------------------------------------------------
  // IndexedDB Layer for Attendance Data (Stored 100% per Month)
  // ---------------------------------------------------------------------------
  private async getDb(): Promise<IDBDatabase | null> {
    if (!this.isBrowser || typeof indexedDB === 'undefined') {
      return null;
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);

        req.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = req.result;
          // When upgrading from legacy version, delete old store to clean out any old mock data
          if (event.oldVersion < 2 && db.objectStoreNames.contains(this.STORE_NAME)) {
            db.deleteObjectStore(this.STORE_NAME);
          }
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            db.createObjectStore(this.STORE_NAME, { keyPath: 'month' });
          }
        };

        req.onsuccess = () => {
          resolve(req.result);
        };

        req.onerror = () => {
          console.warn('Failed to open IndexedDB, fallback will be used:', req.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('Error opening IndexedDB:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /**
   * Check whether a stored payload originated from the legacy mock generator
   * (e.g. contains the hardcoded '08:55:15' or identical placeholder rows)
   */
  private isLegacyMockPayload(payload: ParsedDashboardPayload): boolean {
    if (!payload) return true;
    const flattened = payload.flattenedLogs || [];
    if (flattened.length === 0) return false;
    return flattened.some(
      (r) =>
        r.inTime === '08:55:15' ||
        r.inTime === '08:55:15 (late)' ||
        (r.outTime === '17:45:00' && r.duration === '08:49:45')
    );
  }

  /**
   * Save a successfully parsed PDF payload for a specific month in IndexedDB
   */
  async saveAttendanceByMonth(
    month: string,
    payload: ParsedDashboardPayload,
    fileName = ''
  ): Promise<void> {
    if (!this.isBrowser) return;

    const record: StoredMonthlyAttendance = {
      month,
      fileName,
      uploadedAt: Date.now(),
      payload,
    };

    const db = await this.getDb();
    if (db) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.put(record);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn(`IndexedDB put failed for "${month}", saving to localStorage:`, err);
        this.setItem(`presentiq_attendance_${month}`, record);
      }
    } else {
      this.setItem(`presentiq_attendance_${month}`, record);
    }

    // Maintain quick index of all uploaded months
    const currentMonths = await this.getAllUploadedMonths();
    if (!currentMonths.includes(month)) {
      const updated = [...currentMonths, month];
      this.setItem(this.MONTHS_LIST_KEY, updated);
    }
  }

  /**
   * Retrieve the attendance payload for a specific month from IndexedDB
   */
  async getAttendanceByMonth(month: string): Promise<ParsedDashboardPayload | null> {
    if (!this.isBrowser) return null;

    const db = await this.getDb();
    if (db) {
      try {
        const record = await new Promise<StoredMonthlyAttendance | null>((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readonly');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.get(month);
          req.onsuccess = () => resolve((req.result as StoredMonthlyAttendance) || null);
          req.onerror = () => reject(req.error);
        });

        if (record?.payload) {
          if (this.isLegacyMockPayload(record.payload)) {
            console.warn(`Purging legacy mock attendance payload for "${month}"`);
            await this.deleteAttendanceByMonth(month);
            return null;
          }
          return record.payload;
        }
      } catch (err) {
        console.warn(`IndexedDB get failed for "${month}":`, err);
      }
    }

    // Fallback to localStorage
    const fallback = this.getItem<StoredMonthlyAttendance>(`presentiq_attendance_${month}`);
    if (fallback?.payload) {
      if (this.isLegacyMockPayload(fallback.payload)) {
        this.removeItem(`presentiq_attendance_${month}`);
        return null;
      }
      return fallback.payload;
    }
    return null;
  }

  /**
   * Get all month keys that have uploaded attendance reports
   */
  async getAllUploadedMonths(): Promise<string[]> {
    if (!this.isBrowser) return [];

    const db = await this.getDb();
    if (db) {
      try {
        const keys = await new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readonly');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.getAllKeys();
          req.onsuccess = () => resolve((req.result as string[]) || []);
          req.onerror = () => reject(req.error);
        });

        if (keys && keys.length > 0) {
          // Keep localStorage index in sync
          this.setItem(this.MONTHS_LIST_KEY, keys);
          return keys;
        }
      } catch (err) {
        console.warn('IndexedDB getAllKeys failed:', err);
      }
    }

    const cached = this.getItem<string[]>(this.MONTHS_LIST_KEY);
    return cached || [];
  }

  /**
   * Delete attendance data for a specific month
   */
  async deleteAttendanceByMonth(month: string): Promise<void> {
    if (!this.isBrowser) return;

    const db = await this.getDb();
    if (db) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.delete(month);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn(`IndexedDB delete failed for "${month}":`, err);
      }
    }

    this.removeItem(`presentiq_attendance_${month}`);
    const currentMonths = await this.getAllUploadedMonths();
    const filtered = currentMonths.filter((m) => m !== month);
    this.setItem(this.MONTHS_LIST_KEY, filtered);
  }

  /**
   * Clear all stored attendance records across all months
   */
  async clearAllAttendance(): Promise<void> {
    if (!this.isBrowser) return;

    const db = await this.getDb();
    if (db) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('IndexedDB clear failed:', err);
      }
    }

    const currentMonths = await this.getAllUploadedMonths();
    for (const m of currentMonths) {
      this.removeItem(`presentiq_attendance_${m}`);
    }
    this.removeItem(this.MONTHS_LIST_KEY);
  }
}
