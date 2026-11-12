import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginComponent } from './login.component';
import { Router } from '@angular/router';
import { StorageService } from '../../services/storage/storage.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let mockNavigatedUrl: string | null = null;
  const mockStorage = new Map<string, any>();

  const routerMock = {
    navigate: (commands: any[]) => {
      mockNavigatedUrl = commands[0];
      return Promise.resolve(true);
    },
  };

  const storageServiceMock = {
    getItem: <T>(key: string): T | null => mockStorage.get(key) ?? null,
    setItem: (key: string, value: any) => mockStorage.set(key, value),
    removeItem: (key: string) => mockStorage.delete(key),
    hasItem: (key: string) => mockStorage.has(key),
    clear: () => mockStorage.clear(),
  };

  beforeEach(async () => {
    mockNavigatedUrl = null;
    mockStorage.clear();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: StorageService, useValue: storageServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the LoginComponent', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with empty username and password by default', () => {
    expect(component.loginForm.get('username')?.value).toBe('');
    expect(component.loginForm.get('password')?.value).toBe('');
  });

  it('should toggle password visibility', () => {
    expect(component.showPassword).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword).toBe(true);
    component.togglePasswordVisibility();
    expect(component.showPassword).toBe(false);
  });

  it('should populate static credentials when fillDemoCredentials is called', () => {
    component.fillDemoCredentials();
    expect(component.loginForm.get('username')?.value).toBe('heera');
    expect(component.loginForm.get('password')?.value).toBe('Heera@292');
  });

  it('should fail with error when invalid credentials are submitted', async () => {
    component.loginForm.setValue({
      username: 'wrong_user',
      password: 'wrong_password',
      rememberMe: false,
    });

    component.onSubmit();

    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(component.errorMessage).toContain('Invalid credentials');
    expect(mockNavigatedUrl).toBeNull();
  });

  it('should authenticate successfully with static credentials heera / Heera@292', async () => {
    component.loginForm.setValue({
      username: 'heera',
      password: 'Heera@292',
      rememberMe: true,
    });

    component.onSubmit();

    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(component.loginSuccess).toBe(true);
    expect(mockStorage.has('presentiq_auth_token')).toBe(true);
    expect(mockStorage.get('presentiq_remembered_username')).toBe('heera');
  });
});
