import { get, post, put } from './client'
import type { AuditEvent, Device, Message, Notice, NoticeKind, Overview, PagedResult, Reading, User, VoiceMessage } from '../types/domain'

export interface MessageFilters {
  page: number
  pageSize: number
  search?: string
  severity?: string
  deviceId?: string
  pending?: boolean
}

export interface PageFilters {
  page: number
  pageSize: number
  deviceId?: string
  pending?: boolean
}

export interface UserInput {
  name: string
  email: string
  role: string
  active: boolean
  password: string | null
}

export interface DeviceInput {
  name: string
  zone: string
  userId: string | null
  active: boolean
}

function query(values: object) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value))
  }
  return params.toString()
}

export const authApi = {
  status: (signal?: AbortSignal) => get<{ setupRequired: boolean }>('/auth/status', signal),
  me: (signal?: AbortSignal) => get<User>('/auth/me', signal),
  setup: (body: { name: string; email: string; password: string }) => post<User>('/auth/setup', body),
  login: (body: { email: string; password: string }) => post<User>('/auth/login', body),
  logout: () => post<void>('/auth/logout'),
  changePassword: (body: { currentPassword: string; newPassword: string }) => post<void>('/auth/password', body),
}

export const usersApi = {
  list: (signal?: AbortSignal) => get<User[]>('/users', signal),
  create: (body: UserInput) => post<User>('/users', body),
  update: (id: string, body: UserInput) => put<User>(`/users/${id}`, body),
}

export const devicesApi = {
  list: (signal?: AbortSignal) => get<Device[]>('/devices', signal),
  miners: (signal?: AbortSignal) => get<User[]>('/devices/miners', signal),
  create: (body: DeviceInput) => post<{ device: Device; apiKey: string | null }>('/devices', body),
  update: (id: string, body: DeviceInput) => put<{ device: Device; apiKey: string | null }>(`/devices/${id}`, body),
  rotateKey: (id: string) => post<{ apiKey: string }>(`/devices/${id}/rotate-key`),
  telemetry: (id: string, options: { since?: string; limit?: number } = {}, signal?: AbortSignal) =>
    get<Reading[]>(`/devices/${id}/telemetry?${query(options)}`, signal),
}

export const monitoringApi = {
  overview: (signal?: AbortSignal) => get<Overview>('/overview', signal),
  messages: (filters: MessageFilters, signal?: AbortSignal) => get<PagedResult<Message>>(`/messages?${query(filters)}`, signal),
  review: (id: number) => post<Message>(`/messages/${id}/review`),
  events: (signal?: AbortSignal) => get<AuditEvent[]>('/events', signal),
}

export const voiceApi = {
  list: (filters: PageFilters, signal?: AbortSignal) => get<PagedResult<VoiceMessage>>(`/voice?${query(filters)}`, signal),
  audioUrl: (id: number) => `/api/voice/${id}/audio`,
  review: (id: number) => post<VoiceMessage>(`/voice/${id}/review`),
}

export const noticesApi = {
  list: (filters: PageFilters, signal?: AbortSignal) => get<PagedResult<Notice>>(`/notices?${query(filters)}`, signal),
  catalog: (signal?: AbortSignal) => get<NoticeKind[]>('/notices/catalog', signal),
  send: (body: { code: string; deviceIds?: string[]; all?: boolean }) => post<Notice[]>('/notices', body),
}
