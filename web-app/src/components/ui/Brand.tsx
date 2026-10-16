import { Mountain } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true"><Mountain size={compact ? 20 : 24} strokeWidth={1.8} /></span>
      <div>
        <strong>MINING<span>SYSTEM</span></strong>
        <small>SEGURIDAD CONECTADA</small>
      </div>
    </div>
  )
}
