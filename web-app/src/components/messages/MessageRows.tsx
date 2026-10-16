import { memo } from 'react'
import { AlertTriangle, CheckCheck, MessageSquare } from 'lucide-react'
import type { Message } from '../../types/domain'
import { date, initials } from '../../utils/format'
import { Badge, Chip } from '../ui/Feedback'
import { Tooltip } from '../ui/controls'

export function MessageRows({ messages, review, compact = false }: { messages: Message[]; review?: (message: Message) => void; compact?: boolean }) {
  return (
    <div className={`message-list ${compact ? 'message-list-compact' : ''}`}>
      {messages.map(message => <MessageRow key={message.id} message={message} review={review} compact={compact} />)}
    </div>
  )
}

const MessageRow = memo(function MessageRow({ message, review, compact }: { message: Message; review?: (message: Message) => void; compact: boolean }) {
  const critical = message.severity === 'critical'
  return (
    <article className={`message-row ${message.severity}`}>
      <div className={`message-symbol ${message.severity}`} aria-hidden="true">
        {critical ? <AlertTriangle size={17} /> : message.code === 'OK' ? <CheckCheck size={17} /> : <MessageSquare size={17} />}
      </div>
      <div className="message-body">
        <div className="message-title">
          <strong>{message.text}</strong>
          <Badge severity={message.severity} />
          {message.detail && <span className="message-detail mono">{message.detail}</span>}
        </div>
        <div className="message-source">
          <span className="source-item"><span className="mini-avatar" aria-hidden="true">{initials(message.minerName)}</span>{message.minerName}</span>
          <span className="source-item"><span className="dot-separator">·</span>{message.zone}</span>
          {!compact && <span className="source-item"><span className="dot-separator">·</span>{message.deviceName}</span>}
        </div>
        {!compact && (
          <div className="message-metadata mono">
            <span>Enviado {date(message.sentAt, true)}</span>
            <span>Recibido {date(message.receivedAt, true)}</span>
            {message.reviewedAt && <span>Revisada por {message.reviewedBy} · {date(message.reviewedAt, true)}</span>}
          </div>
        )}
      </div>
      <div className="message-end">
        {/* The full date is a pointer convenience; the Mensajes page shows it in every row. */}
        {compact ? (
          <Tooltip text={date(message.receivedAt, true)}>
            <time className="mono" dateTime={message.receivedAt}>{date(message.receivedAt)}</time>
          </Tooltip>
        ) : <time className="mono" dateTime={message.receivedAt}>{date(message.receivedAt)}</time>}
        {critical && (message.reviewedAt
          ? <Chip tone="neutral" className="reviewed" icon={<CheckCheck size={13} aria-hidden="true" />}>Revisada</Chip>
          : review && <button className="button secondary small-button review-button" onClick={() => review(message)}>Revisar</button>)}
      </div>
    </article>
  )
})
