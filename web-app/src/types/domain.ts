export type Role = 'Admin' | 'Supervisor' | 'Miner'
export type Severity = 'critical' | 'warning' | 'info'
export type AlertLevel = 'normal' | 'caution' | 'danger'
export type NoticeStatus = 'pending' | 'delivered' | 'read' | 'expired'
export type Page = 'dashboard' | 'live' | 'messages' | 'alerts' | 'voice' | 'notices' | 'devices' | 'users' | 'activity' | 'settings'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
  createdAt: string
}

export interface Reading {
  id: number | null
  temperatureC: number | null
  objectTemperatureC: number | null
  gasPpm: number | null
  gasVoltage: number | null
  batteryPercent: number | null
  level: AlertLevel
  simulated: boolean
  receivedAt: string
}

export interface Device {
  id: string
  name: string
  zone: string
  userId: string | null
  minerName: string | null
  active: boolean
  online: boolean
  lastSeenAt: string | null
  createdAt: string
  reading: Reading | null
}

export interface Message {
  id: number
  deviceId: string
  code: string
  text: string
  severity: Severity
  detail: string | null
  minerName: string
  deviceName: string
  zone: string
  sentAt: string
  receivedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
}

export interface MessageKind {
  code: string
  text: string
  severity: Severity
  automatic: boolean
}

export interface NoticeKind {
  code: string
  text: string
  severity: Severity
}

export interface Overview {
  totalDevices: number
  onlineDevices: number
  activeMiners: number
  messagesToday: number
  pendingAlerts: number
  liveDanger: number
  pendingVoice: number
  pendingNotices: number
  serverTime: string
  recentMessages: Message[]
  catalog: MessageKind[]
  noticeCatalog: NoticeKind[]
}

export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface VoiceMessage {
  id: number
  deviceId: string
  minerName: string
  deviceName: string
  zone: string
  recordedAt: string
  receivedAt: string
  durationMs: number
  sizeBytes: number
  reviewedAt: string | null
  reviewedBy: string | null
}

export interface Notice {
  id: number
  deviceId: string
  code: string
  text: string
  severity: Severity
  deviceName: string
  minerName: string | null
  zone: string
  createdBy: string
  createdAt: string
  expiresAt: string
  deliveredAt: string | null
  readAt: string | null
  status: NoticeStatus
}

export interface AuditEvent {
  id: number
  actor: string
  description: string
  createdAt: string
}

export interface TelemetryEvent {
  deviceId: string
  reading: Reading
}

export type ChangeCategory = 'users' | 'devices' | 'messages' | 'presence' | 'voice' | 'notices'
