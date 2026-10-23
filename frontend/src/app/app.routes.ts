import type { Routes } from '@angular/router';
import { authGuard, guestGuard, superAdminGuard } from './core/auth/guards';
import { mark } from './core/i18n/i18n';

export const routes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('./layout/auth-layout.component').then((m) => m.AuthLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      {
        path: 'login',
        title: mark('Sign in · Family Heritage'),
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
      },
      {
        path: 'two-step',
        title: mark('Two-step sign-in · Family Heritage'),
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/two-step.page').then((m) => m.TwoStepPage),
      },
      {
        path: 'register',
        title: mark('Create account · Family Heritage'),
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage),
      },
      {
        path: 'forgot-password',
        title: mark('Reset password · Family Heritage'),
        loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
      },
      {
        path: 'reset-password',
        title: mark('Choose a new password · Family Heritage'),
        loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
      },
      {
        path: 'verify-email',
        title: mark('Verify your e-mail · Family Heritage'),
        loadComponent: () => import('./features/auth/verify-email.page').then((m) => m.VerifyEmailPage),
      },
    ],
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: mark('Dashboard · Family Heritage'),
        loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'families/new',
        title: mark('Register a family · Family Heritage'),
        loadComponent: () => import('./features/families/create-family.page').then((m) => m.CreateFamilyPage),
      },
      {
        path: 'family/settings',
        title: mark('Family settings · Family Heritage'),
        loadComponent: () => import('./features/families/family-settings.page').then((m) => m.FamilySettingsPage),
      },
      {
        path: 'members',
        title: mark('Family members · Family Heritage'),
        loadComponent: () => import('./features/members/members.page').then((m) => m.MembersPage),
      },
      {
        path: 'members/new',
        title: mark('Add a person · Family Heritage'),
        loadComponent: () => import('./features/members/member-edit.page').then((m) => m.MemberEditPage),
      },
      {
        path: 'members/:id',
        title: mark('Profile · Family Heritage'),
        loadComponent: () => import('./features/members/member-profile.page').then((m) => m.MemberProfilePage),
      },
      {
        path: 'members/:id/edit',
        title: mark('Edit profile · Family Heritage'),
        loadComponent: () => import('./features/members/member-edit.page').then((m) => m.MemberEditPage),
      },
      {
        path: 'tree',
        title: mark('Family tree · Family Heritage'),
        loadComponent: () => import('./features/tree/family-tree.page').then((m) => m.FamilyTreePage),
      },
      {
        path: 'settings',
        title: mark('Settings · Family Heritage'),
        loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'admin',
        title: mark('Administration · Family Heritage'),
        canActivate: [superAdminGuard],
        loadComponent: () => import('./features/admin/admin-users.page').then((m) => m.AdminUsersPage),
      },    ],
  },
  {
    path: '**',
    title: mark('Not found · Family Heritage'),
    loadComponent: () => import('./features/placeholder/not-found.page').then((m) => m.NotFoundPage),
  },
];
