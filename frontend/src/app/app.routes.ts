import type { Routes } from '@angular/router';
import { authGuard, guestGuard, superAdminGuard } from './core/auth/guards';
import { mark, t } from './core/i18n/i18n';
import { NAV_ITEMS } from './core/navigation';

const comingSoon: Routes = NAV_ITEMS.filter((i) => i.phase).map((i) => ({
  path: i.path.slice(1),
  title: () => t('{page} · Family Heritage', { page: t(i.label) }),
  loadComponent: () => import('./features/placeholder/coming-soon.page').then((m) => m.ComingSoonPage),
}));

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
    // Personal links in ceremony announcements (SMS, WhatsApp, e-mail): answered without signing in.
    path: 'r/:token',
    loadComponent: () => import('./layout/auth-layout.component').then((m) => m.AuthLayoutComponent),
    children: [
      {
        path: '',
        title: mark('Family announcement · Family Heritage'),
        loadComponent: () => import('./features/rsvp/rsvp.page').then((m) => m.RsvpPage),
      },
    ],
  },
  {
    // Public: the invitee may not have an account yet.
    path: 'invitations/accept',
    loadComponent: () => import('./layout/auth-layout.component').then((m) => m.AuthLayoutComponent),
    children: [
      {
        path: '',
        title: mark('Family invitation · Family Heritage'),
        loadComponent: () => import('./features/invitations/accept-invitation.page').then((m) => m.AcceptInvitationPage),
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
        path: 'members/duplicates',
        title: mark('Possible duplicates · Family Heritage'),
        loadComponent: () => import('./features/duplicates/duplicates.page').then((m) => m.DuplicatesPage),
      },
      {
        path: 'members/:id/merge',
        title: mark('Merge two records · Family Heritage'),
        loadComponent: () => import('./features/duplicates/merge.page').then((m) => m.MergePage),
      },
      {
        path: 'family/import',
        title: mark('Import · Family Heritage'),
        loadComponent: () => import('./features/import/import.page').then((m) => m.ImportPage),
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
        path: 'branches',
        title: mark('Family branches · Family Heritage'),
        loadComponent: () => import('./features/branches/branches.page').then((m) => m.BranchesPage),
      },
      {
        path: 'relationships',
        title: mark('Relationship finder · Family Heritage'),
        loadComponent: () => import('./features/relationships/relationship-finder.page').then((m) => m.RelationshipFinderPage),
      },
      {
        path: 'generations',
        title: mark('Generations · Family Heritage'),
        loadComponent: () => import('./features/generations/generations.page').then((m) => m.GenerationsPage),
      },
      {
        path: 'media',
        title: mark('Photos & documents · Family Heritage'),
        loadComponent: () => import('./features/media/media.page').then((m) => m.MediaPage),
      },
      {
        path: 'history',
        title: mark('Family history · Family Heritage'),
        loadComponent: () => import('./features/history/family-history.page').then((m) => m.FamilyHistoryPage),
      },
      {
        path: 'history/stories/new',
        title: mark('Write a story · Family Heritage'),
        loadComponent: () => import('./features/history/story-edit.page').then((m) => m.StoryEditPage),
      },
      {
        path: 'history/stories/:id',
        title: mark('Story · Family Heritage'),
        loadComponent: () => import('./features/history/story.page').then((m) => m.StoryPage),
      },
      {
        path: 'history/stories/:id/edit',
        title: mark('Edit story · Family Heritage'),
        loadComponent: () => import('./features/history/story-edit.page').then((m) => m.StoryEditPage),
      },
      {
        path: 'calendar',
        title: mark('Family calendar · Family Heritage'),
        loadComponent: () => import('./features/calendar/calendar.page').then((m) => m.CalendarPage),
      },
      {
        path: 'lineage',
        title: mark('Lineage · Family Heritage'),
        loadComponent: () => import('./features/lineage/lineage.page').then((m) => m.LineagePage),
      },
      {
        path: 'book',
        title: mark('Family book · Family Heritage'),
        loadComponent: () => import('./features/book/book.page').then((m) => m.BookPage),
      },
      {
        path: 'places',
        title: mark('Places · Family Heritage'),
        loadComponent: () => import('./features/places/places.page').then((m) => m.PlacesPage),
      },
      {
        path: 'places/:id',
        title: mark('Place · Family Heritage'),
        loadComponent: () => import('./features/places/place.page').then((m) => m.PlacePage),
      },
      {
        path: 'ceremonies',
        title: mark('Ceremonies · Family Heritage'),
        loadComponent: () => import('./features/ceremonies/ceremonies.page').then((m) => m.CeremoniesPage),
      },
      {
        path: 'ceremonies/new',
        title: mark('Plan a ceremony · Family Heritage'),
        loadComponent: () => import('./features/ceremonies/ceremony-edit.page').then((m) => m.CeremonyEditPage),
      },
      {
        path: 'ceremonies/:id',
        title: mark('Ceremony · Family Heritage'),
        loadComponent: () => import('./features/ceremonies/ceremony.page').then((m) => m.CeremonyPage),
      },
      {
        path: 'ceremonies/:id/edit',
        title: mark('Edit ceremony · Family Heritage'),
        loadComponent: () => import('./features/ceremonies/ceremony-edit.page').then((m) => m.CeremonyEditPage),
      },
      {
        path: 'funds',
        title: mark('Family funds · Family Heritage'),
        loadComponent: () => import('./features/funds/funds.page').then((m) => m.FundsPage),
      },
      {
        path: 'funds/:id',
        title: mark('Fund · Family Heritage'),
        loadComponent: () => import('./features/funds/fund.page').then((m) => m.FundPage),
      },
      {
        path: 'contributions',
        title: mark('Suggestions · Family Heritage'),
        loadComponent: () => import('./features/contributions/contributions.page').then((m) => m.ContributionsPage),
      },
      {
        path: 'invitations',
        title: mark('Invitations · Family Heritage'),
        loadComponent: () => import('./features/invitations/invitations.page').then((m) => m.InvitationsPage),
      },
      {
        path: 'family/members',
        title: mark('Members & roles · Family Heritage'),
        loadComponent: () => import('./features/family-admin/members-access.page').then((m) => m.MembersAccessPage),
      },
      {
        path: 'family/history',
        title: mark('Change history · Family Heritage'),
        loadComponent: () => import('./features/family-admin/history.page').then((m) => m.HistoryPage),
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
      },
      {
        path: 'admin/reports',
        title: mark('Reports · Family Heritage'),
        canActivate: [superAdminGuard],
        loadComponent: () => import('./features/admin/admin-reports.page').then((m) => m.AdminReportsPage),
      },
      ...comingSoon,
    ],
  },
  {
    path: '**',
    title: mark('Not found · Family Heritage'),
    loadComponent: () => import('./features/placeholder/not-found.page').then((m) => m.NotFoundPage),
  },
];
