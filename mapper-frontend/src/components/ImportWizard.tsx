import { useEffect, useRef, useState } from 'react'
import { CheckCircle, CheckCircle2, ChevronLeft, FolderOpen, KeyRound, X } from 'lucide-react'
import { Button } from './ui/Button'
import {
  browseEcoinventFolder,
  connectToTask,
  startEcoinventImport,
  startEcoinventLocalImport,
  validateEcoinventCredentials,
  type TaskProgressMessage,
} from '../api/client'
import { useProjectStore } from '../stores/projectStore'

type Method = 'local' | 'credentials' | null

const SYSTEM_MODELS = [
  { id: 'cutoff', label: 'Cutoff', description: 'Attributional — most widely used' },
  { id: 'apos', label: 'APOS', description: 'Allocation at Point of Substitution' },
  { id: 'consequential', label: 'Consequential', description: 'Consequential — for decision support' },
]

const STEPS = ['connecting', 'biosphere', 'importing', 'strategies', 'matching', 'writing', 'done']

function ProgressStepper({ currentStep, progress, message }: { currentStep: string; progress: number; message: string }) {
  return (
    <div>
      <div style={{ height: 8, backgroundColor: 'var(--bg-hover)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
        <div style={{ height: '100%', backgroundColor: 'var(--accent)', borderRadius: 'var(--radius-full)', width: `${progress * 100}%`, transition: 'width var(--duration-normal) var(--ease-out)' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {STEPS.filter(s => s !== 'done').map((step) => {
          const idx = STEPS.indexOf(step)
          const curIdx = STEPS.indexOf(currentStep)
          const isDone = idx < curIdx || currentStep === 'done'
          const isActive = idx === curIdx && currentStep !== 'done'
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 'var(--radius-full)', flexShrink: 0,
                backgroundColor: isDone ? 'var(--success)' : isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                animation: isActive ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
              }} />
              <span style={{ fontSize: 'var(--text-sm)', color: isDone ? 'var(--success)' : isActive ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: isDone || isActive ? 500 : 400 }}>
                {step.replace(/_/g, ' ')}
              </span>
            </div>
          )
        })}
      </div>
      {message && (
        <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{message}</p>
      )}
      <style>{`@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}

function deriveDbName(folderPath: string): string {
  // Take parent folder of the datasets folder, normalise to lowercase-hyphens.
  // Example: "/foo/ecoinvent 3.10_cutoff_ecoSpold02/datasets" → "ecoinvent-3.10-cutoff"
  const segments = folderPath.replace(/\\/g, '/').split('/').filter(Boolean)
  const tail = segments[segments.length - 1] || ''
  const parent = segments[segments.length - 2] || ''
  const candidate = tail.toLowerCase() === 'datasets' ? parent : tail
  const match = candidate.match(/ecoinvent[\s_-]*([\d.]+)[\s_-]+(cutoff|apos|consequential)/i)
  if (match) return `ecoinvent-${match[1]}-${match[2].toLowerCase()}`
  return candidate.replace(/[\s_]+/g, '-').replace(/-+/g, '-').toLowerCase() || 'ecoinvent-local'
}

interface ImportWizardProps {
  onClose: () => void
}

export function ImportWizard({ onClose }: ImportWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [method, setMethod] = useState<Method>(null)

  // Credentials flow state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [validating, setValidating] = useState(false)
  const [credError, setCredError] = useState('')
  const [versions, setVersions] = useState<string[]>([])
  const [selectedVersion, setSelectedVersion] = useState('')
  const [selectedModel, setSelectedModel] = useState('cutoff')

  // Local folder flow state
  const [folderPath, setFolderPath] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [folderInfo, setFolderInfo] = useState<{ path: string; spold_count: number } | null>(null)
  const [dbName, setDbName] = useState('')

  // Shared progress state
  const [taskProgress, setTaskProgress] = useState<TaskProgressMessage>({ step: '', progress: 0, message: '' })
  const [_importDone, setImportDone] = useState(false)
  const [importError, setImportError] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const { fetchDatabases } = useProjectStore()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      wsRef.current?.close()
    }
  }, [onClose])

  // ── Credentials flow ──
  const handleValidate = async () => {
    setValidating(true)
    setCredError('')
    try {
      const res = await validateEcoinventCredentials(username, password)
      if (res.valid) {
        setVersions(res.versions)
        setSelectedVersion(res.versions[0] ?? '')
        setStep(2)
      } else {
        setCredError(res.message || 'Invalid credentials')
      }
    } catch (e: unknown) {
      setCredError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setValidating(false)
    }
  }

  // ── Local folder flow ──
  const handleVerifyFolder = async () => {
    setVerifying(true)
    setFolderError('')
    setFolderInfo(null)
    try {
      const res = await browseEcoinventFolder(folderPath.trim())
      if (res.valid) {
        setFolderInfo({ path: res.path, spold_count: res.spold_count })
        setDbName(deriveDbName(res.path))
      } else {
        setFolderError(res.message || 'Invalid folder')
      }
    } catch (e: unknown) {
      setFolderError(e instanceof Error ? e.message : 'Could not verify folder')
    } finally {
      setVerifying(false)
    }
  }

  const goToLocalStep2 = () => setStep(2)

  // ── Shared import kick-off ──
  const handleImport = async () => {
    setStep(3)
    setImportError('')
    setTaskProgress({ step: '', progress: 0, message: '' })
    try {
      const started = method === 'local'
        ? await startEcoinventLocalImport(dbName.trim(), folderInfo?.path ?? folderPath.trim())
        : await startEcoinventImport(username, password, selectedVersion, selectedModel)
      wsRef.current = connectToTask(
        `/ws/import/${started.task_id}`,
        (msg) => {
          setTaskProgress(msg)
          if (msg.step === 'done') {
            setImportDone(true)
            setStep(4)
            fetchDatabases()
          } else if (msg.step === 'error') {
            setImportError(msg.message)
          }
        },
      )
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    }
  }

  const backToMethods = () => {
    setMethod(null)
    setCredError('')
    setFolderError('')
  }

  const canStartCredentials = !!username && !!password && !validating
  const canStartImport =
    method === 'local'
      ? !!folderInfo && !!dbName.trim()
      : !!selectedVersion && !!selectedModel

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        width: 620,
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
        animation: 'modalIn var(--duration-normal) var(--ease-out)',
      }}>
        <style>{`@keyframes modalIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>

        {/* Modal header */}
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>Import ecoinvent</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>Step {step} of 4</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 'var(--radius-sm)', display: 'flex' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}>
            <X size={16} />
          </button>
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 'var(--space-4) 0 0' }}>
          {[1,2,3,4].map((s) => (
            <div key={s} style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', backgroundColor: s <= step ? 'var(--accent)' : 'var(--bg-active)' }} />
          ))}
        </div>

        <div style={{ padding: 'var(--space-6)' }}>

          {/* Step 1: Method selection */}
          {step === 1 && method === null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
                Choose how to import the ecoinvent database.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                {/* Local — recommended */}
                <div
                  onClick={() => setMethod('local')}
                  style={{
                    position: 'relative',
                    padding: 'var(--space-5)',
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1.5px solid var(--accent)',
                    borderRadius: 'var(--radius-lg)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 10,
                    transition: 'transform var(--duration-fast) var(--ease-out)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                >
                  <span style={{
                    position: 'absolute', top: 10, right: 10,
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: 'var(--accent)', backgroundColor: 'var(--accent-subtle)',
                    padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  }}>Recommended</span>
                  <FolderOpen size={24} color="var(--accent)" />
                  <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Import from local files
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Download ecospold files from ecoquery.ecoinvent.org, then select the datasets folder.
                  </div>
                  <Button variant="primary" onClick={(e) => { e.stopPropagation(); setMethod('local') }} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                    Select folder
                  </Button>
                </div>

                {/* Credentials */}
                <div
                  onClick={() => setMethod('credentials')}
                  style={{
                    padding: 'var(--space-5)',
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-lg)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 10,
                    transition: 'transform var(--duration-fast) var(--ease-out)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                >
                  <KeyRound size={24} color="var(--text-secondary)" />
                  <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Log in with ecoinvent account
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Automatically download from ecoinvent servers (may be unreliable).
                  </div>
                  <Button variant="secondary" onClick={(e) => { e.stopPropagation(); setMethod('credentials') }} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                    Enter credentials
                  </Button>
                </div>
              </div>

              <div style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}>
                <strong style={{ color: 'var(--text-primary)' }}>Need ecoinvent files?</strong>{' '}
                Download them from ecoquery.ecoinvent.org → Files → select version → "ecoSpold02"
                (~94MB for v3.10).
              </div>
            </div>
          )}

          {/* Step 1 — Local folder sub-flow */}
          {step === 1 && method === 'local' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <button
                onClick={backToMethods}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', padding: 0 }}
              >
                <ChevronLeft size={12} /> Back to import methods
              </button>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>
                  Folder path
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={folderPath}
                    onChange={(e) => { setFolderPath(e.target.value); setFolderInfo(null); setFolderError('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && folderPath.trim()) handleVerifyFolder() }}
                    placeholder="/Users/you/ecoinvent 3.10 cutoff ecoSpold02/datasets"
                    style={{
                      flex: 1, height: 36, padding: '0 12px',
                      backgroundColor: 'var(--bg-elevated)',
                      border: `1px solid ${folderError ? 'var(--danger)' : 'var(--border-default)'}`,
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-primary)',
                      fontSize: 'var(--text-sm)',
                      fontFamily: 'var(--font-mono)',
                      outline: 'none',
                    }}
                  />
                  <Button variant="secondary" onClick={handleVerifyFolder} disabled={!folderPath.trim() || verifying}>
                    {verifying ? 'Verifying…' : 'Verify'}
                  </Button>
                </div>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 6 }}>
                  The path should point to the "datasets" folder inside the extracted ecospold archive.
                </p>
              </div>

              {folderError && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', margin: 0 }}>{folderError}</p>
              )}
              {folderInfo && (
                <div style={{
                  padding: 'var(--space-3) var(--space-4)',
                  backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)',
                  border: '1px solid var(--success)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  color: 'var(--success)',
                  fontSize: 'var(--text-sm)', fontWeight: 500,
                }}>
                  <CheckCircle2 size={16} />
                  Found {folderInfo.spold_count.toLocaleString()} .spold files
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" onClick={goToLocalStep2} disabled={!folderInfo}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* Step 1 — Credentials sub-flow */}
          {step === 1 && method === 'credentials' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <button
                onClick={backToMethods}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', padding: 0 }}
              >
                <ChevronLeft size={12} /> Back to import methods
              </button>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
                Enter your ecoinvent credentials. They are used only for this session.
              </p>
              {[
                { label: 'Username', value: username, onChange: setUsername, type: 'text' },
                { label: 'Password', value: password, onChange: setPassword, type: 'password' },
              ].map(({ label, value, onChange, type }) => (
                <div key={label}>
                  <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 6 }}>{label}</label>
                  <input
                    type={type}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canStartCredentials) handleValidate() }}
                    style={{
                      width: '100%', height: 36, padding: '0 12px',
                      backgroundColor: 'var(--bg-elevated)',
                      border: `1px solid ${credError ? 'var(--danger)' : 'var(--border-default)'}`,
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-primary)', fontSize: 'var(--text-base)',
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
              {credError && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{credError}</p>}
              <Button variant="primary" onClick={handleValidate} disabled={!canStartCredentials} style={{ alignSelf: 'flex-end' }}>
                {validating ? 'Validating…' : 'Validate & Continue'}
              </Button>
            </div>
          )}

          {/* Step 2 — Configure (per method) */}
          {step === 2 && method === 'local' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Folder:</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>{folderInfo?.path}</span>
                {folderInfo && <> · {folderInfo.spold_count.toLocaleString()} datasets</>}
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 8 }}>
                  Database name
                </label>
                <input
                  type="text"
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                  placeholder="ecoinvent-3.10-cutoff"
                  style={{
                    width: '100%', height: 36, padding: '0 12px',
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
                    outline: 'none',
                  }}
                />
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 6 }}>
                  This is the name the database will have inside the project. Auto-suggested from the folder name.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button variant="primary" onClick={handleImport} disabled={!canStartImport}>
                  Import {folderInfo ? `${folderInfo.spold_count.toLocaleString()} datasets` : 'datasets'}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && method === 'credentials' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 8 }}>Version</label>
                <select
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                  style={{ width: '100%', height: 36, padding: '0 12px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', outline: 'none', cursor: 'pointer' }}
                >
                  {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', display: 'block', marginBottom: 8 }}>System Model</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {SYSTEM_MODELS.map((m) => (
                    <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: `1px solid ${selectedModel === m.id ? 'var(--accent)' : 'var(--border-default)'}`, backgroundColor: selectedModel === m.id ? 'var(--accent-subtle)' : 'var(--bg-elevated)', cursor: 'pointer' }}>
                      <input type="radio" value={m.id} checked={selectedModel === m.id} onChange={() => setSelectedModel(m.id)} style={{ accentColor: 'var(--accent)' }} />
                      <div>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{m.label}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{m.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button variant="primary" onClick={handleImport} disabled={!canStartImport}>
                  Import ecoinvent {selectedVersion}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Progress */}
          {step === 3 && (
            <div>
              {importError ? (
                <div>
                  <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>Import failed: {importError}</p>
                  <Button variant="secondary" onClick={() => setStep(2)}>Go Back</Button>
                </div>
              ) : (
                <ProgressStepper currentStep={taskProgress.step} progress={taskProgress.progress} message={taskProgress.message} />
              )}
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
              <CheckCircle size={48} color="var(--success)" style={{ marginBottom: 'var(--space-4)' }} />
              <h4 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                {method === 'local'
                  ? `Database "${dbName}" imported`
                  : `ecoinvent ${selectedVersion} ${selectedModel} imported`}
              </h4>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
                The database is now available in the Database Explorer.
              </p>
              <Button variant="primary" onClick={onClose}>Close</Button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
