import { create } from 'zustand'
import { suggestQuality, type QualityLevel, type RenderDiagnostics } from '@twin/graphics-engine'

export type CameraMode = 'orbit' | 'first-person'

/** Punto de vista programado (capturas y pruebas): segmento, distancia y orientación. */
export interface Viewpoint {
  readonly segment: string
  readonly s: number
  readonly yawOffset?: number
  readonly pitch?: number
  readonly lateral?: number
}

export interface GenerationState {
  readonly status: 'idle' | 'running' | 'done' | 'error'
  readonly done: number
  readonly total: number
  readonly milliseconds?: number
  readonly triangles?: number
  readonly workers?: number
  readonly error?: string
}

interface TwinState {
  quality: QualityLevel
  cameraMode: CameraMode
  /** Corte de la bóveda en la vista orbital para ver el interior. */
  roofCut: boolean
  headlamp: boolean
  walkSpeed: number
  showDiagnostics: boolean
  panelsVisible: boolean
  pointerLocked: boolean
  generation: GenerationState
  diagnostics: RenderDiagnostics | null
  /** Error al cargar texturas locales (por ejemplo, si falta ejecutar assets:fetch). */
  assetError: string | null
  /** Sombreadores compilados y texturas subidas a la GPU antes de recorrer la galería. */
  warmedUp: boolean
  viewpoint: Viewpoint | null
  /** Recorrido automático por la línea principal (benchmark). */
  autopilot: { readonly active: boolean; readonly progress: number; readonly finished: boolean }
  setQuality: (quality: QualityLevel) => void
  setCameraMode: (mode: CameraMode) => void
  setRoofCut: (value: boolean) => void
  toggleHeadlamp: () => void
  setWalkSpeed: (speed: number) => void
  toggleDiagnostics: () => void
  togglePanels: () => void
  setPointerLocked: (value: boolean) => void
  setGeneration: (state: GenerationState) => void
  setDiagnostics: (sample: RenderDiagnostics) => void
  setAssetError: (message: string | null) => void
  setWarmedUp: (value: boolean) => void
  setViewpoint: (viewpoint: Viewpoint | null) => void
  setAutopilot: (state: { active: boolean; progress: number; finished: boolean }) => void
}

function initialQuality(): QualityLevel {
  // Permite fijar el perfil desde la URL (benchmark y capturas): ?quality=ultra
  const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null
  if (param === 'low' || param === 'medium' || param === 'high' || param === 'ultra') return param
  try {
    const stored = localStorage.getItem('twin.quality')
    if (stored === 'low' || stored === 'medium' || stored === 'high' || stored === 'ultra') return stored
  } catch { /* almacenamiento no disponible */ }
  return suggestQuality()
}

export const useTwin = create<TwinState>(set => ({
  quality: initialQuality(),
  cameraMode: 'orbit',
  roofCut: true,
  headlamp: true,
  walkSpeed: 1.4,
  showDiagnostics: true,
  panelsVisible: true,
  pointerLocked: false,
  generation: { status: 'idle', done: 0, total: 0 },
  diagnostics: null,
  assetError: null,
  warmedUp: false,
  viewpoint: null,
  autopilot: { active: false, progress: 0, finished: false },
  setQuality: quality => {
    try { localStorage.setItem('twin.quality', quality) } catch { /* sin almacenamiento */ }
    set({ quality })
  },
  setCameraMode: cameraMode => set({ cameraMode }),
  setRoofCut: roofCut => set({ roofCut }),
  toggleHeadlamp: () => set(state => ({ headlamp: !state.headlamp })),
  setWalkSpeed: walkSpeed => set({ walkSpeed }),
  toggleDiagnostics: () => set(state => ({ showDiagnostics: !state.showDiagnostics })),
  togglePanels: () => set(state => ({ panelsVisible: !state.panelsVisible })),
  setPointerLocked: pointerLocked => set({ pointerLocked }),
  setGeneration: generation => set({ generation }),
  setDiagnostics: diagnostics => set({ diagnostics }),
  setAssetError: assetError => set({ assetError }),
  setWarmedUp: warmedUp => set({ warmedUp }),
  setViewpoint: viewpoint => set({ viewpoint }),
  setAutopilot: autopilot => set({ autopilot }),
}))
