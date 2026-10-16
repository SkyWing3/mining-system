export type Role = 'Admin' | 'Supervisor' | 'Miner'
export type Severity = 'critical' | 'warning' | 'info'
export type Page = 'dashboard' | 'messages' | 'alerts' | 'analytics' | 'devices' | 'users' | 'activity' | 'settings'
export interface User { id: string; name: string; email: string; role: Role; active: boolean; createdAt: string }
export interface Reading { id?: number; temperatureC: number | null; gasPpm: number | null; batteryPercent: number | null; receivedAt: string }
export interface Device { id: string; name: string; zone: string; userId: string | null; minerName: string | null; active: boolean; online: boolean; lastSeenAt: string | null; createdAt: string; reading: Reading | null }
export interface Message { id: number; deviceId: string; code: string; text: string; severity: Severity; minerName: string; deviceName: string; zone: string; sentAt: string; receivedAt: string; reviewedAt: string | null; reviewedBy: string | null }
export interface MessageKind { code: string; text: string; severity: Severity }
export interface Overview { totalDevices: number; onlineDevices: number; activeMiners: number; messagesToday: number; pendingAlerts: number; serverTime: string; recentMessages: Message[]; catalog: MessageKind[] }
export interface MessageList { items: Message[]; total: number; page: number; pageSize: number }
export interface AuditEvent { id: number; actor: string; description: string; createdAt: string }
export type Metric = 'temperature' | 'gas' | 'battery'
export type Bucket = 'hour' | 'day'
export interface ReadingAnalytics {
  from: string; to: string; metric: Metric; unit: string; bucket: Bucket; timeZone: string
  summary: { readings: number; average: number | null; maximum: number | null; minimum: number | null }
  series: { start: string; count: number; average: number | null; maximum: number | null }[]
  miners: { miner: string; count: number; average: number | null; maximum: number | null }[]
}
export interface MessageAnalytics {
  from: string; to: string; timeZone: string
  summary: { total: number; critical: number; warning: number; info: number; pendingCritical: number }
  days: { day: string; start: string; critical: number; warning: number; info: number }[]
}
export interface AnalyticsOptions { miners: string[]; zones: string[]; maxRangeDays: number; maxHourlyRangeDays: number }
