import '@angular/compiler';
import { describe, it, expect, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { SettingsService } from '../../services/settings/settings.service';
import { ThemeService, ThemeId } from '../../services/theme/theme.service';
import { StorageService } from '../../services/storage/storage.service';

describe('SettingsComponent Multi-Theme Support', () => {
  let component: SettingsComponent;
  let themeService: ThemeService;
  let settingsService: SettingsService;
  let mockStorage: Map<string, any>;

  beforeEach(() => {
    mockStorage = new Map<string, any>();
    const fakeStorage = {
      getItem: (k: string) => mockStorage.get(k) || null,
      setItem: (k: string, v: any) => mockStorage.set(k, v),
      removeItem: (k: string) => mockStorage.delete(k),
      hasItem: (k: string) => mockStorage.has(k),
    } as unknown as StorageService;

    themeService = new ThemeService(fakeStorage);
    const mockSettingsService = {
      settings: () => ({
        startTime: '09:00',
        endTime: '17:30',
        graceMinutes: 0,
        minWorkHours: 8.5,
        halfDayWorkHours: 6.0,
        allowOvertime: true,
        enforceStrictCheckout: true,
        sendMissedPunchAlerts: true,
        enableLateDeductions: false,
      }),
      saveSettings: () => {},
      resetToDefault: () => {},
    } as unknown as SettingsService;

    const mockRouter = {
      navigate: () => Promise.resolve(true),
    } as unknown as Router;

    const injector = Injector.create({
      providers: [
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: ThemeService, useValue: themeService },
        { provide: Router, useValue: mockRouter },
      ],
    });

    runInInjectionContext(injector, () => {
      component = new SettingsComponent();
    });
  });

  it('should initialize availableThemes with all 7 themes', () => {
    expect(component.availableThemes.length).toBe(7);
    const ids = component.availableThemes.map((t) => t.id);
    expect(ids).toEqual(['blue', 'green', 'purple', 'orange', 'red', 'teal', 'light']);
  });

  it('should allow switching themes and update activeTheme signal', () => {
    component.selectTheme('purple');
    expect(component.activeTheme()).toBe('purple');
    expect(themeService.currentTheme()).toBe('purple');
    expect(mockStorage.get(ThemeService.STORAGE_KEY)).toBe('purple');
    expect(component.successMessage).toContain('Theme switched to');
  });

  it('should allow switching to clean light mode', () => {
    component.selectTheme('light');
    expect(component.activeTheme()).toBe('light');
    expect(themeService.currentTheme()).toBe('light');
    expect(mockStorage.get(ThemeService.STORAGE_KEY)).toBe('light');
  });

  it('should switch activeSidebarTab when setSidebarTab is called', () => {
    expect(component.activeSidebarTab).toBe('General Settings');
    component.setSidebarTab('Theme & Appearance');
    expect(component.activeSidebarTab).toBe('Theme & Appearance');
  });

  it('should get correct theme name for display', () => {
    expect(component.getThemeName('blue')).toBe('Midnight Cyan');
    expect(component.getThemeName('purple')).toBe('Royal Purple');
    expect(component.getThemeName('green')).toBe('Emerald Forest');
    expect(component.getThemeName('light')).toBe('Clean Light Mode');
  });
});
