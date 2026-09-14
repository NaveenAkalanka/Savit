import type { Link, Section, User } from '@savit/shared';

export interface DashboardInitialData {
  kind: 'dashboard';
  user: User;
  links: Link[];
  categories: string[];
}

export interface SaveInitialData {
  kind: 'save';
  url: string;
  title: string;
  image: string;
  categories: string[];
}

export interface AuthInitialData {
  kind: 'auth';
}

export interface SettingsInitialData {
  kind: 'settings';
  user: User;
  categories: string[];
  sections: Section[];
}

export type InitialData = DashboardInitialData | SaveInitialData | AuthInitialData | SettingsInitialData;

export type ViewMode = 'list' | 'grid' | 'explore';
export type GridDensity = 'comfortable' | 'compact';

declare global {
  interface Window {
    __INITIAL_DATA__?: InitialData;
  }
}
