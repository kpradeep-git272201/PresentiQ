import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from '../storage/storage.service';
import { ShiftSettings, DEFAULT_SHIFT_SETTINGS, AppSettings, DEFAULT_SETTINGS } from '../../models/settings.model';

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private storageService = inject(StorageService);
  private readonly STORAGE_KEY = 'presentiq_shift_settings';

  public defaultSettings: ShiftSettings = { ...DEFAULT_SHIFT_SETTINGS };

  // Angular reactive signal with loaded settings
  public settings = signal<ShiftSettings>(this.loadSettings());

  private loadSettings(): ShiftSettings {
    const saved = this.storageService.getItem<ShiftSettings>(this.STORAGE_KEY);
    return saved ? { ...this.defaultSettings, ...saved } : { ...this.defaultSettings };
  }

  saveSettings(newSettings: ShiftSettings): void {
    this.storageService.setItem(this.STORAGE_KEY, newSettings);
    this.settings.set({ ...newSettings });
  }

  updateSettings(partial: Partial<ShiftSettings>): void {
    const updated = {
      ...this.settings(),
      ...partial,
    };
    this.saveSettings(updated);
  }

  resetToDefault(): void {
    this.saveSettings(this.defaultSettings);
  }

  resetDefaults(): void {
    this.resetToDefault();
  }
}
