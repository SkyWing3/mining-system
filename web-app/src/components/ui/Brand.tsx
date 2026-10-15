import { Mountain } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <span className="brand-mark"><Mountain size={25} strokeWidth={1.7} /></span>
      <div>
        <strong>MINING<span>SYSTEM</span></strong>
        <small>SEGURIDAD CONECTADA</small>
      </div>
    </div>
  )
}
