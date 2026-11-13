import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings/settings.service';
import { ShiftSettings } from '../../models/settings.model';
import { ThemeService, ThemeOption, ThemeId } from '../../services/theme/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private settingsService = inject(SettingsService);
  private themeService = inject(ThemeService);
  private router = inject(Router);

  activeSidebarTab = 'General Settings';
  sidebarTabs = [
    { name: 'General Settings', icon: 'settings' },
    { name: 'Theme & Appearance', icon: 'palette' },
    { name: 'Shift & Schedule', icon: 'clock' },
    { name: 'Grace & Compliance', icon: 'shield' },
    { name: 'Notification Preferences', icon: 'bell' },
    { name: 'Users & Permissions', icon: 'users' },
    { name: 'Integrations', icon: 'grid' },
  ];

  availableThemes: ThemeOption[] = this.themeService.getAvailableThemes();
  activeTheme = this.themeService.currentTheme;

  currentConfig: ShiftSettings = { ...this.settingsService.settings() };
  successMessage = '';

  ngOnInit(): void {
    this.currentConfig = { ...this.settingsService.settings() };

    // Initialize base schedule if not previously set
    if (!this.currentConfig.baseStartTime) {
      this.currentConfig.baseStartTime = '09:00';
    }
    if (!this.currentConfig.baseEndTime) {
      this.currentConfig.baseEndTime = '17:30';
    }
    if (!this.currentConfig.halfDayWorkHours) {
      this.currentConfig.halfDayWorkHours = 6.0;
    }

    // Automatically synchronize Shift Start and End Times with configured Grace Period
    const grace = this.currentConfig.graceMinutes ?? 0;
    this.syncShiftTimesWithGrace(grace);
  }

  /**
   * Automatically update Shift Start Time and Shift End Time based on Grace Period (Minutes)
   * Base: 09:00 to 17:30 (8.5h shift)
   * Grace = 30m -> Start: 09:30, End: 18:00
   * Grace = 15m -> Start: 09:15, End: 17:45
   * Grace = 0m  -> Start: 09:00, End: 17:30
   */
  onGracePeriodChange(graceValue: number | string): void {
    const grace = Math.max(0, Number(graceValue) || 0);
    this.currentConfig.graceMinutes = grace;
    this.syncShiftTimesWithGrace(grace);
  }

  syncShiftTimesWithGrace(graceMinutes: number): void {
    const baseStart = this.currentConfig.baseStartTime || '09:00';
    const baseEnd = this.currentConfig.baseEndTime || '17:30';
    this.currentConfig.startTime = this.addMinutesToTime(baseStart, graceMinutes);
    this.currentConfig.endTime = this.addMinutesToTime(baseEnd, graceMinutes);
  }

  onStartTimeManualChange(newTime: string): void {
    this.currentConfig.startTime = newTime;
    const grace = this.currentConfig.graceMinutes || 0;
    this.currentConfig.baseStartTime = this.addMinutesToTime(newTime, -grace);
  }

  onEndTimeManualChange(newTime: string): void {
    this.currentConfig.endTime = newTime;
    const grace = this.currentConfig.graceMinutes || 0;
    this.currentConfig.baseEndTime = this.addMinutesToTime(newTime, -grace);
  }

  addMinutesToTime(timeStr: string, minutesToAdd: number): string {
    if (!timeStr) return '09:00';
    const clean = timeStr.replace(/ AM| PM/gi, '').trim();
    const isPM = timeStr.toUpperCase().includes('PM');
    const isAM = timeStr.toUpperCase().includes('AM');
    const parts = clean.split(':');
    let h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;

    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;

    const totalMins = (h * 60 + m + minutesToAdd + 1440) % 1440;
    const newH = Math.floor(totalMins / 60);
    const newM = totalMins % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }

  setSidebarTab(tab: string): void {
    this.activeSidebarTab = tab;
  }

  saveConfig(): void {
    this.settingsService.saveSettings(this.currentConfig);
    this.successMessage = 'Settings saved successfully! Recalculating dashboard KPIs...';
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  resetDefaults(): void {
    this.settingsService.resetToDefault();
    this.currentConfig = { ...this.settingsService.settings() };
    this.currentConfig.baseStartTime = '09:00';
    this.currentConfig.baseEndTime = '17:30';
    this.currentConfig.halfDayWorkHours = 6.0;
    this.syncShiftTimesWithGrace(this.currentConfig.graceMinutes || 0);
    this.successMessage = 'Reset to default shift (09:00 AM - 05:30 PM).';
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  selectTheme(themeId: ThemeId): void {
    this.themeService.setTheme(themeId);
    const themeName = this.getThemeName(themeId);
    this.successMessage = `Theme switched to "${themeName}"! Saved and persistent across sessions.`;
    setTimeout(() => {
      this.successMessage = '';
    }, 2800);
  }

  getThemeName(themeId: ThemeId): string {
    return this.availableThemes.find((t) => t.id === themeId)?.name || themeId;
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
