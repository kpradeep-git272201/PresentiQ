import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from '../storage/storage.service';

export type ThemeId = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'teal' | 'light';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  accentColor: string;
  secondaryColor: string;
  bgPreview: string;
  description: string;
  isLight?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private storageService: StorageService;
  public static readonly STORAGE_KEY = 'presentiq_active_theme';

  public readonly availableThemes: ThemeOption[] = [
    {
      id: 'blue',
      name: 'Midnight Cyan',
      accentColor: '#38bdf8',
      secondaryColor: '#0284c7',
      bgPreview: 'linear-gradient(135deg, #0d172e, #070c18)',
      description: 'Default high-contrast dark theme with cyan & sky blue neon accents',
    },
    {
      id: 'green',
      name: 'Emerald Forest',
      accentColor: '#34d399',
      secondaryColor: '#059669',
      bgPreview: 'linear-gradient(135deg, #062e1e, #03140e)',
      description: 'Refreshing dark emerald palette with jade & mint glow highlights',
    },
    {
      id: 'purple',
      name: 'Royal Purple',
      accentColor: '#c084fc',
      secondaryColor: '#7c3aed',
      bgPreview: 'linear-gradient(135deg, #200d3a, #0a0514)',
      description: 'Deep imperial dark palette with radiant violet & lavender accents',
    },
    {
      id: 'orange',
      name: 'Sunset Amber',
      accentColor: '#fb923c',
      secondaryColor: '#ea580c',
      bgPreview: 'linear-gradient(135deg, #301306, #120702)',
      description: 'Warm atmospheric theme with copper, amber & glowing ember tones',
    },
    {
      id: 'red',
      name: 'Crimson Ruby',
      accentColor: '#f87171',
      secondaryColor: '#dc2626',
      bgPreview: 'linear-gradient(135deg, #33080c, #140305)',
      description: 'Bold executive dark theme with fiery scarlet & ruby highlights',
    },
    {
      id: 'teal',
      name: 'Ocean Teal',
      accentColor: '#2dd4bf',
      secondaryColor: '#0d9488',
      bgPreview: 'linear-gradient(135deg, #062828, #031414)',
      description: 'Deep oceanic dark palette with vibrant tropical turquoise accents',
    },
    {
      id: 'light',
      name: 'Clean Light Mode',
      accentColor: '#0284c7',
      secondaryColor: '#0ea5e9',
      bgPreview: 'linear-gradient(135deg, #e2e8f0, #ffffff)',
      description: 'High-legibility daylight theme with crisp white cards and soft shadows',
      isLight: true,
    },
  ];

  public currentTheme = signal<ThemeId>('blue');

  constructor(storage?: StorageService) {
    if (storage) {
      this.storageService = storage;
    } else {
      try {
        this.storageService = inject(StorageService, { optional: true }) || new StorageService();
      } catch {
        this.storageService = new StorageService();
      }
    }
    const initial = this.getInitialTheme();
    this.currentTheme.set(initial);
    this.applyThemeToDom(initial);
  }

  private getInitialTheme(): ThemeId {
    try {
      const saved = this.storageService.getItem<ThemeId>(ThemeService.STORAGE_KEY);
      if (saved && this.availableThemes.some((t) => t.id === saved)) {
        return saved;
      }
    } catch {
      // Fallback
    }
    return 'blue';
  }

  public setTheme(themeId: ThemeId): void {
    if (!this.availableThemes.some((t) => t.id === themeId)) return;

    this.currentTheme.set(themeId);
    this.storageService.setItem(ThemeService.STORAGE_KEY, themeId);
    this.applyThemeToDom(themeId);
  }

  public getAvailableThemes(): ThemeOption[] {
    return this.availableThemes;
  }

  private applyThemeToDom(themeId: ThemeId): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    // Remove all previous theme classes
    this.availableThemes.forEach((t) => {
      root.classList.remove(`theme-${t.id}`);
    });

    // Add current theme class
    root.classList.add(`theme-${themeId}`);

    // Manage dark-mode class
    if (themeId === 'light') {
      root.classList.remove('dark-mode');
      root.style.colorScheme = 'light';
    } else {
      root.classList.add('dark-mode');
      root.style.colorScheme = 'dark';
    }
  }
}
