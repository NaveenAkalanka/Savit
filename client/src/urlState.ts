import type { ViewMode } from './types.ts';

const VIEW_MODES: ViewMode[] = ['list', 'grid', 'explore'];

export interface UrlState {
  viewMode: ViewMode;
  sort: 'newest' | 'oldest';
  category: string | null;
  query: string;
}

export function parseUrlState(url: string): UrlState {
  const params = new URL(url, 'http://internal').searchParams;
  const view = params.get('view');
  const category = params.get('category');
  return {
    viewMode: VIEW_MODES.includes(view as ViewMode) ? (view as ViewMode) : 'list',
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
    category: category && category.length > 0 ? category : null,
    query: params.get('q') ?? '',
  };
}

export function buildUrlSearch(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.viewMode !== 'list') params.set('view', state.viewMode);
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.category) params.set('category', state.category);
  if (state.query) params.set('q', state.query);
  const search = params.toString();
  return search ? `?${search}` : '';
}
