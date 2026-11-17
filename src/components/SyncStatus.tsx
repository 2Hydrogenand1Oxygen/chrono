/**
 * SyncStatus — small indicator shown in the topbar.
 * Shows: loading, saving, synced, offline, error states.
 */

import { AlertCircle, Check, Cloud, CloudOff, Loader2 } from 'lucide-react'
import type { SyncStatus as Status } from '../hooks/useSync'

type Props = {
  status: Status
  errorMessage: string | null
  lastSynced: Date | null
}

export function SyncStatus({ status, errorMessage, lastSynced }: Props) {
  if (status === 'idle') return null

  const content = {
    loading: { icon: <Loader2 size={13} className="sync-spin" />, text: 'Loading…', cls: 'sync-loading' },
    saving: { icon: <Loader2 size={13} className="sync-spin" />, text: 'Saving…', cls: 'sync-saving' },
    synced: { icon: <Check size={13} />, text: lastSynced ? `Synced ${timeAgo(lastSynced)}` : 'Synced', cls: 'sync-ok' },
    offline: { icon: <CloudOff size={13} />, text: 'Offline', cls: 'sync-offline' },
    error: { icon: <AlertCircle size={13} />, text: errorMessage ?? 'Sync error', cls: 'sync-error' },
  }[status]

  return (
    <div className={`sync-badge ${content.cls}`} title={errorMessage ?? undefined}>
      {content.icon}
      <span>{content.text}</span>
    </div>
  )
}

// Minimal relative time formatter
function timeAgo(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

/** Cloud indicator with tooltip wrapping — used in topbar next to theme toggle */
export function CloudIndicator({ status }: { status: Status }) {
  if (status === 'offline') {
    return (
      <span title="Offline — changes saved locally" className="cloud-icon-wrapper">
        <CloudOff size={15} className="cloud-icon offline" />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span title="Sync error" className="cloud-icon-wrapper">
        <AlertCircle size={15} className="cloud-icon error" />
      </span>
    )
  }
  return (
    <span title="Cloud sync active" className="cloud-icon-wrapper">
      <Cloud size={15} className="cloud-icon ok" />
    </span>
  )
}
