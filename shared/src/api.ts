// Wire-shape DTO contract shared by client and server (camelCase on the wire;
// the server maps to/from snake_case DB columns).

export type LinkStatus = 'inbox' | 'archived';
export type ImageSource = 'auto' | 'url' | 'none';

export interface Link {
  id: number;
  url: string;
  title: string;
  origin: string;
  note: string;
  category: string; // '' = uncategorized
  imageUrl: string | null;
  imageSource: ImageSource;
  status: LinkStatus;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  deletedAt: number | null; // epoch ms; non-null while sitting in the trash
}

export interface CreateLinkInput {
  url: string;
  title?: string;
  note?: string;
  category?: string;
  imageUrl?: string | null;
  imageSource?: ImageSource; // defaults to 'auto' if imageUrl given, else 'none'
}
export type CreateLinkResponse = Link;

export interface ListLinksQuery {
  q?: string;
  category?: string;
  sort?: 'newest' | 'oldest'; // default 'newest'
  status?: LinkStatus; // default 'inbox' — pass 'archived' to see archived links instead
}
export interface ListLinksResponse {
  links: Link[];
}

export type GetLinkResponse = Link;

export interface ListCategoriesResponse {
  categories: string[]; // distinct, non-empty, in use
}

export interface UpdateLinkInput {
  title?: string;
  note?: string;
  category?: string;
  imageUrl?: string | null;
  imageSource?: ImageSource;
}
export type UpdateLinkResponse = Link;

export interface DeleteLinkResponse {
  id: number;
  deleted: true;
}
export type RefreshScreenshotResponse = Link;
export type ArchiveLinkResponse = Link;
export type UnarchiveLinkResponse = Link;
export interface ListArchivedResponse {
  links: Link[];
}

export interface ListTrashResponse {
  links: Link[];
  retentionDays: number;
}
export type RestoreLinkResponse = Link;
export interface PurgeLinkResponse {
  id: number;
  purged: true;
}

export interface Section {
  id: number;
  name: string;
}
export interface CreateSectionInput {
  name: string;
}
export type CreateSectionResponse = Section;
export interface ListSectionsResponse {
  sections: Section[];
}
export interface UpdateSectionInput {
  name: string;
}
export type UpdateSectionResponse = Section;
export interface DeleteSectionResponse {
  id: number;
  deleted: true;
}

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DB_ERROR'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED';
export interface ApiError {
  error: string;
  code: ApiErrorCode;
}

export interface User {
  id: number;
  email: string;
  createdAt: number;
}
export interface SignupInput {
  email: string;
  password: string;
}
export type SignupResponse = User;
export interface LoginInput {
  email: string;
  password: string;
}
export type LoginResponse = User;
export interface LogoutResponse {
  loggedOut: true;
}
export interface LogoutOthersResponse {
  loggedOut: true;
}
export type MeResponse = User | null;

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
export interface ChangePasswordResponse {
  changed: true;
}
export interface ChangeEmailInput {
  currentPassword: string;
  newEmail: string;
}
export type ChangeEmailResponse = User;
