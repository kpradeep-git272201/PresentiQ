import '@angular/compiler';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeService, ThemeId } from './theme.service';
import { StorageService } from '../storage/storage.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let mockStorage: Map<string, any>;

  beforeEach(() => {
    mockStorage = new Map<string, any>();
    const fakeStorageService = {
      getItem: (key: string) => mockStorage.get(key) || null,
      setItem: (key: string, val: any) => mockStorage.set(key, val),
      removeItem: (key: string) => mockStorage.delete(key),
      hasItem: (key: string) => mockStorage.has(key),
    } as unknown as StorageService;

    // Instantiate service
    service = new ThemeService(fakeStorageService);
  });

  it('should initialize with default blue theme when no saved preference exists', () => {
    expect(service.currentTheme()).toBe('blue');
  });

  it('should switch theme and persist to storage', () => {
    service.setTheme('purple');
    expect(service.currentTheme()).toBe('purple');
    expect((service as any).storageService.getItem(ThemeService.STORAGE_KEY)).toBe('purple');
  });

  it('should switch to emerald green and persist', () => {
    service.setTheme('green');
    expect(service.currentTheme()).toBe('green');
    expect((service as any).storageService.getItem(ThemeService.STORAGE_KEY)).toBe('green');
  });

  it('should switch to light mode and persist', () => {
    service.setTheme('light');
    expect(service.currentTheme()).toBe('light');
    expect((service as any).storageService.getItem(ThemeService.STORAGE_KEY)).toBe('light');
  });

  it('should ignore invalid theme id', () => {
    service.setTheme('blue');
    service.setTheme('invalid-color' as ThemeId);
    expect(service.currentTheme()).toBe('blue');
  });

  it('should list all available themes', () => {
    const list = service.getAvailableThemes();
    expect(list.length).toBe(7);
    expect(list.some((t) => t.id === 'blue')).toBe(true);
    expect(list.some((t) => t.id === 'green')).toBe(true);
    expect(list.some((t) => t.id === 'purple')).toBe(true);
    expect(list.some((t) => t.id === 'orange')).toBe(true);
    expect(list.some((t) => t.id === 'red')).toBe(true);
    expect(list.some((t) => t.id === 'teal')).toBe(true);
    expect(list.some((t) => t.id === 'light')).toBe(true);
  });
});
