import { ClipboardCheck, Cpu, LayoutDashboard, Megaphone, MessageSquare, Mic, Radio, Settings, TriangleAlert, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Page } from '../types/domain'

export type PageGroup = 'Monitoreo' | 'Gestión' | 'Cuenta'

export const pageInfo: Record<Page, { title: string; navigation: string; description: string; group: PageGroup; icon: LucideIcon }> = {
  dashboard: { title: 'Vista general', navigation: 'Vista general', group: 'Monitoreo', description: 'La información esencial de tu operación, en un solo lugar.', icon: LayoutDashboard },
  live: { title: 'Monitoreo en vivo', navigation: 'En vivo', group: 'Monitoreo', description: 'Lecturas de cada manilla en tiempo real, con su nivel de alerta.', icon: Radio },
  messages: { title: 'Mensajes', navigation: 'Mensajes', group: 'Monitoreo', description: 'Cada reporte de tu equipo, recibido directamente desde las manillas.', icon: MessageSquare },
  alerts: { title: 'Alertas de seguridad', navigation: 'Alertas', group: 'Monitoreo', description: 'Prioriza los reportes críticos y registra su revisión.', icon: TriangleAlert },
  voice: { title: 'Mensajes de voz', navigation: 'Voz', group: 'Monitoreo', description: 'Grabaciones enviadas desde el micrófono de las manillas.', icon: Mic },
  notices: { title: 'Avisos a manillas', navigation: 'Avisos', group: 'Monitoreo', description: 'Envía avisos predefinidos al equipo y sigue su confirmación.', icon: Megaphone },
  devices: { title: 'Manillas', navigation: 'Manillas', group: 'Gestión', description: 'Administra dispositivos, asignaciones y lecturas de tu equipo.', icon: Cpu },
  users: { title: 'Usuarios', navigation: 'Usuarios', group: 'Gestión', description: 'Gestiona a tu equipo y sus permisos de acceso.', icon: Users },
  activity: { title: 'Actividad', navigation: 'Actividad', group: 'Gestión', description: 'Un registro de las acciones realizadas en la central.', icon: ClipboardCheck },
  settings: { title: 'Mi cuenta y sistema', navigation: 'Mi cuenta y sistema', group: 'Cuenta', description: 'Tu acceso, la identidad de la central y su funcionamiento.', icon: Settings },
}
