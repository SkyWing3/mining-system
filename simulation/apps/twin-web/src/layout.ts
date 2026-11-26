// Mina que muestra el gemelo. Por defecto, la mina simulada de dos niveles; con
// ?layout=validacion, la galería de validación de la Fase 1 (benchmark y capturas
// comparables entre fases).
import type { GalleryLayout } from '@twin/shared-types'
import mineJson from '../../../config/mina-simulada.json'
import validationJson from '../../../config/galeria-validacion.json'

const choice = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('layout') : null

export const layout = (choice === 'validacion' ? validationJson : mineJson) as unknown as GalleryLayout
export const layoutTitle = choice === 'validacion' ? 'Galería de validación' : 'Mina simulada · niveles 0 y −1'
