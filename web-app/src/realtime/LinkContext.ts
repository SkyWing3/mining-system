import { createContext } from 'react'
import type { LinkStatus } from './useRealtime'

// State of the central's live link. Without it, the presence shown for each manilla is only the last data received.
export const LinkContext = createContext<LinkStatus>('online')

// Presence can be trusted while the link is open and during the first attempt, when the data was just fetched.
// It becomes unknown once the link drops or the first attempt takes too long.
export const presenceKnown = (link: LinkStatus) => link === 'online' || link === 'starting'
