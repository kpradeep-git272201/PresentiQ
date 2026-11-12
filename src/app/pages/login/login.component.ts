import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { StorageService } from '../../services/storage/storage.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private storageService = inject(StorageService);

  private readonly REMEMBER_KEY = 'presentiq_remembered_username';
  private readonly STATIC_USERNAME = 'heera';
  private readonly STATIC_PASSWORD = 'Heera@292';

  showPassword = false;
  isLoading = false;
  errorMessage = '';
  loginSuccess = false;
  showForgotModal = false;
  cardShaking = false;

  loginForm = this.fb.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
    rememberMe: [false],
  });

  ngOnInit(): void {
    const remembered = this.storageService.getItem<string>(this.REMEMBER_KEY);
    if (remembered) {
      this.loginForm.patchValue({
        username: remembered,
        rememberMe: true,
      });
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  fillDemoCredentials(): void {
    this.loginForm.patchValue({
      username: this.STATIC_USERNAME,
      password: this.STATIC_PASSWORD,
    });
    this.errorMessage = '';
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.triggerShake();
      this.errorMessage = 'Please enter both username and password.';
      return;
    }

    const { username, password, rememberMe } = this.loginForm.value;
    const cleanUsername = (username || '').trim();
    const cleanPassword = password || '';

    this.isLoading = true;
    this.errorMessage = '';

    setTimeout(() => {
      // Validate against static credentials (case-insensitive for username)
      const isUsernameValid = cleanUsername.toLowerCase() === this.STATIC_USERNAME.toLowerCase();
      const isPasswordValid = cleanPassword === this.STATIC_PASSWORD;

      if (isUsernameValid && isPasswordValid) {
        this.loginSuccess = true;

        if (rememberMe) {
          this.storageService.setItem(this.REMEMBER_KEY, cleanUsername);
        } else {
          this.storageService.removeItem(this.REMEMBER_KEY);
        }

        // Generate and persist authentication token
        this.storageService.setItem('presentiq_auth_token', `pq_auth_${Date.now()}`);
        this.storageService.setItem('presentiq_user', {
          username: cleanUsername,
          name: 'Heera (Portal Officer)',
          role: 'Administrator',
          department: 'Panchayati Raj Informatics',
          loginTime: new Date().toISOString(),
        });

        setTimeout(() => {
          this.router.navigate(['/dashboard']);
        }, 500);
      } else {
        this.isLoading = false;
        this.triggerShake();
        this.errorMessage = 'Invalid credentials. Please use Username: heera and Password: Heera@292';
      }
    }, 550);
  }

  openForgotPassword(event: Event): void {
    event.preventDefault();
    this.showForgotModal = true;
  }

  closeForgotPassword(): void {
    this.showForgotModal = false;
  }

  private triggerShake(): void {
    this.cardShaking = true;
    setTimeout(() => {
      this.cardShaking = false;
    }, 600);
  }
}
