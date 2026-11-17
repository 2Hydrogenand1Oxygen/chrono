import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown,
  ChevronLeft, ChevronRight, Clock3, Cloud, CloudOff, Download, History,
  LogIn, LogOut, Maximize2, Menu, Minimize2, Moon, MoreHorizontal, PanelLeft,
  PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, RotateCcw,
  Settings, Sidebar, Sparkles, Sun, Timer, Trash2, Type, Upload, X
} from 'lucide-react'
import { LiquidGlass } from './components/LiquidGlass'
import { LoginScreen } from './components/LoginScreen'
import { MigrationModal } from './components/MigrationModal'
import { SyncStatus, CloudIndicator } from './components/SyncStatus'
import { useAuth } from './hooks/useAuth'
import { useSync } from './hooks/useSync'
import { hasMigratableData, readLocalData } from './lib/migration'
import type { AppSession, AppCategory, AppPreferences } from './lib/db'

export type AppFont = 'inter' | 'manrope' | 'space-grotesk' | 'jetbrains-mono'
export type ClockFont = 'inter' | 'manrope' | 'space-grotesk' | 'jetbrains-mono'
export type ClockStyle = 'clean' | 'digital' | 'rounded'
export type SidebarMode = 'expanded' | 'compact' | 'hidden'

type Category = AppCategory & { id: string; name: string; color: string; subs: string[] }
type Session = AppSession & { id: string; start: number; end: number; duration: number; category: string; subcategory: string; source: 'stopwatch' | 'timer' | 'manual'; notes?: string }
type Active = { mode: 'stopwatch' | 'timer'; status: 'running' | 'paused'; startedAt: number | null; elapsed: number; duration: number; category: string; subcategory: string; notes?: string }
type Page = 'clock' | 'analytics' | 'calendar' | 'history' | 'settings'

const starterCategories: Category[] = [
  { id: 'college', name: 'College', color: '#557FEA', subs: ['Lectures', 'DSP', 'Machine Learning', 'Embedded Systems', 'Assignments', 'Exams'] },
  { id: 'learning', name: 'Personal learning', color: '#6AA9B8', subs: ['Programming', 'Reading', 'Online courses', 'Philosophy'] },
  { id: 'work', name: 'Work', color: '#8174E8', subs: ['Projects', 'Freelancing', 'Internship'] },
  { id: 'personal', name: 'Personal', color: '#8892A4', subs: ['Exercise', 'Reading', 'Other'] },
]

const STORE = 'chrono-v1'

const fmt = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60
  return h > 0 ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}
const fmtHms = (seconds:number) => { const s=Math.max(0,Math.floor(seconds)); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}` }
const durationLabel = (seconds: number) => { const h=Math.floor(seconds/3600), m=Math.floor((seconds%3600)/60); return h ? `${h}h ${m}m` : `${m}m` }
const dateKey = (t: number) => { const d=new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const prettyDate = (t: number) => new Date(t).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})
const timeLabel = (t: number) => new Date(t).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})
const uid = () => Math.random().toString(36).slice(2,10)

const playTimerChime = () => {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    const now = ctx.currentTime
    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, start)
      gain.gain.setValueAtTime(0.12, start)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + dur)
    }
    playTone(523.25, now, 0.3)
    playTone(659.25, now + 0.15, 0.3)
    playTone(783.99, now + 0.30, 0.5)
  } catch {
    // Gracefully ignore audio errors or browser autoplay limitations
  }
}

function readStore() {
  try {
    const raw=localStorage.getItem(STORE);
    if(raw) {
      const parsed = JSON.parse(raw)
      return {
        sessions: (parsed.sessions || []) as Session[],
        categories: (parsed.categories || starterCategories) as Category[],
        active: (parsed.active || null) as Active|null,
        theme: (parsed.theme || 'light') as 'light'|'dark',
        goal: (parsed.goal ?? '4') as string,
        appFont: (parsed.appFont || 'inter') as AppFont,
        clockFont: (parsed.clockFont || 'inter') as ClockFont,
        clockStyle: (parsed.clockStyle || 'clean') as ClockStyle,
        sidebarMode: (parsed.sidebarMode || 'expanded') as SidebarMode,
      }
    }
  } catch { /* ignore damaged local cache */ }
  return {
    sessions: [] as Session[],
    categories: starterCategories,
    active: null as Active|null,
    theme: 'light' as 'light'|'dark',
    goal: '4',
    appFont: 'inter' as AppFont,
    clockFont: 'inter' as ClockFont,
    clockStyle: 'clean' as ClockStyle,
    sidebarMode: 'expanded' as SidebarMode,
  }
}

const APP_FONTS: { id: AppFont; name: string; tag: string; sample: string; family: string }[] = [
  { id: 'inter', name: 'Inter', tag: 'Clean & modern', sample: 'Focus on what matters most · 12:45', family: "var(--font-inter)" },
  { id: 'manrope', name: 'Manrope', tag: 'Rounded & elegant', sample: 'Every single minute counts · 12:45', family: "var(--font-manrope)" },
  { id: 'space-grotesk', name: 'Space Grotesk', tag: 'Technical & contemporary', sample: 'Built for structured focus · 12:45', family: "var(--font-space-grotesk)" },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', tag: 'Monospaced precision', sample: '100% focused session · 12:45', family: "var(--font-jetbrains-mono)" },
]

const CLOCK_FONTS: { id: ClockFont; name: string; tag: string; family: string }[] = [
  { id: 'inter', name: 'Inter', tag: 'Modern geometric', family: "var(--font-inter)" },
  { id: 'manrope', name: 'Manrope', tag: 'Curved geometry', family: "var(--font-manrope)" },
  { id: 'space-grotesk', name: 'Space Grotesk', tag: 'Technical display', family: "var(--font-space-grotesk)" },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', tag: 'Monospace code', family: "var(--font-jetbrains-mono)" },
]

const CLOCK_STYLES: { id: ClockStyle; name: string; description: string }[] = [
  { id: 'clean', name: 'Clean', description: 'Balanced sans-serif weight with natural kerning' },
  { id: 'digital', name: 'Digital', description: 'Monospaced technical appearance with sharper glow' },
  { id: 'rounded', name: 'Rounded', description: 'Soft, contemporary pill-like contours and heavier weight' },
]

declare global { interface Window { documentPictureInPicture?: { requestWindow: (options?: {width?:number;height?:number}) => Promise<Window> } } }

export default function App() {
  const { isConfigured, user, loading: authLoading, error: authError, success: authSuccess, signIn, signUp, signInWithGoogle, signOut, resetPassword, clearError } = useAuth()

  const initial = useRef(readStore()).current
  const [sessions,setSessions] = useState<Session[]>(initial.sessions)
  const [categories,setCategories] = useState<Category[]>(initial.categories)
  const [active,setActive] = useState<Active|null>(initial.active)
  const [theme,setTheme] = useState<'light'|'dark'>(initial.theme)
  const [goal,setGoal] = useState(initial.goal ?? '4')
  const [appFont, setAppFont] = useState<AppFont>(initial.appFont ?? 'inter')
  const [clockFont, setClockFont] = useState<ClockFont>(initial.clockFont ?? 'inter')
  const [clockStyle, setClockStyle] = useState<ClockStyle>(initial.clockStyle ?? 'clean')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(initial.sidebarMode ?? 'expanded')
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isImmersive, setIsImmersive] = useState(false)
  const [page,setPage] = useState<Page>('clock')
  const [now,setNow] = useState(Date.now())
  const [timerInput,setTimerInput] = useState('25')
  const [clockMode,setClockMode] = useState<'stopwatch'|'timer'>('stopwatch')
  const [selectedCategory,setSelectedCategory] = useState('')
  const [selectedSub,setSelectedSub] = useState('')
  const [assignOpen,setAssignOpen] = useState(false)
  const [pendingSessionId,setPendingSessionId] = useState<string|null>(null)
  const [pendingNotes,setPendingNotes] = useState('')
  const [completedTimer,setCompletedTimer] = useState<{duration:number;finishedAt:number;sessionId:string}|null>(null)
  const completedTimerRef = useRef(completedTimer)
  useEffect(()=>{ completedTimerRef.current = completedTimer },[completedTimer])
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const sidebarMenuRef = useRef<HTMLDivElement | null>(null)
  const [manualOpen,setManualOpen] = useState(false)
  const [manualDate,setManualDate] = useState(dateKey(Date.now()))
  const [manualStart,setManualStart] = useState('09:00')
  const [manualEnd,setManualEnd] = useState('10:00')
  const [manualCat,setManualCat] = useState('')
  const [manualSub,setManualSub] = useState('')
  const [manualNotes,setManualNotes] = useState('')
  const [month,setMonth] = useState(new Date())
  const [filter,setFilter] = useState('all')
  const [newCategory,setNewCategory] = useState('')
  const [newSub,setNewSub] = useState('')
  const [showMigration,setShowMigration] = useState(false)
  const [migrationDismissed,setMigrationDismissed] = useState(false)
  const [localModeOverride,setLocalModeOverride] = useState(false)

  const pipRef = useRef<Window|null>(null)
  const pipStateRef = useRef<{active:Active|null;elapsed:number}>({active,elapsed:0})

  // ── Cloud sync ─────────────────────────────────────────────────────────────
  const handleCloudData = useCallback((
    cloudSessions: AppSession[],
    cloudCategories: AppCategory[],
    prefs: AppPreferences | null
  ) => {
    // Safe merge: Never wipe local data if cloud returns empty on a fresh account
    setSessions(prev => {
      if (cloudSessions.length === 0 && prev.length > 0) return prev
      const cloudLocalIds = new Set(cloudSessions.map(s => s.id))
      const unsynced = prev.filter(s => !cloudLocalIds.has(s.id))
      return [...cloudSessions, ...unsynced] as Session[]
    })

    setCategories(prev => {
      if (cloudCategories.length === 0 && prev.length > 0) return prev
      const cloudLocalIds = new Set(cloudCategories.map(c => c.id))
      const unsynced = prev.filter(c => !cloudLocalIds.has(c.id))
      return [...cloudCategories, ...unsynced] as Category[]
    })

    if (prefs) {
      setTheme(prefs.theme)
      setGoal(String(prefs.dailyGoalHours))
    }
  }, [])

  const {
    status: syncStatus,
    errorMessage: syncError,
    lastSynced,
    pushSession,
    pushCategory,
    pushCategoryDelete,
    pushSessionDelete,
    pushPreferences,
  } = useSync(user, handleCloudData)

  // Prompt for migration on first sign-in if local data exists
  useEffect(() => {
    if (user && !migrationDismissed && hasMigratableData()) {
      setShowMigration(true)
    }
  }, [user, migrationDismissed])

  // ── Local persistence & timer ticking (with background Web Worker) ────────
  const isRunning = (active !== null && active.status === 'running') || completedTimer !== null;

  useEffect(() => {
    let worker: Worker | null = null
    let blobUrl: string | null = null
    try {
      const workerScript = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                self.postMessage('tick');
              }, 1000);
            }
          } else if (e.data === 'stop') {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      `
      const blob = new Blob([workerScript], { type: 'application/javascript' })
      blobUrl = URL.createObjectURL(blob)
      worker = new Worker(blobUrl)
      worker.onmessage = () => {
        setNow(Date.now())
      }
      if (isRunning) {
        worker.postMessage('start')
      }
    } catch {
      // Fallback if Web Workers are restricted in environment
    }

    // Only tick rapidly (500ms) when a timer is actually running or in overtime.
    // When idle or paused, tick once every 30s to keep midnight date rolling without burning CPU.
    const intervalMs = isRunning ? 500 : 30000;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)

    return () => {
      clearInterval(id)
      if (worker) {
        worker.postMessage('stop')
        worker.terminate()
      }
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [isRunning])

  useEffect(() => {
    localStorage.setItem(STORE,JSON.stringify({
      sessions,
      categories,
      active,
      theme,
      goal,
      appFont,
      clockFont,
      clockStyle,
      sidebarMode,
    }))
  },[sessions,categories,active,theme,goal,appFont,clockFont,clockStyle,sidebarMode])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  },[theme])

  useEffect(() => {
    document.documentElement.dataset.appFont = appFont
  },[appFont])

  useEffect(() => {
    document.documentElement.dataset.clockFont = clockFont
  },[clockFont])

  useEffect(() => {
    document.documentElement.dataset.clockStyle = clockStyle
  },[clockStyle])

  // Timestamp-based elapsed calculation (never counts paused time)
  const elapsed = useMemo(()=>{
    if(!active) return 0
    if(active.mode==='stopwatch') {
      return active.elapsed + (active.status==='running' && active.startedAt ? (now-active.startedAt)/1000 : 0)
    }
    const remaining = active.status==='running' && active.startedAt
      ? active.duration - active.elapsed - (now-active.startedAt)/1000
      : active.duration - active.elapsed
    return Math.max(0,remaining)
  },[active,now])

  useEffect(()=>{ pipStateRef.current={active,elapsed} },[active,elapsed])

  const todayKey = dateKey(now);
  const totalToday = useMemo(() => {
    const past = sessions.filter(s => dateKey(s.start) === todayKey).reduce((a, s) => a + s.duration, 0);
    const curr = (active && dateKey(active.startedAt || now) === todayKey)
      ? (active.mode === 'stopwatch' ? elapsed : active.duration - elapsed)
      : 0;
    return past + curr;
  }, [sessions, active, elapsed, now, todayKey]);

  const todaySessions = useMemo(() => {
    return sessions.filter(s => dateKey(s.start) === todayKey).sort((a, b) => b.start - a.start);
  }, [sessions, todayKey]);
  const currentCategory = categories.find(c=>c.id===selectedCategory)

  // ── Category management ────────────────────────────────────────────────────
  const handleAddCategory = (name: string): string => {
    const trimmed = name.trim()
    if (!trimmed) return ''
    const newId = uid()
    const newCat: Category = {
      id: newId,
      name: trimmed,
      color: ['#557FEA', '#8174E8', '#6AA9B8', '#8892A4'][categories.length % 4],
      subs: []
    }
    const updated = [...categories, newCat]
    setCategories(updated)
    if (user) pushCategory(newCat, updated.length - 1)
    return newId
  }

  const handleAddSubcategory = (catId: string, subName: string) => {
    const trimmed = subName.trim()
    if (!trimmed || !catId) return
    setCategories(prev => {
      const updated = prev.map(c => {
        if (c.id !== catId) return c
        if (c.subs.includes(trimmed)) return c
        return { ...c, subs: [...c.subs, trimmed] }
      })
      if (user) {
        const updatedCat = updated.find(c => c.id === catId)
        if (updatedCat) pushCategory(updatedCat, updated.findIndex(c => c.id === catId))
      }
      return updated
    })
    if (selectedCategory === catId) setSelectedSub(trimmed)
    if (manualCat === catId) setManualSub(trimmed)
  }

  // ── Session management ─────────────────────────────────────────────────────
  const saveSession = useCallback((data:{start:number;end:number;duration:number;source:'stopwatch'|'timer'|'manual';category:string;subcategory:string;notes?:string}): Session | null =>{
    if(data.duration<1) return null
    const session: Session = {id:uid(),...data}
    setSessions(prev=>[session,...prev])
    if (user) pushSession(session)
    return session
  },[user, pushSession])

  const finishActive = useCallback((a:Active, end=Date.now())=>{
    const delta=a.startedAt ? (end-a.startedAt)/1000 : 0
    const duration=a.mode==='stopwatch' ? a.elapsed+delta : Math.min(a.duration,a.elapsed+delta)
    const start=end-duration*1000
    const payload={
      start,
      end,
      duration,
      source:a.mode,
      category:a.category || '',
      subcategory:a.subcategory || '',
      notes:a.notes
    }

    // Always immediately persist the session so completed time is NEVER lost
    const saved = saveSession(payload)

    if(!a.category && !a.subcategory && saved) {
      setPendingSessionId(saved.id)
      setPendingNotes(a.notes || '')
      setAssignOpen(true)
    }

    if(a.mode==='timer') {
      setCompletedTimer({
        duration: a.duration,
        finishedAt: end,
        sessionId: saved?.id || ''
      })
      playTimerChime()
    }

    setActive(null)
  },[saveSession])

  useEffect(()=>{
    if(active?.mode==='timer' && active.status==='running' && elapsed<=0) finishActive(active,now)
  },[active,elapsed,finishActive,now])

  useEffect(()=>{
    if (active) {
      document.title = fmt(elapsed)
    } else if (completedTimer) {
      const overtimeSec = Math.max(0, Math.floor((now - completedTimer.finishedAt) / 1000))
      const mins = Math.max(1, Math.round(completedTimer.duration / 60))
      const negTime = `-${fmt(overtimeSec)}`
      document.title = `⏰ ${negTime} · ${mins} min timer over`
    } else {
      document.title = 'Chrono'
    }
  },[active, elapsed, completedTimer, now])

  // ── Preferences sync ───────────────────────────────────────────────────────
  useEffect(()=>{
    if(user) pushPreferences({ theme, dailyGoalHours: Math.max(1, Number(goal)||4) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[theme, goal, user])

  // ── Timer controls ─────────────────────────────────────────────────────────
  const startStopwatch = () => {
    const timestamp = Date.now()
    setNow(timestamp)
    setCompletedTimer(null)
    setClockMode('stopwatch')
    setActive({mode:'stopwatch',status:'running',startedAt:timestamp,elapsed:0,duration:0,category:selectedCategory,subcategory:selectedSub})
  }
  const startTimer = () => {
    const timestamp = Date.now()
    setNow(timestamp)
    setCompletedTimer(null)
    setClockMode('timer')
    const seconds=Math.max(1,Math.round(Number(timerInput)*60))
    setActive({mode:'timer',status:'running',startedAt:timestamp,elapsed:0,duration:seconds,category:selectedCategory,subcategory:selectedSub})
  }
  const pause = () => { if(!active) return; const timestamp=Date.now(); setNow(timestamp); const delta=active.startedAt ? (timestamp-active.startedAt)/1000 : 0; setActive({...active,status:'paused',startedAt:null,elapsed:active.elapsed+delta}) }
  const resume = () => { if(active) { const timestamp=Date.now(); setNow(timestamp); setActive({...active,status:'running',startedAt:timestamp}) } }
  const stop = () => { if(!active) return; const timestamp=Date.now(); setNow(timestamp); const delta=active.status==='running' && active.startedAt ? (timestamp-active.startedAt)/1000 : 0; finishActive({...active,elapsed:active.elapsed+delta,startedAt:null},timestamp) }
  const reset = () => {
    setNow(Date.now())
    setActive(null)
    setCompletedTimer(null)
  }

  const closeAssignModal = () => {
    setPendingSessionId(null)
    setPendingNotes('')
    setAssignOpen(false)
    setSelectedCategory('')
    setSelectedSub('')
    setCompletedTimer(null)
  }

  const savePending = () => {
    if(pendingSessionId) {
      setSessions(prev => prev.map(s => {
        if(s.id === pendingSessionId) {
          const updated = {
            ...s,
            category: selectedCategory,
            subcategory: selectedSub,
            notes: pendingNotes.trim() || undefined
          }
          if(user) pushSession(updated)
          return updated
        }
        return s
      }))
    }
    closeAssignModal()
  }

  // ── Immersive Fullscreen Mode & Screen Wake Lock ───────────────────────────
  const enterImmersive = async () => {
    setIsImmersive(true)
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // CSS-based immersive fallback engages automatically via isImmersive
    }
  }

  const exitImmersive = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
    setIsImmersive(false)
  }

  // Synchronize React state with browser fullscreenchange events
  useEffect(() => {
    const handleFsChange = () => {
      const isBrowserFs = !!document.fullscreenElement
      if (!isBrowserFs && isImmersive) {
        setIsImmersive(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [isImmersive])

  // Screen Wake Lock API during active immersive tracking
  useEffect(() => {
    if (isImmersive && active?.status === 'running') {
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(lock => {
          wakeLockRef.current = lock
        }).catch(() => {})
      }
    } else {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {})
        wakeLockRef.current = null
      }
    }
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {})
        wakeLockRef.current = null
      }
    }
  }, [isImmersive, active?.status])

  // Keyboard shortcuts: Space (Start/Pause), Escape (Exit), R (Reset when stopped/paused)
  useEffect(() => {
    if (!isImmersive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return

      if (e.key === 'Escape') {
        e.preventDefault()
        exitImmersive()
      } else if (e.code === 'Space') {
        e.preventDefault()
        if (!active) {
          if (clockMode === 'stopwatch') startStopwatch()
          else startTimer()
        } else {
          if (active.status === 'running') pause()
          else resume()
        }
      } else if (e.key === 'r' || e.key === 'R') {
        if (!active || active.status === 'paused') {
          e.preventDefault()
          reset()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isImmersive, active, clockMode])

  // Click outside to close sidebar layout menu
  useEffect(() => {
    if (!sidebarMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarMenuRef.current && !sidebarMenuRef.current.contains(e.target as Node)) {
        setSidebarMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sidebarMenuOpen])

  // Handle mobile drawer Escape dismissal and body scroll lock
  useEffect(() => {
    if (!mobileNavOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    const origOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = origOverflow
    }
  }, [mobileNavOpen])

  // On laptop/desktop viewports (> 768px), touching or clicking anywhere on the compact sidebar expands it
  const handleSidebarClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (sidebarMode === 'compact' && typeof window !== 'undefined' && window.matchMedia('(min-width: 769px)').matches) {
      if (sidebarMenuRef.current && sidebarMenuRef.current.contains(e.target as Node)) {
        return
      }
      setSidebarMode('expanded')
    }
  }, [sidebarMode])

  // ── Picture-in-Picture ─────────────────────────────────────────────────────
  const openPip = async () => {
    if(!window.documentPictureInPicture) { alert('Floating mini-clock is not supported in this browser. Try the latest Chrome or Edge.'); return }
    try {
      const pip=await window.documentPictureInPicture.requestWindow({width:260,height:150}); pipRef.current=pip
      const bg = theme === 'dark' ? '#090B10' : '#EEF1F7'
      const text = theme === 'dark' ? '#F5F7FC' : '#202536'
      const accent = theme === 'dark' ? '#91AFFF' : '#557FEA'
      pip.document.head.innerHTML=`<title>Timer</title><style>body{margin:0;background:${bg};color:${text};font:500 14px -apple-system,BlinkMacSystemFont,"SF Pro Display","DM Sans",system-ui,sans-serif;display:grid;place-items:center;height:100vh;-webkit-font-smoothing:antialiased}.wrap{text-align:center}.time{font:600 42px -apple-system,BlinkMacSystemFont,"SF Pro Display","DM Sans",system-ui,sans-serif;letter-spacing:-1.5px;margin:8px 0;color:${text}}.label{font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:${accent}}</style>`
      const wrap=pip.document.createElement('div'); wrap.className='wrap'; wrap.innerHTML='<div class="label">TIME REMAINING</div><div class="time">00:00</div>'; pip.document.body.appendChild(wrap)
      const update=()=>{
        if(pip.closed) return;
        const timeEl=pip.document.querySelector('.time');
        const labelEl=pip.document.querySelector('.label');
        const state=pipStateRef.current;
        const comp=completedTimerRef.current;
        if(state.active) {
          if(timeEl) timeEl.textContent=fmt(state.elapsed);
          if(labelEl) labelEl.textContent=state.active.mode==='timer'?'TIME REMAINING':'STOPWATCH';
        } else if(comp) {
          const ot = Math.max(0, Math.floor((Date.now() - comp.finishedAt)/1000));
          const mins = Math.max(1, Math.round(comp.duration/60));
          if(timeEl) timeEl.textContent=`-${fmt(ot)}`;
          if(labelEl) labelEl.textContent=`${mins}M TIMER OVER`;
        } else {
          if(timeEl) timeEl.textContent='00:00';
          if(labelEl) labelEl.textContent='CHRONO';
        }
      }
      update(); const id=window.setInterval(()=>{ if(pip.closed){clearInterval(id);return} update() },250); pip.addEventListener('pagehide',()=>clearInterval(id))
    } catch { /* user dismissed PiP */ }
  }

  // ── Manual session ─────────────────────────────────────────────────────────
  const addManual = () => {
    const start=new Date(`${manualDate}T${manualStart}`).getTime(), end=new Date(`${manualDate}T${manualEnd}`).getTime()
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start) return alert('Please choose a valid time range.')
    saveSession({start,end,duration:(end-start)/1000,category:manualCat,subcategory:manualSub,source:'manual',notes:manualNotes.trim()||undefined})
    setManualNotes('')
    setManualOpen(false)
  }

  // ── Export CSV & JSON ──────────────────────────────────────────────────────
  const exportCSV=()=>{
    const rows=[['Date','Start','End','Duration seconds','Category','Subcategory','Source','Notes'],...sessions.map(s=>[dateKey(s.start),timeLabel(s.start),timeLabel(s.end),Math.round(s.duration),categories.find(c=>c.id===s.category)?.name||'',s.subcategory,s.source,s.notes||''])]
    const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    const a=document.createElement('a'); a.href=url; a.download='chrono-history.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const exportJSON=()=>{
    const payload={
      exportedAt: new Date().toISOString(),
      user: user?.email ?? 'local-user',
      sessions,
      categories,
      preferences: { theme, dailyGoalHours: Number(goal)||4 }
    }
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))
    const a=document.createElement('a'); a.href=url; a.download='chrono-backup.json'; a.click(); URL.revokeObjectURL(url)
  }

  // ── Computed analytics ────────────────────────────────────────────────────
  const dailyGoalSeconds=Math.max(1,Number(goal)||4)*3600
  const progress=Math.min(100,totalToday/dailyGoalSeconds*100)
  const categoryTotals=categories.map(c=>({...c,total:sessions.filter(s=>s.category===c.id && dateKey(s.start)===dateKey(now)).reduce((a,s)=>a+s.duration,0)})).filter(c=>c.total>0)
  const allTime=sessions.reduce((a,s)=>a+s.duration,0)
  const weekStart=new Date(now); weekStart.setHours(0,0,0,0); weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7))
  const weekTotal=sessions.filter(s=>s.start>=weekStart.getTime()).reduce((a,s)=>a+s.duration,0)

  // ── Auth loading state ────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-mark"><Clock3 size={28} /></div>
        <p>Loading Chrono…</p>
      </div>
    )
  }

  // ── Show Login Screen if Supabase is configured and user is not signed in ──
  const isLocalActive = !isConfigured || localModeOverride
  if (!isLocalActive && !user) {
    return (
      <LoginScreen
        isConfigured={isConfigured}
        onSignIn={signIn}
        onSignUp={signUp}
        onGoogleSignIn={signInWithGoogle}
        onReset={resetPassword}
        onContinueLocal={() => setLocalModeOverride(true)}
        loading={authLoading}
        error={authError}
        success={authSuccess}
        clearError={clearError}
      />
    )
  }

  // ── Main Chrono Application ───────────────────────────────────────────────
  return (
    <div className="app-shell" data-sidebar={sidebarMode}>
      {/* Mobile Drawer Backdrop */}
      {mobileNavOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}
        aria-label="Main Navigation"
        onClick={handleSidebarClick}
        title={sidebarMode === 'compact' ? "Click or tap anywhere to expand sidebar" : undefined}
      >
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-text"><b>Chrono</b><span>TIME TRACKER</span></div>
          </div>
          <div className="sidebar-controls">
            {/* Mobile close button (visible only in mobile drawer) */}
            <LiquidGlass
              as="button"
              className="round-btn sidebar-ctrl-btn mobile-nav-close"
              onClick={() => setMobileNavOpen(false)}
              title="Close navigation"
              aria-label="Close navigation"
              radius={999}
              bevelDepth={8}
              scale={18}
            >
              <X size={15}/>
            </LiquidGlass>

            {/* Button 1: Sidebar Mode Dropdown (Desktop) */}
            <div
              className="sidebar-mode-control"
              ref={sidebarMenuRef}
              onClick={(e) => e.stopPropagation()}
            >
              <LiquidGlass
                as="button"
                className="round-btn sidebar-ctrl-btn"
                onClick={() => setSidebarMenuOpen(prev => !prev)}
                title="Sidebar layout options"
                radius={999}
                bevelDepth={8}
                scale={18}
              >
                <PanelLeft size={15}/>
              </LiquidGlass>
              {sidebarMenuOpen && (
                <div className="sidebar-mode-menu">
                  <div className="menu-header">Sidebar View</div>
                  <button
                    type="button"
                    className={`sidebar-menu-item ${sidebarMode === 'expanded' ? 'active' : ''}`}
                    onClick={() => { setSidebarMode('expanded'); setSidebarMenuOpen(false); }}
                  >
                    <PanelLeft size={15}/>
                    <div className="item-text">
                      <b>Expanded</b>
                      <span>Full navigation</span>
                    </div>
                    {sidebarMode === 'expanded' && <Check size={14} className="check-icon"/>}
                  </button>
                  <button
                    type="button"
                    className={`sidebar-menu-item ${sidebarMode === 'compact' ? 'active' : ''}`}
                    onClick={() => { setSidebarMode('compact'); setSidebarMenuOpen(false); }}
                  >
                    <Sidebar size={15}/>
                    <div className="item-text">
                      <b>Compact</b>
                      <span>Icon rail only</span>
                    </div>
                    {sidebarMode === 'compact' && <Check size={14} className="check-icon"/>}
                  </button>
                  <button
                    type="button"
                    className={`sidebar-menu-item ${sidebarMode === 'hidden' ? 'active' : ''}`}
                    onClick={() => { setSidebarMode('hidden'); setSidebarMenuOpen(false); }}
                  >
                    <PanelLeftClose size={15}/>
                    <div className="item-text">
                      <b>Hidden</b>
                      <span>Maximum canvas width</span>
                    </div>
                    {sidebarMode === 'hidden' && <Check size={14} className="check-icon"/>}
                  </button>
                </div>
              )}
            </div>

            {/* Button 2: Dedicated Open and close sidebar toggle button (Desktop) */}
            <LiquidGlass
              as="button"
              className="round-btn sidebar-ctrl-btn sidebar-toggle-btn"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                setSidebarMode(prev => prev === 'expanded' ? 'compact' : 'expanded')
              }}
              title={sidebarMode === 'expanded' ? "Close sidebar" : "Open sidebar"}
              radius={999}
              bevelDepth={8}
              scale={18}
            >
              {sidebarMode === 'expanded' ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}
            </LiquidGlass>
          </div>
        </div>
        <div className="nav-label">YOUR SPACE</div>
        <nav>
          {([['clock',Clock3,'Clock'],['analytics',BarChart3,'Insights'],['calendar',CalendarDays,'Calendar'],['history',History,'History'],['settings',Settings,'Settings']] as const).map(([id,Icon,label])=>(
            <LiquidGlass as="button" key={id} className={`nav-item ${page===id?'active':''}`} onClick={()=>{setPage(id);setMobileNavOpen(false);}} title={label} radius={14} bevelDepth={8} scale={20}>
              <Icon size={18}/>
              <span>{label}</span>
              {id==='clock'&&active&&<i className="nav-live"/>}
            </LiquidGlass>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {user ? (
            <LiquidGlass
              as="button"
              className="nav-item signout-btn"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                signOut()
                setMobileNavOpen(false)
              }}
              title="Sign out"
              radius={14}
              bevelDepth={8}
              scale={20}
            >
              <LogOut size={16}/><span>Sign out</span>
            </LiquidGlass>
          ) : isConfigured ? (
            <LiquidGlass
              as="button"
              className="nav-item"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                setLocalModeOverride(false)
                setMobileNavOpen(false)
              }}
              title="Sign in"
              radius={14}
              bevelDepth={8}
              scale={20}
            >
              <LogIn size={16}/><span>Sign in</span>
            </LiquidGlass>
          ) : null}
        </div>
      </aside>

      <main className="main-area">
        <LiquidGlass
          as="header"
          className="topbar"
          radius={999}
          bevelDepth={8}
          scale={18}
        >
          <div className="topbar-left">
            {/* Mobile Nav Trigger Button */}
            <LiquidGlass
              as="button"
              className="round-btn mobile-nav-trigger"
              onClick={() => setMobileNavOpen(true)}
              title="Open navigation menu"
              aria-label="Open navigation menu"
              radius={999}
              bevelDepth={8}
              scale={18}
            >
              <Menu size={16}/>
            </LiquidGlass>

            {sidebarMode === 'hidden' && (
              <LiquidGlass
                as="button"
                className="soft-btn restore-sidebar-btn"
                onClick={() => setSidebarMode('expanded')}
                title="Show sidebar navigation"
                radius={999}
                bevelDepth={8}
                scale={18}
              >
                <PanelLeftOpen size={15}/>
                <span>Sidebar</span>
              </LiquidGlass>
            )}
            <div className="breadcrumb">
              <span className="breadcrumb-root">My space <span>/</span></span> <b>{({clock:'Clock',analytics:'Insights',calendar:'Calendar',history:'History',settings:'Settings'})[page]}</b>
            </div>
          </div>
          <div className="top-actions">
            {user ? (
              <>
                <SyncStatus status={syncStatus} errorMessage={syncError} lastSynced={lastSynced} />
                <CloudIndicator status={syncStatus} />
              </>
            ) : (
              <span className="sync-badge sync-offline" title="Local storage only — Supabase sign-in inactive">
                <CloudOff size={13} />
                <span>Local Mode</span>
              </span>
            )}

            <LiquidGlass
              as="button"
              type="button"
              className={`serene-theme-toggle ${theme}`}
              onClick={()=>setTheme(theme==='light'?'dark':'light')}
              aria-label={`Switch to ${theme==='light'?'dark':'light'} mode`}
              radius={999}
              bevelDepth={8}
              scale={20}
            >
              <div className="toggle-track">
                <span className={`toggle-icon sun ${theme==='light'?'active':''}`}><Sun size={14}/></span>
                <span className={`toggle-icon moon ${theme==='dark'?'active':''}`}><Moon size={14}/></span>
                <div className="toggle-thumb"/>
              </div>
            </LiquidGlass>
          </div>
        </LiquidGlass>

        {page==='clock' && (
          <div className="page-content clock-page" key="clock">
            <div className="clock-viewport-screen">
              <div className="clock-intro">
                <div className="eyebrow">YOUR TIME, CLEARLY</div>
                <div className="clock-date-line">
                  {new Date(now).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
                </div>
              </div>

              <section className="unified-clock-card">
                <div className="mode-switch" role="tablist" aria-label="Clock mode">
                  <LiquidGlass as="button" role="tab" aria-selected={clockMode==='stopwatch'} className={clockMode==='stopwatch'?'selected':''} disabled={!!active} onClick={()=>setClockMode('stopwatch')} radius={999} bevelDepth={8} scale={20}><Clock3 size={16}/> Stopwatch</LiquidGlass>
                  <LiquidGlass as="button" role="tab" aria-selected={clockMode==='timer'} className={clockMode==='timer'?'selected':''} disabled={!!active} onClick={()=>setClockMode('timer')} radius={999} bevelDepth={8} scale={20}><Timer size={16}/> Timer</LiquidGlass>
                </div>
                <div className={`unified-clock-display clock-style-${clockStyle}`} aria-live="off">
                  {active ? (
                    active.mode==='stopwatch' ? fmtHms(elapsed) : fmt(elapsed)
                  ) : completedTimer ? (
                    `-${fmt(Math.max(0, Math.floor((now - completedTimer.finishedAt)/1000)))}`
                  ) : clockMode==='stopwatch' ? (
                    '00:00:00'
                  ) : (
                    fmt(Math.max(0,Number(timerInput||0)*60))
                  )}
                </div>
                <div className={`clock-status ${completedTimer && !active ? 'overdue' : ''}`}>
                  {active ? (
                    active.status==='running' ? 'IN PROGRESS' : 'PAUSED'
                  ) : completedTimer ? (
                    `${Math.max(1, Math.round(completedTimer.duration/60))} MIN TIMER OVER`
                  ) : clockMode==='stopwatch' ? (
                    'READY WHEN YOU ARE'
                  ) : (
                    'SET A DURATION'
                  )}
                </div>
                {(!active && !completedTimer && clockMode==='timer') && (
                  <div className="duration-control">
                    <div className="duration-presets">{[5,15,25,45,60].map(n=><LiquidGlass as="button" key={n} className={Number(timerInput)===n?'chosen':''} onClick={()=>setTimerInput(String(n))} radius={999} bevelDepth={8} scale={18}>{n}m</LiquidGlass>)}</div>
                    <label className="duration-custom">
                      <span>Custom</span>
                      <input aria-label="Timer duration in minutes" type="number" min="1" max="999" value={timerInput} onChange={e=>setTimerInput(e.target.value)}/>
                      <span>min</span>
                    </label>
                  </div>
                )}
                <div className="unified-controls">
                  {!active ? (
                    <>
                      <LiquidGlass as="button" className="primary-btn clock-start" onClick={clockMode==='stopwatch'?startStopwatch:startTimer} disabled={clockMode==='timer'&&(!Number(timerInput)||Number(timerInput)<=0)} radius={999} bevelDepth={12} scale={32}>
                        <Play size={17} fill="currentColor"/> Start {clockMode==='stopwatch'?'stopwatch':'timer'}
                      </LiquidGlass>
                      <LiquidGlass as="button" className="round-btn" onClick={enterImmersive} title="Immersive full-screen mode" radius={999} bevelDepth={10} scale={22}>
                        <Maximize2 size={16}/>
                      </LiquidGlass>
                    </>
                  ) : (
                    <>
                      <LiquidGlass as="button" className="primary-btn clock-start" onClick={active.status==='running'?pause:resume} radius={999} bevelDepth={12} scale={32}>
                        {active.status==='running'?<Pause size={17}/>:<Play size={17}/>} {active.status==='running'?'Pause':'Resume'}
                      </LiquidGlass>
                      <LiquidGlass as="button" className="soft-btn" onClick={stop} radius={999} bevelDepth={10} scale={22}>
                        <Check size={16}/> Finish
                      </LiquidGlass>
                      <LiquidGlass as="button" className="round-btn" onClick={reset} title="Discard session" radius={999} bevelDepth={10} scale={22}>
                        <RotateCcw size={16}/>
                      </LiquidGlass>
                      <LiquidGlass as="button" className="round-btn" onClick={enterImmersive} title="Immersive full-screen mode" radius={999} bevelDepth={10} scale={22}>
                        <Maximize2 size={16}/>
                      </LiquidGlass>
                    </>
                  )}
                </div>

                {/* Embedded Optional Activity & Mini Clock Row inside the main card */}
                <div className="clock-embedded-tagging">
                  <div className="embedded-tag-fields">
                    <label className="embedded-tag-label">
                      <span>Category (optional)</span>
                      <CustomSelect value={selectedCategory} onChange={v=>{setSelectedCategory(v);setSelectedSub('')}} placeholder="No category" options={categories.map(c=>({value:c.id,label:c.name}))} onAdd={name=>{const id=handleAddCategory(name);if(id){setSelectedCategory(id);setSelectedSub('')}}} addLabel="Add new category"/>
                    </label>
                    <label className="embedded-tag-label">
                      <span>Subcategory</span>
                      <CustomSelect value={selectedSub} onChange={setSelectedSub} placeholder="Optional" disabled={!currentCategory} options={(currentCategory?.subs||[]).map(s=>({value:s,label:s}))} onAdd={currentCategory?name=>handleAddSubcategory(currentCategory.id,name):undefined} addLabel="Add new subcategory"/>
                    </label>
                  </div>
                  <LiquidGlass as="button" className="pip-btn embedded-pip-btn" onClick={openPip} radius={999} bevelDepth={8} scale={18} title="Floating mini-clock">
                    <MoreHorizontal size={15}/> <span>Mini clock</span>
                  </LiquidGlass>
                </div>

                {completedTimer && !active && (
                  <div className="timer-complete-banner">
                    <div className="timer-complete-info">
                      <Sparkles size={18} className="complete-sparkle"/>
                      <div>
                        <b>{Math.max(1, Math.round(completedTimer.duration / 60))} min timer completed!</b>
                        <span>Session saved ({fmt(Math.max(0, Math.floor((now - completedTimer.finishedAt)/1000)))} overtime)</span>
                      </div>
                    </div>
                    <LiquidGlass as="button" className="soft-btn" onClick={()=>setCompletedTimer(null)} radius={999} bevelDepth={6} scale={14}>
                      Dismiss
                    </LiquidGlass>
                  </div>
                )}
                <div className="clock-footnote">{active ? 'Your time is being recorded.' : 'One clock. Two ways to track your time.'}</div>
              </section>
            </div>

            {/* Below-the-screen dashboard content */}
            <div className="clock-below-screen">
              <section className="summary-grid">
                <div className="summary-card today-summary">
                  <div className="summary-top"><span>YOUR DAY SO FAR</span><span className="summary-emoji">◷</span></div>
                  <div className="summary-value">{durationLabel(totalToday)}</div>
                  <div className="goal-line"><span>{Math.round(progress)}% of your {goal}h daily goal</span><span>{durationLabel(Math.max(0,dailyGoalSeconds-totalToday))} to go</span></div>
                  <div className="progress-track"><div style={{width:`${progress}%`}}/></div>
                </div>
                <div className="summary-card">
                  <div className="summary-top"><span>THIS WEEK</span><span className="summary-emoji">◷</span></div>
                  <div className="summary-value">{durationLabel(weekTotal)}</div>
                  <div className="summary-foot"><ArrowUpRight size={15}/> Your time, adding up</div>
                </div>
                <div className="summary-card">
                  <div className="summary-top"><span>ALL-TIME TRACKED</span><span className="summary-emoji">◷</span></div>
                  <div className="summary-value">{durationLabel(allTime)}</div>
                  <div className="summary-foot">{sessions.length} little sessions saved</div>
                </div>
              </section>

              <section className="lower-grid">
                <div className="panel activity-panel">
                  <div className="panel-heading">
                    <div><h3>Today's rhythm</h3><p>When your time happened</p></div>
                    <LiquidGlass as="button" className="text-link" onClick={()=>setPage('analytics')} radius={8} bevelDepth={4} scale={12}>See insights <ChevronRight size={15}/></LiquidGlass>
                  </div>
                  <HourlyChart sessions={sessions} now={now}/>
                </div>
                <div className="panel recent-panel">
                  <div className="panel-heading">
                    <div><h3>Recent sessions</h3><p>Your latest little wins</p></div>
                    <LiquidGlass as="button" className="text-link" onClick={()=>setPage('history')} radius={8} bevelDepth={4} scale={12}>View all <ChevronRight size={15}/></LiquidGlass>
                  </div>
                  {todaySessions.length===0?<Empty text="No sessions yet. Start whenever you are ready."/>:todaySessions.slice(0,4).map(s=><SessionRow key={s.id} session={s} categories={categories}/>)}
                </div>
              </section>
            </div>
          </div>
        )}

        {page==='analytics' && (
          <div className="page-content" key="analytics">
            <PageTitle eyebrow="THE BIG PICTURE" title="Your time, at a glance." subtitle="Little patterns can tell you a lot."/>
            <div className="stats-row">
              <Stat label="Today" value={durationLabel(totalToday)} note="Tracked so far"/>
              <Stat label="This week" value={durationLabel(weekTotal)} note="Since Monday"/>
              <Stat label="All time" value={durationLabel(allTime)} note={`${sessions.length} sessions`}/>
            </div>
            <div className="panel chart-panel">
              <div className="panel-heading"><div><h3>When do you spend your time?</h3><p>Hours of the day · all recorded sessions</p></div></div>
              <HourlyChart sessions={sessions} now={now} large/>
            </div>
            <div className="panel category-panel">
              <div className="panel-heading"><div><h3>Today's categories</h3><p>How your day is divided</p></div></div>
              {categoryTotals.length?categoryTotals.map(c=>(
                <div className="category-bar-row" key={c.id}>
                  <div className="category-name"><i style={{background:c.color}}/>{c.name}<b>{durationLabel(c.total)}</b></div>
                  <div className="progress-track"><div style={{width:`${totalToday?c.total/totalToday*100:0}%`,background:c.color}}/></div>
                </div>
              )):<Empty text="Your category breakdown will show up here."/>}
            </div>
          </div>
        )}

        {page==='calendar' && (
          <div className="page-content" key="calendar">
            <PageTitle eyebrow="YOUR LITTLE HISTORY" title="Every day adds up." subtitle="A gentle look back at the time you've made."/>
            <div className="panel calendar-panel">
              <div className="calendar-head">
                <LiquidGlass as="button" className="round-btn" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} radius={999} bevelDepth={8} scale={20}><ChevronLeft size={17}/></LiquidGlass>
                <h3>{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h3>
                <LiquidGlass as="button" className="round-btn" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} radius={999} bevelDepth={8} scale={20}><ChevronRight size={17}/></LiquidGlass>
              </div>
              <CalendarGrid month={month} sessions={sessions}/>
              <div className="calendar-legend">
                <span>Less</span>
                {['var(--heat-1)','var(--heat-2)','var(--heat-3)','var(--heat-4)','var(--heat-5)'].map(c=><i key={c} style={{background:c}}/>)}
                <span>More</span>
              </div>
            </div>
            <div className="panel">
              <div className="panel-heading"><div><h3>Monthly little wins</h3><p>Time tracked this month</p></div></div>
              <div className="summary-value">
                {durationLabel(sessions.filter(s=>{const d=new Date(s.start);return d.getMonth()===month.getMonth()&&d.getFullYear()===month.getFullYear()}).reduce((a,s)=>a+s.duration,0))}
              </div>
            </div>
          </div>
        )}

        {page==='history' && (
          <div className="page-content" key="history">
            <PageTitle eyebrow="ALL YOUR SESSIONS" title="The time you made." subtitle="Every focused moment, all in one place."/>
            <div className="history-toolbar">
              <CustomSelect value={filter} onChange={setFilter} options={[{value:"all",label:"All categories"},...categories.map(c=>({value:c.id,label:c.name}))]}/>
              <LiquidGlass as="button" className="soft-btn" onClick={()=>setManualOpen(true)} radius={999} bevelDepth={8} scale={22}><Plus size={16}/> Add past time</LiquidGlass>
              <LiquidGlass as="button" className="soft-btn" onClick={exportCSV} radius={999} bevelDepth={8} scale={22}><Download size={16}/> Export CSV</LiquidGlass>
              <LiquidGlass as="button" className="soft-btn" onClick={exportJSON} radius={999} bevelDepth={8} scale={22}><Download size={16}/> Export JSON</LiquidGlass>
            </div>
            <div className="panel history-list">
              {sessions.filter(s=>filter==='all'||s.category===filter).sort((a,b)=>b.start-a.start).length===0 ? (
                <Empty text="No sessions yet. Your story starts with one."/>
              ) : (
                sessions.filter(s=>filter==='all'||s.category===filter).sort((a,b)=>b.start-a.start).map(s=>(
                  <SessionRow
                    key={s.id}
                    session={s}
                    categories={categories}
                    editable
                    onDelete={()=>{
                      setSessions(prev=>prev.filter(x=>x.id!==s.id));
                      if(s.cloudId && user) pushSessionDelete(s.cloudId);
                    }}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {page==='settings' && (
          <div className="page-content" key="settings">
            <PageTitle eyebrow="MAKE IT YOURS" title="Preferences" subtitle="Set up the clock the way you like it."/>
            <div className="panel settings-panel">
              <div className="setting-row">
                <div><h3>Appearance theme</h3><p>Choose the light or dark ambient theme.</p></div>
                <div className="segmented">
                  <LiquidGlass as="button" className={theme==='light'?'selected':''} onClick={()=>setTheme('light')} radius={999} bevelDepth={8} scale={18}><Sun size={15}/> Light</LiquidGlass>
                  <LiquidGlass as="button" className={theme==='dark'?'selected':''} onClick={()=>setTheme('dark')} radius={999} bevelDepth={8} scale={18}><Moon size={15}/> Dark</LiquidGlass>
                </div>
              </div>

              <div className="setting-row">
                <div><h3>Sidebar navigation</h3><p>Choose how the sidebar appears across your workspace.</p></div>
                <div className="segmented">
                  <LiquidGlass as="button" className={sidebarMode==='expanded'?'selected':''} onClick={()=>setSidebarMode('expanded')} radius={999} bevelDepth={8} scale={18}><PanelLeft size={15}/> Expanded</LiquidGlass>
                  <LiquidGlass as="button" className={sidebarMode==='compact'?'selected':''} onClick={()=>setSidebarMode('compact')} radius={999} bevelDepth={8} scale={18}><Sidebar size={15}/> Compact</LiquidGlass>
                  <LiquidGlass as="button" className={sidebarMode==='hidden'?'selected':''} onClick={()=>setSidebarMode('hidden')} radius={999} bevelDepth={8} scale={18}><PanelLeftClose size={15}/> Hidden</LiquidGlass>
                </div>
              </div>

              <div className="setting-row" style={{flexDirection:'column',alignItems:'stretch',gap:'14px'}}>
                <div>
                  <h3>Application typography</h3>
                  <p>Curated typeface for the workspace interface. Updates live across all pages.</p>
                </div>
                <div className="typography-grid">
                  {APP_FONTS.map(f => (
                    <div
                      key={f.id}
                      className={`typography-card ${appFont === f.id ? 'selected' : ''}`}
                      onClick={() => setAppFont(f.id)}
                      style={{ fontFamily: f.family }}
                    >
                      <div className="typography-card-header">
                        <b>{f.name}</b>
                        <span className="font-badge">{f.tag}</span>
                      </div>
                      <div className="typography-card-sample" style={{ fontFamily: f.family }}>
                        {f.sample}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="setting-row" style={{flexDirection:'column',alignItems:'stretch',gap:'14px'}}>
                <div>
                  <h3>Clock digit font</h3>
                  <p>Independent typeface for the primary timer and stopwatch numerals.</p>
                </div>
                <div className="typography-grid">
                  {CLOCK_FONTS.map(f => (
                    <div
                      key={f.id}
                      className={`typography-card ${clockFont === f.id ? 'selected' : ''}`}
                      onClick={() => setClockFont(f.id)}
                    >
                      <div className="typography-card-header">
                        <b>{f.name}</b>
                        <span className="font-badge">{f.tag}</span>
                      </div>
                      <div className="clock-preview-sample" style={{ fontFamily: f.family }}>
                        25:00
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="setting-row" style={{flexDirection:'column',alignItems:'stretch',gap:'14px'}}>
                <div>
                  <h3>Clock display style</h3>
                  <p>Refines the weight, tracking, and optical feel of the clock numerals.</p>
                </div>
                <div className="typography-grid">
                  {CLOCK_STYLES.map(s => (
                    <div
                      key={s.id}
                      className={`typography-card ${clockStyle === s.id ? 'selected' : ''}`}
                      onClick={() => setClockStyle(s.id)}
                    >
                      <div className="typography-card-header">
                        <b>{s.name}</b>
                      </div>
                      <div className={`style-preview-sample clock-style-${s.id}`}>
                        00:25:00
                      </div>
                      <div className="typography-card-sample">
                        {s.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <div><h3>Daily goal</h3><p>A gentle target, not a rule.</p></div>
                <div className="goal-input">
                  <input type="number" min="1" max="24" value={goal} onChange={e=>setGoal(e.target.value)}/>
                  <span>hours / day</span>
                </div>
              </div>

              <div className="setting-row category-settings">
                <div><h3>Your categories</h3><p>Add or remove the labels you use.</p></div>
                <div className="category-manager">
                  {categories.map(c=>(
                    <div className="manage-cat" key={c.id}>
                      <i style={{background:c.color}}/>
                      <b>{c.name}</b>
                      <span>{c.subs.length} subcategories</span>
                      <LiquidGlass as="button" className="round-btn tiny" onClick={()=>{setCategories(prev=>prev.filter(x=>x.id!==c.id)); if(c.cloudId && user) pushCategoryDelete(c.cloudId)}} radius={10} bevelDepth={6} scale={14}>
                        <Trash2 size={14}/>
                      </LiquidGlass>
                    </div>
                  ))}
                  <div className="add-category">
                    <input placeholder="New category name" value={newCategory} onChange={e=>setNewCategory(e.target.value)}/>
                    <LiquidGlass as="button" className="soft-btn" onClick={()=>{if(newCategory.trim()){handleAddCategory(newCategory.trim());setNewCategory('');setNewSub('')}}} radius={999} bevelDepth={8} scale={20}><Plus size={15}/> Add</LiquidGlass>
                  </div>
                  <input className="sub-add" placeholder="Optional first subcategory" value={newSub} onChange={e=>setNewSub(e.target.value)}/>
                </div>
              </div>

              <div className="setting-row">
                <div>
                  <h3>Cloud synchronization</h3>
                  <p>{user ? `Signed in as ${user.email}. Synchronized with Supabase.` : isConfigured ? 'Not signed in. Running in local mode.' : 'Supabase credentials not configured in .env.local.'}</p>
                </div>
                <div className="export-actions">
                  {user ? (
                    <>
                      <LiquidGlass as="button" className="soft-btn" onClick={()=>setShowMigration(true)} radius={999} bevelDepth={8} scale={22}>
                        <Upload size={16}/> Import browser data
                      </LiquidGlass>
                      <LiquidGlass as="button" className="soft-btn" onClick={signOut} radius={999} bevelDepth={8} scale={22}>
                        <LogOut size={16}/> Sign out
                      </LiquidGlass>
                    </>
                  ) : isConfigured ? (
                    <LiquidGlass as="button" className="primary-btn" onClick={()=>setLocalModeOverride(false)} radius={999} bevelDepth={8} scale={22}>
                      <LogIn size={16}/> Sign in to cloud
                    </LiquidGlass>
                  ) : null}
                </div>
              </div>

              <div className="setting-row">
                <div><h3>Your data</h3><p>Download a complete copy of your session history.</p></div>
                <div className="export-actions">
                  <LiquidGlass as="button" className="soft-btn" onClick={exportCSV} radius={999} bevelDepth={8} scale={22}><Download size={16}/> Export CSV</LiquidGlass>
                  <LiquidGlass as="button" className="soft-btn" onClick={exportJSON} radius={999} bevelDepth={8} scale={22}><Download size={16}/> Export JSON</LiquidGlass>
                </div>
              </div>
            </div>

            <div className="privacy-note">
              <Sparkles size={17}/>
              <span>{user ? 'Your records are stored securely in Supabase PostgreSQL with strict Row Level Security. Only you can view or modify them.' : 'You are currently using Chrono in local mode. All records remain safe in your browser.'}</span>
            </div>
          </div>
        )}
      </main>

      {/* Category assign modal (with optional notes) */}
      {assignOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <LiquidGlass as="button" className="modal-close" onClick={closeAssignModal} radius={999} bevelDepth={8} scale={18}><X size={18}/></LiquidGlass>
            <div className="modal-icon"><Clock3 size={20}/></div>
            <h2>Session completed</h2>
            <p>Your session is safely saved! You can assign a category and notes below, or keep it uncategorized.</p>
            <label>Category<CustomSelect value={selectedCategory} onChange={v=>{setSelectedCategory(v);setSelectedSub('')}} placeholder="No category" options={categories.map(c=>({value:c.id,label:c.name}))} onAdd={name=>{const id=handleAddCategory(name);if(id){setSelectedCategory(id);setSelectedSub('')}}} addLabel="Add new category"/></label>
            <label>Subcategory<CustomSelect value={selectedSub} onChange={setSelectedSub} placeholder="Optional" disabled={!currentCategory} options={(currentCategory?.subs||[]).map(s=>({value:s,label:s}))} onAdd={currentCategory?name=>handleAddSubcategory(currentCategory.id,name):undefined} addLabel="Add new subcategory"/></label>
            <label style={{display:'flex',flexDirection:'column',gap:'6px',fontSize:'11px',fontWeight:600,textTransform:'uppercase',color:'var(--text-muted)'}}>
              Notes (optional)
              <input type="text" placeholder="What did you accomplish?" value={pendingNotes} onChange={e=>setPendingNotes(e.target.value)} style={{height:'38px',padding:'0 12px',borderRadius:'var(--radius-md)',border:'1px solid var(--btn-glass-border)',background:'var(--surface-interactive)',color:'var(--text-primary)'}}/>
            </label>
            <div className="modal-actions" style={{display:'flex',gap:'10px',marginTop:'18px'}}>
              <LiquidGlass as="button" className="soft-btn" onClick={closeAssignModal} radius={999} bevelDepth={8} scale={18}>Keep uncategorized</LiquidGlass>
              <LiquidGlass as="button" className="primary-btn" onClick={savePending} radius={999} bevelDepth={12} scale={32}>Save details <Check size={16}/></LiquidGlass>
            </div>
          </div>
        </div>
      )}

      {/* Manual session modal (with optional notes) */}
      {manualOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <LiquidGlass as="button" className="modal-close" onClick={()=>setManualOpen(false)} radius={999} bevelDepth={8} scale={18}><X size={18}/></LiquidGlass>
            <div className="modal-icon"><Clock3 size={20}/></div>
            <h2>Add time from the past</h2>
            <p>Forgot to start the clock? No worries.</p>
            <label>Date<input type="date" value={manualDate} onChange={e=>setManualDate(e.target.value)}/></label>
            <div className="form-two">
              <label>From<input type="time" value={manualStart} onChange={e=>setManualStart(e.target.value)}/></label>
              <label>To<input type="time" value={manualEnd} onChange={e=>setManualEnd(e.target.value)}/></label>
            </div>
            <label>Category<CustomSelect value={manualCat} onChange={v=>{setManualCat(v);setManualSub('')}} placeholder="No category" options={categories.map(c=>({value:c.id,label:c.name}))} onAdd={name=>{const id=handleAddCategory(name);if(id){setManualCat(id);setManualSub('')}}} addLabel="Add new category"/></label>
            <label>Subcategory<CustomSelect value={manualSub} onChange={setManualSub} placeholder="Optional" disabled={!categories.find(c=>c.id===manualCat)} options={(categories.find(c=>c.id===manualCat)?.subs||[]).map(s=>({value:s,label:s}))} onAdd={manualCat?name=>handleAddSubcategory(manualCat,name):undefined} addLabel="Add new subcategory"/></label>
            <label style={{display:'flex',flexDirection:'column',gap:'6px',fontSize:'11px',fontWeight:600,textTransform:'uppercase',color:'var(--text-muted)'}}>
              Notes (optional)
              <input type="text" placeholder="Session details..." value={manualNotes} onChange={e=>setManualNotes(e.target.value)} style={{height:'38px',padding:'0 12px',borderRadius:'var(--radius-md)',border:'1px solid var(--btn-glass-border)',background:'var(--surface-interactive)',color:'var(--text-primary)'}}/>
            </label>
            <LiquidGlass as="button" className="primary-btn full" onClick={addManual} radius={999} bevelDepth={12} scale={32}>Add to history <Check size={16}/></LiquidGlass>
          </div>
        </div>
      )}

      {/* Migration modal */}
      {showMigration && !migrationDismissed && readLocalData() && (
        <MigrationModal
          localData={readLocalData()!}
          onDone={() => { setShowMigration(false); setMigrationDismissed(true) }}
          onSkip={() => { setShowMigration(false); setMigrationDismissed(true) }}
        />
      )}

      {/* Immersive Fullscreen Overlay */}
      {isImmersive && (
        <div className="immersive-overlay" role="dialog" aria-modal="true" aria-label="Immersive clock">
          <header className="immersive-topbar">
            <div className="immersive-badges">
              <span className="immersive-badge">
                {active ? (
                  active.mode === 'stopwatch' ? <Clock3 size={14}/> : <Timer size={14}/>
                ) : (
                  clockMode === 'stopwatch' ? <Clock3 size={14}/> : <Timer size={14}/>
                )}
                <span>
                  {active ? active.mode.toUpperCase() : clockMode.toUpperCase()}
                </span>
              </span>

              {(() => {
                const catId = active?.category || selectedCategory
                const cat = categories.find(c => c.id === catId)
                const sub = active?.subcategory || selectedSub
                if (!cat) return null
                return (
                  <span className="immersive-badge">
                    <i style={{ background: cat.color }}/>
                    <span>{cat.name}{sub ? ` · ${sub}` : ''}</span>
                  </span>
                )
              })()}
            </div>

            <div className="immersive-top-actions">
              <LiquidGlass
                as="button"
                className="round-btn"
                onClick={exitImmersive}
                title="Exit full-screen (Esc)"
                radius={999}
                bevelDepth={8}
                scale={18}
              >
                <Minimize2 size={16}/>
              </LiquidGlass>
            </div>
          </header>

          <main className="immersive-center">
            <div className="immersive-ring-container">
              {((active?.mode === 'timer') || (!active && clockMode === 'timer')) && (
                <svg className="immersive-progress-svg" viewBox="0 0 460 460" aria-hidden="true">
                  <circle className="immersive-ring-track" cx="230" cy="230" r="210" />
                  <circle
                    className="immersive-ring-progress"
                    cx="230"
                    cy="230"
                    r="210"
                    strokeDasharray={1319.47}
                    strokeDashoffset={
                      1319.47 * (1 - (
                        active?.duration
                          ? Math.min(1, Math.max(0, elapsed / active.duration))
                          : 1
                      ))
                    }
                  />
                </svg>
              )}

              <div className="immersive-clock-content">
                <div className={`immersive-status ${completedTimer && !active ? 'overdue' : ''}`}>
                  {active ? (
                    active.status === 'running' ? 'IN PROGRESS' : 'PAUSED'
                  ) : completedTimer ? (
                    `${Math.max(1, Math.round(completedTimer.duration / 60))} MIN TIMER OVER`
                  ) : clockMode === 'stopwatch' ? (
                    'READY WHEN YOU ARE'
                  ) : (
                    'READY TO FOCUS'
                  )}
                </div>

                <div className={`immersive-digits clock-style-${clockStyle}`}>
                  {active ? (
                    active.mode === 'stopwatch' ? fmtHms(elapsed) : fmt(elapsed)
                  ) : completedTimer ? (
                    `-${fmt(Math.max(0, Math.floor((now - completedTimer.finishedAt) / 1000)))}`
                  ) : clockMode === 'stopwatch' ? (
                    '00:00:00'
                  ) : (
                    fmt(Math.max(0, Number(timerInput || 0) * 60))
                  )}
                </div>
              </div>
            </div>

            <div className="immersive-controls">
              {!active ? (
                <LiquidGlass
                  as="button"
                  className="primary-btn clock-start"
                  onClick={clockMode === 'stopwatch' ? startStopwatch : startTimer}
                  disabled={clockMode === 'timer' && (!Number(timerInput) || Number(timerInput) <= 0)}
                  radius={999}
                  bevelDepth={12}
                  scale={32}
                >
                  <Play size={17} fill="currentColor"/> Start {clockMode === 'stopwatch' ? 'stopwatch' : 'timer'}
                </LiquidGlass>
              ) : (
                <>
                  <LiquidGlass
                    as="button"
                    className="primary-btn clock-start"
                    onClick={active.status === 'running' ? pause : resume}
                    radius={999}
                    bevelDepth={12}
                    scale={32}
                  >
                    {active.status === 'running' ? <Pause size={17}/> : <Play size={17}/>}
                    {active.status === 'running' ? 'Pause' : 'Resume'}
                  </LiquidGlass>
                  <LiquidGlass
                    as="button"
                    className="soft-btn"
                    onClick={stop}
                    radius={999}
                    bevelDepth={10}
                    scale={22}
                  >
                    <Check size={16}/> Finish
                  </LiquidGlass>
                  <LiquidGlass
                    as="button"
                    className="round-btn"
                    onClick={reset}
                    title="Discard session"
                    radius={999}
                    bevelDepth={10}
                    scale={22}
                  >
                    <RotateCcw size={16}/>
                  </LiquidGlass>
                </>
              )}
            </div>
          </main>

          <footer className="immersive-hints">
            <span><kbd>Space</kbd> {!active ? 'Start' : active.status === 'running' ? 'Pause' : 'Resume'}</span>
            <span><kbd>Esc</kbd> Exit full-screen</span>
            {(!active || active.status === 'paused') && <span><kbd>R</kbd> Reset</span>}
          </footer>
        </div>
      )}
    </div>
  )
}

// ── Sub-components (CustomSelect, PageTitle, Stat, Empty, SessionRow, HourlyChart, CalendarGrid) ──

type SelectOption = { value: string; label: string }
function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  disabled = false,
  onAdd,
  addLabel = "Add new category"
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onAdd?: (name: string) => void;
  addLabel?: string;
}) {
  const [open, setOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const root = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) { setIsCreating(false); setNewName(''); return }
    const close = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (isCreating) { setIsCreating(false); setNewName('') } else setOpen(false) } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key) }
  }, [open, isCreating])

  useEffect(() => { if (isCreating) inputRef.current?.focus() }, [isCreating])

  const handleCreate = () => {
    const trimmed = newName.trim()
    if (!trimmed || !onAdd) return
    onAdd(trimmed); setNewName(''); setIsCreating(false); setOpen(false)
  }

  const selected = options.find(option => option.value === value)

  return (
    <div className={`custom-select ${open ? 'is-open' : ''}`} ref={root}>
      <LiquidGlass as="button" type="button" className="custom-select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)} radius={14} bevelDepth={8} scale={24}>
        <span>{selected?.label || placeholder}</span>
        <ChevronDown size={15} />
      </LiquidGlass>
      {open && !disabled && (
        <LiquidGlass className="custom-select-menu" role="listbox" radius={18} bevelDepth={12} scale={36} aberration={3} frost={0.3}>
          {options.map(option => (
            <LiquidGlass as="button" type="button" role="option" aria-selected={option.value === value} className={`custom-select-option ${option.value === value ? 'selected' : ''}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false) }} radius={10} bevelDepth={6} scale={16}>
              {option.label}
              {option.value === value && <Check size={14} />}
            </LiquidGlass>
          ))}
          {options.length === 0 && <div className="custom-select-empty">No options yet</div>}
          {onAdd && (
            <>
              <div className="custom-select-divider" />
              {isCreating ? (
                <div className="custom-select-create-row" onClick={e => e.stopPropagation()}>
                  <input ref={inputRef} type="text" className="custom-select-create-input" placeholder="Enter name..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}/>
                  <LiquidGlass as="button" type="button" className="custom-select-create-submit" onClick={handleCreate} title="Confirm" radius={8} bevelDepth={5} scale={14}><Check size={13} /></LiquidGlass>
                  <LiquidGlass as="button" type="button" className="custom-select-create-cancel" onClick={() => { setIsCreating(false); setNewName('') }} title="Cancel" radius={8} bevelDepth={5} scale={14}><X size={13} /></LiquidGlass>
                </div>
              ) : (
                <LiquidGlass as="button" type="button" className="custom-select-add-btn" onClick={e => { e.stopPropagation(); setIsCreating(true) }} radius={10} bevelDepth={6} scale={18}>
                  <Plus size={14} /><span>{addLabel}</span>
                </LiquidGlass>
              )}
            </>
          )}
        </LiquidGlass>
      )}
    </div>
  )
}

const PageTitle = memo(function PageTitle({eyebrow,title,subtitle}:{eyebrow:string;title:string;subtitle:string}){return <div className="page-title"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>})
const Stat = memo(function Stat({label,value,note}:{label:string;value:string;note:string}){return <div className="summary-card"><div className="summary-top"><span>{label.toUpperCase()}</span><span className="summary-emoji">✿</span></div><div className="summary-value">{value}</div><div className="summary-foot">{note}</div></div>})
const Empty = memo(function Empty({text}:{text:string}){return <div className="empty-state"><span>☁</span><p>{text}</p></div>})

const SessionRow = memo(function SessionRow({session,categories,editable=false,onDelete}:{session:Session;categories:Category[];editable?:boolean;onDelete?:()=>void}){
  const cat=categories.find(c=>c.id===session.category)
  return (
    <div className="session-row">
      <div className="session-dot" style={{background:cat?.color||'var(--accent-primary)'}}/>
      <div className="session-info">
        <b>{cat?.name||'Uncategorized'}{session.subcategory?` · ${session.subcategory}`:''}</b>
        <span>{prettyDate(session.start)} · {timeLabel(session.start)} – {timeLabel(session.end)}</span>
        {session.notes && <span className="session-notes">“{session.notes}”</span>}
      </div>
      <div className="session-duration">{durationLabel(session.duration)}</div>
      {editable&&<LiquidGlass as="button" className="round-btn tiny" onClick={onDelete} title="Delete session" radius={10} bevelDepth={6} scale={14}><Trash2 size={14}/></LiquidGlass>}
    </div>
  )
})

const HourlyChart = memo(function HourlyChart({sessions,now,large=false}:{sessions:Session[];now:number;large?:boolean}){
  const bars = useMemo(() => {
    const bins = new Array(16).fill(0);
    const target = new Date(now);
    const ty = target.getFullYear();
    const tm = target.getMonth();
    const td = target.getDate();

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const d = new Date(s.start);
      const match = large || (
        d.getFullYear() === ty &&
        d.getMonth() === tm &&
        d.getDate() === td
      );
      if (match) {
        const h = d.getHours();
        if (h >= 6 && h <= 21) {
          bins[h - 6] += s.duration;
        }
      }
    }
    return bins.map((total, i) => ({ hour: i + 6, total }));
  }, [sessions, now, large]);

  const max = Math.max(1, ...bars.map(b => b.total));
  return (
    <div className={`hour-chart ${large ? 'large' : ''}`}>
      <div className="bars">
        {bars.map(b => {
          const hourLabel = b.hour % 12 || 12;
          const ampm = b.hour < 12 ? 'AM' : 'PM';
          const shortAmpm = b.hour < 12 ? 'a' : 'p';
          const label = b.hour % 3 === 0 ? (large ? `${hourLabel} ${ampm}` : `${hourLabel}${shortAmpm}`) : '\u00A0';
          return (
            <div className="bar-column" key={b.hour}>
              <div className="bar-wrap">
                <div
                  className="bar"
                  style={{height:`${b.total ? Math.max(5, b.total / max * 100) : 2}%`, opacity: b.total ? 1 : .22}}
                  title={`${hourLabel}:00 ${ampm} · ${durationLabel(b.total)}`}
                />
              </div>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
      <div className="chart-caption">
        <span><i/> Tracked time</span>
        <span>6 AM — 9 PM</span>
      </div>
    </div>
  );
})

const CalendarGrid = memo(function CalendarGrid({month,sessions}:{month:Date;sessions:Session[]}){
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const totals = useMemo(() => {
    const map = new Map<number, number>();
    const y = month.getFullYear();
    const m = month.getMonth();
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const d = new Date(s.start);
      if (d.getFullYear() === y && d.getMonth() === m) {
        const day = d.getDate();
        map.set(day, (map.get(day) || 0) + s.duration);
      }
    }
    return Array.from({ length: days }, (_, i) => map.get(i + 1) || 0);
  }, [month, sessions, days]);

  const max = Math.max(1, ...totals);
  return (
    <div className="calendar-grid">
      <div className="weekdays">{['M','T','W','T','F','S','S'].map((d,i)=><span key={i}>{d}</span>)}</div>
      <div className="days">
        {Array.from({length:offset},(_,i)=><span className="day blank" key={`b${i}`}/>)}
        {totals.map((t,i)=><span key={i} className={`day ${t?'has-time':''}`} style={{background:t?`rgba(var(--accent-rgb),${0.18+0.72*t/max})`:undefined, color:t&&t/max>0.45?'#ffffff':undefined}} title={`${i+1}: ${durationLabel(t)}`}>{i+1}</span>)}
      </div>
    </div>
  );
})
