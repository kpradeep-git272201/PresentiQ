import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { StorageService } from '../services/storage/storage.service';

export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const storageService = inject(StorageService);

  // PresentiQ authentication guard check
  const isAuthenticated = storageService.hasItem('presentiq_auth_token');

  if (isAuthenticated) {
    return true;
  }

  // Redirect to login if not authenticated
  return router.createUrlTree(['/login']);
};
