import { Routes } from '@angular/router';
import { sessionGuard } from './guards/session.guard';

export const routes: Routes = [
  // Real participants arrive exclusively via the emailed /link/:token now (Phase C of the
  // consent/token project) — the bare root shows an explanation instead of a login form.
  {
    path: '',
    loadComponent: () => import('./access-info/access-info.component').then(m => m.AccessInfoComponent),
  },
  {
    path: 'link/:token',
    loadComponent: () => import('./link-access/link-access.component').then(m => m.LinkAccessComponent),
  },
  {
    // Kept for dev/testing only — no longer linked from anywhere in the app.
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'test',
    loadComponent: () => import('./test/test.component').then(m => m.TestComponent),
    canActivate: [sessionGuard],
  },
  {
    path: 'done',
    loadComponent: () => import('./done/done.component').then(m => m.DoneComponent),
  },
  { path: '**', redirectTo: '' },
];
