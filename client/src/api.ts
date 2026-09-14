import type {
  ApiError,
  ArchiveLinkResponse,
  ChangeEmailInput,
  ChangeEmailResponse,
  ChangePasswordInput,
  ChangePasswordResponse,
  CreateLinkInput,
  CreateLinkResponse,
  CreateSectionInput,
  CreateSectionResponse,
  DeleteLinkResponse,
  DeleteSectionResponse,
  GetLinkResponse,
  ListArchivedResponse,
  ListCategoriesResponse,
  ListLinksQuery,
  ListLinksResponse,
  ListSectionsResponse,
  ListTrashResponse,
  LoginInput,
  LoginResponse,
  LogoutOthersResponse,
  LogoutResponse,
  MeResponse,
  PurgeLinkResponse,
  RefreshScreenshotResponse,
  RestoreLinkResponse,
  SignupInput,
  SignupResponse,
  UnarchiveLinkResponse,
  UpdateLinkInput,
  UpdateLinkResponse,
  UpdateSectionInput,
  UpdateSectionResponse,
} from '@savit/shared';

export class ApiRequestError extends Error {
  status: number;
  code: ApiError['code'];

  constructor(status: number, apiError: ApiError) {
    super(apiError.error);
    this.status = status;
    this.code = apiError.code;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    // A 401 on anything other than the auth endpoints themselves means the
    // session expired mid-use — bounce to '/', which now server-renders the
    // sign-in screen. Login/signup's own 401 (wrong credentials) is left for
    // the caller to catch and show inline.
    if (res.status === 401 && !res.url.includes('/api/auth/')) {
      window.location.href = '/';
    }
    throw new ApiRequestError(res.status, body as ApiError);
  }
  return body as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  return unwrap<T>(res);
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return unwrap<T>(res);
}

function queryString(query: ListLinksQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  create: (input: CreateLinkInput) => sendJson<CreateLinkResponse>('/api/links', 'POST', input),
  list: (query: ListLinksQuery = {}) => getJson<ListLinksResponse>(`/api/links${queryString(query)}`),
  get: (id: number) => getJson<GetLinkResponse>(`/api/links/${id}`),
  update: (id: number, patch: UpdateLinkInput) => sendJson<UpdateLinkResponse>(`/api/links/${id}`, 'PATCH', patch),
  remove: (id: number) => sendJson<DeleteLinkResponse>(`/api/links/${id}`, 'DELETE'),
  refreshScreenshot: (id: number) =>
    sendJson<RefreshScreenshotResponse>(`/api/links/${id}/refresh-screenshot`, 'POST'),
  archived: () => getJson<ListArchivedResponse>('/api/archive'),
  archive: (id: number) => sendJson<ArchiveLinkResponse>(`/api/links/${id}/archive`, 'POST'),
  unarchive: (id: number) => sendJson<UnarchiveLinkResponse>(`/api/links/${id}/unarchive`, 'POST'),
  trash: () => getJson<ListTrashResponse>('/api/trash'),
  restore: (id: number) => sendJson<RestoreLinkResponse>(`/api/links/${id}/restore`, 'POST'),
  purge: (id: number) => sendJson<PurgeLinkResponse>(`/api/trash/${id}`, 'DELETE'),
  categories: () => getJson<ListCategoriesResponse>('/api/categories'),
  sections: () => getJson<ListSectionsResponse>('/api/sections'),
  createSection: (input: CreateSectionInput) => sendJson<CreateSectionResponse>('/api/sections', 'POST', input),
  updateSection: (id: number, input: UpdateSectionInput) =>
    sendJson<UpdateSectionResponse>(`/api/sections/${id}`, 'PATCH', input),
  removeSection: (id: number, reassignTo?: string) =>
    sendJson<DeleteSectionResponse>(
      `/api/sections/${id}`,
      'DELETE',
      reassignTo !== undefined ? { reassignTo } : undefined,
    ),
  signup: (input: SignupInput) => sendJson<SignupResponse>('/api/auth/signup', 'POST', input),
  login: (input: LoginInput) => sendJson<LoginResponse>('/api/auth/login', 'POST', input),
  logout: () => sendJson<LogoutResponse>('/api/auth/logout', 'POST'),
  logoutOthers: () => sendJson<LogoutOthersResponse>('/api/auth/logout-others', 'POST'),
  me: () => getJson<MeResponse>('/api/auth/me'),
  changePassword: (input: ChangePasswordInput) =>
    sendJson<ChangePasswordResponse>('/api/auth/password', 'PATCH', input),
  changeEmail: (input: ChangeEmailInput) => sendJson<ChangeEmailResponse>('/api/auth/email', 'PATCH', input),
};
