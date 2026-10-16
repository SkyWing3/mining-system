import { useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { Modal } from '../components/ui/Modal'

export function KeyModal({ apiKey, close }: { apiKey: string; close: () => void }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
    } catch {
      setError('Selecciona y copia la credencial manualmente.')
    }
  }

  return (
    <Modal title="Credencial de la manilla" subtitle="Se muestra una sola vez. Guárdala en la configuración del dispositivo." close={close}>
      <div className="key-content">
        <span className="key-icon"><KeyRound size={25} /></span>
        <p>Coloca esta credencial en <code>connection.api_key</code> dentro de <code>device/config/settings.json</code>.</p>
        <pre className="api-key" tabIndex={0}>{apiKey}</pre>
        <button className="button secondary" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copiada' : 'Copiar credencial'}
        </button>
        {error && <p role="alert">{error}</p>}
        <p className="form-hint">Si la pierdes, puedes generar una nueva desde la lista de manillas. La anterior dejará de funcionar.</p>
      </div>
      <div className="modal-actions"><button className="button primary" onClick={close}>Ya la guardé</button></div>
    </Modal>
  )
}
