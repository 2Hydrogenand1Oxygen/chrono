/**
 * MigrationModal — One-time offer to import localStorage data into Supabase.
 *
 * Shows after first sign-in if local records are detected.
 * Never deletes localStorage until migration is verified.
 */

import { useState } from 'react'
import { Check, CloudUpload, Database, Loader2, X } from 'lucide-react'
import { LiquidGlass } from './LiquidGlass'
import { migrateLocalToCloud, markMigrationDone, verifyMigration } from '../lib/migration'
import type { LocalData, MigrationResult } from '../lib/migration'

type Props = {
  localData: LocalData
  onDone: () => void
  onSkip: () => void
}

type Phase = 'confirm' | 'migrating' | 'done' | 'error'

export function MigrationModal({ localData, onDone, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>('confirm')
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [verificationOk, setVerificationOk] = useState(false)

  const startMigration = async () => {
    setPhase('migrating')
    try {
      const res = await migrateLocalToCloud(localData)
      setResult(res)

      // Verify counts
      const verification = await verifyMigration({
        sessions: localData.sessions.length,
        categories: localData.categories.length,
      })
      setVerificationOk(verification.ok)

      if (verification.ok) markMigrationDone()
      setPhase(res.errors.length > 0 ? 'error' : 'done')
    } catch (err) {
      setResult({
        sessionsImported: 0,
        categoriesImported: 0,
        sessionsFailed: localData.sessions.length,
        categoriesFailed: localData.categories.length,
        errors: [(err as Error).message],
      })
      setPhase('error')
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal migration-modal">
        {/* Confirm phase */}
        {phase === 'confirm' && (
          <>
            <LiquidGlass as="button" className="modal-close" onClick={onSkip} radius={999} bevelDepth={8} scale={18}>
              <X size={18} />
            </LiquidGlass>
            <div className="modal-icon"><CloudUpload size={22} /></div>
            <h2>Import your existing data</h2>
            <p>We found local data in this browser. Import it to your cloud account so it's available on all devices.</p>
            <div className="migration-counts">
              <div className="migration-count-item">
                <Database size={16} />
                <span><b>{localData.sessions.length}</b> sessions</span>
              </div>
              <div className="migration-count-item">
                <Database size={16} />
                <span><b>{localData.categories.length}</b> categories</span>
              </div>
            </div>
            <p className="migration-note">
              Your local data will <strong>not</strong> be deleted. This import is safe to run multiple times — duplicates are automatically skipped.
            </p>
            <div className="migration-actions">
              <LiquidGlass as="button" className="primary-btn full" onClick={startMigration} radius={999} bevelDepth={12} scale={32}>
                <CloudUpload size={16} /> Import to cloud
              </LiquidGlass>
              <LiquidGlass as="button" className="soft-btn full" onClick={onSkip} radius={999} bevelDepth={8} scale={22}>
                Skip for now
              </LiquidGlass>
            </div>
          </>
        )}

        {/* Migrating phase */}
        {phase === 'migrating' && (
          <div className="migration-progress">
            <Loader2 size={32} className="migration-spinner" />
            <h2>Importing your data…</h2>
            <p>Please don't close this tab. This may take a moment.</p>
          </div>
        )}

        {/* Done phase */}
        {phase === 'done' && result && (
          <>
            <div className="modal-icon success"><Check size={22} /></div>
            <h2>Import complete{verificationOk ? ' ✓' : ''}</h2>
            <div className="migration-counts">
              <div className="migration-count-item">
                <Check size={14} />
                <span><b>{result.sessionsImported}</b> sessions imported</span>
              </div>
              <div className="migration-count-item">
                <Check size={14} />
                <span><b>{result.categoriesImported}</b> categories imported</span>
              </div>
            </div>
            {!verificationOk && (
              <p className="migration-warn">Cloud count is lower than expected — some records may need re-importing. Your local data is untouched.</p>
            )}
            <LiquidGlass as="button" className="primary-btn full" onClick={onDone} radius={999} bevelDepth={12} scale={32}>
              <Check size={16} /> Continue
            </LiquidGlass>
          </>
        )}

        {/* Error phase */}
        {phase === 'error' && result && (
          <>
            <div className="modal-icon error"><X size={22} /></div>
            <h2>Partial import</h2>
            <div className="migration-counts">
              <div className="migration-count-item success">
                <Check size={14} />
                <span><b>{result.sessionsImported}</b> sessions imported</span>
              </div>
              <div className="migration-count-item error">
                <X size={14} />
                <span><b>{result.sessionsFailed}</b> sessions failed</span>
              </div>
            </div>
            <div className="migration-errors">
              {result.errors.slice(0, 3).map((e, i) => <p key={i}>{e}</p>)}
            </div>
            <p className="migration-note">Your local data is safe. You can retry by signing out and back in.</p>
            <LiquidGlass as="button" className="soft-btn full" onClick={onDone} radius={999} bevelDepth={8} scale={22}>
              Continue anyway
            </LiquidGlass>
          </>
        )}
      </div>
    </div>
  )
}
