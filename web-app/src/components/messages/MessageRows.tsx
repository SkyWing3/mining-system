import { AlertTriangle, ArrowUpRight, CheckCheck, MessageSquare } from 'lucide-react'
import type { Message } from '../../types/domain'
import { date, initials } from '../../utils/format'
import { Badge } from '../ui/Feedback'
import { Tooltip } from '../ui/controls'

export function MessageRows({ messages, review, compact = false }: { messages: Message[]; review?: (message: Message) => void; compact?: boolean }) {
  return (
    <div className={`message-list ${compact ? 'message-list-compact' : ''}`}>
      {messages.map(message => <MessageRow key={message.id} message={message} review={review} compact={compact} />)}
    </div>
  )
}

function MessageRow({ message, review, compact }: { message: Message; review?: (message: Message) => void; compact: boolean }) {
  const critical = message.severity === 'critical'
  return (
    <article className={`message-row ${message.severity}`}>
      <div className={`message-symbol ${message.severity}`}>
        {critical ? <AlertTriangle size={19} /> : message.code === 'OK' ? <CheckCheck size={19} /> : <MessageSquare size={19} />}
      </div>
      <div className="message-body">
        <div className="message-title">
          <strong>{message.text}</strong>
          <Badge severity={message.severity} />
          {message.detail && <span className="message-detail">{message.detail}</span>}
        </div>
        <div className="message-source">
          <span className="source-item"><span className="mini-avatar">{initials(message.minerName)}</span>{message.minerName}</span>
          <span className="source-item"><span className="dot-separator">·</span>{message.zone}</span>
          {!compact && <span className="source-item"><span className="dot-separator">·</span>{message.deviceName}</span>}
        </div>
        {!compact && (
          <div className="message-metadata">
            Enviado: {date(message.sentAt, true)}
            <span>Recibido: {date(message.receivedAt, true)}</span>
            {message.reviewedAt && <span>Revisada por {message.reviewedBy} · {date(message.reviewedAt, true)}</span>}
          </div>
        )}
      </div>
      <div className="message-end">
        <Tooltip text={date(message.receivedAt, true)}>
          <time tabIndex={0} dateTime={message.receivedAt}>{date(message.receivedAt)}</time>
        </Tooltip>
        {critical && (message.reviewedAt
          ? <span className="reviewed"><CheckCheck size={14} /> Revisada</span>
          : review && <button className="text-button" onClick={() => review(message)}>Revisar<ArrowUpRight size={14} /></button>)}
      </div>
    </article>
  )
}
