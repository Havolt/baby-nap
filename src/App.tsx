import { useEffect, useState, type FormEvent } from 'react'
import './App.css'

type SleepType = 'nap' | 'overnight'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type SleepSession = {
  id: string
  startedAt: string
  endedAt: string
  type: SleepType
}

type PlannerData = {
  babyName: string
  ageMonths: number
  lastWakeAt: string
  sleeps: SleepSession[]
}

type WakeWindow = {
  min: number
  max: number
  target: number
}

type StoragePersistence =
  | 'checking'
  | 'granted'
  | 'not-granted'
  | 'unsupported'
  | 'error'

const STORAGE_KEY = 'little-dreams-planner-v1'
const THEME_STORAGE_KEY = 'little-dreams-theme-v1'
const SLEEP_PRESSURE_MAX = 1
const BASELINE_SLEEP_PRESSURE = 0.15
const SLEEP_PRESSURE_TARGET =
  SLEEP_PRESSURE_MAX -
  (SLEEP_PRESSURE_MAX - BASELINE_SLEEP_PRESSURE) * Math.exp(-Math.LN2)

function loadNightMode(): { enabled: boolean; error: string } {
  try {
    return {
      enabled: localStorage.getItem(THEME_STORAGE_KEY) === 'true',
      error: '',
    }
  } catch (error) {
    return {
      enabled: false,
      error:
        error instanceof Error
          ? `We couldn't read your saved display preference: ${error.message}`
          : 'We couldn’t read your saved display preference.',
    }
  }
}

function currentLocalInputValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

function defaultData(): PlannerData {
  return {
    babyName: '',
    ageMonths: 6,
    lastWakeAt: new Date().toISOString(),
    sleeps: [],
  }
}

function loadData(): { data: PlannerData; error: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { data: defaultData(), error: '' }
    const parsed: unknown = JSON.parse(saved)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('babyName' in parsed) ||
      typeof parsed.babyName !== 'string' ||
      !('ageMonths' in parsed) ||
      typeof parsed.ageMonths !== 'number' ||
      !('lastWakeAt' in parsed) ||
      typeof parsed.lastWakeAt !== 'string' ||
      !('sleeps' in parsed) ||
      !Array.isArray(parsed.sleeps)
    ) {
      throw new Error('Saved planner data is not in a supported format.')
    }
    if (Number.isNaN(Date.parse(parsed.lastWakeAt))) {
      throw new Error('Saved wake-up time is invalid.')
    }
    const savedSleeps = parsed.sleeps.filter(
      (
        sleep,
      ): sleep is Omit<SleepSession, 'type'> & { type?: SleepType } =>
        typeof sleep === 'object' &&
        sleep !== null &&
        'id' in sleep &&
        typeof sleep.id === 'string' &&
        'startedAt' in sleep &&
        typeof sleep.startedAt === 'string' &&
        'endedAt' in sleep &&
        typeof sleep.endedAt === 'string' &&
        (!('type' in sleep) ||
          sleep.type === 'nap' ||
          sleep.type === 'overnight'),
    )
    if (
      savedSleeps.length !== parsed.sleeps.length ||
      savedSleeps.some(
        (sleep) =>
          Number.isNaN(Date.parse(sleep.startedAt)) ||
          Number.isNaN(Date.parse(sleep.endedAt)) ||
          Date.parse(sleep.endedAt) <= Date.parse(sleep.startedAt),
      )
    ) {
      throw new Error('Saved sleep history contains an invalid sleep session.')
    }
    const sleeps: SleepSession[] = savedSleeps.map((sleep) => ({
      ...sleep,
      type: sleep.type ?? 'nap',
    }))
    return {
      data: {
        babyName: parsed.babyName,
        ageMonths: Math.min(24, Math.max(0, parsed.ageMonths)),
        lastWakeAt: parsed.lastWakeAt,
        sleeps,
      },
      error: '',
    }
  } catch (error) {
    return {
      data: defaultData(),
      error:
        error instanceof Error
          ? `We couldn't read your saved data: ${error.message}`
          : 'We couldn’t read your saved data.',
    }
  }
}

function getWakeWindow(ageMonths: number): WakeWindow {
  if (ageMonths < 4) return { min: 60, max: 90, target: 75 }
  if (ageMonths < 7) return { min: 90, max: 150, target: 120 }
  if (ageMonths < 10) return { min: 120, max: 180, target: 150 }
  if (ageMonths < 13) return { min: 150, max: 210, target: 180 }
  if (ageMonths < 19) return { min: 180, max: 240, target: 210 }
  return { min: 240, max: 360, target: 300 }
}

function sleepTargetHours(ageMonths: number) {
  if (ageMonths < 4) return 16
  if (ageMonths < 12) return 14
  return 13
}

function estimateWakeFromSleepPressure(
  baseWakeMinutes: number,
  adjustmentMinutes: number,
): number {
  const tauWake = baseWakeMinutes / Math.LN2
  const targetWakeMinutes = Math.max(45, baseWakeMinutes + adjustmentMinutes)
  const initialPressure = Math.min(
    SLEEP_PRESSURE_TARGET - Number.EPSILON,
    Math.max(
      0,
      SLEEP_PRESSURE_MAX -
        (SLEEP_PRESSURE_MAX - SLEEP_PRESSURE_TARGET) *
          Math.exp(targetWakeMinutes / tauWake),
    ),
  )
  const timeToTarget =
    -tauWake *
    Math.log(
      (SLEEP_PRESSURE_MAX - SLEEP_PRESSURE_TARGET) /
        (SLEEP_PRESSURE_MAX - initialPressure),
    )

  return Math.max(45, Math.round(timeToTarget))
}

function getDurationMinutes(sleep: SleepSession) {
  return Math.max(
    0,
    Math.round(
      (new Date(sleep.endedAt).getTime() -
        new Date(sleep.startedAt).getTime()) /
        60_000,
    ),
  )
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours} hr`
  return `${hours} hr ${rest} min`
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSleepType(type: SleepType) {
  return type === 'overnight' ? 'Overnight sleep' : 'Nap'
}

function formatDayLabel(date: Date, now: number) {
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date)
}

function getDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function getSleepMinutesForDay(
  sleeps: SleepSession[],
  date: Date,
  now: number,
) {
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return sleeps.reduce((total, sleep) => {
    const start = Math.max(new Date(sleep.startedAt).getTime(), dayStart.getTime())
    const end = Math.min(
      new Date(sleep.endedAt).getTime(),
      dayEnd.getTime(),
      now,
    )
    return total + Math.max(0, Math.round((end - start) / 60_000))
  }, 0)
}

function App() {
  const [initial] = useState(loadData)
  const [initialNightMode] = useState(loadNightMode)
  const [data, setData] = useState(initial.data)
  const [storageError, setStorageError] = useState(
    [initial.error, initialNightMode.error].filter(Boolean).join(' '),
  )
  const [storagePersistence, setStoragePersistence] =
    useState<StoragePersistence>(() =>
      'storage' in navigator ? 'checking' : 'unsupported',
    )
  const [nightMode, setNightMode] = useState(initialNightMode.enabled)
  const [now, setNow] = useState(() => Date.now())
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const month = new Date()
    month.setDate(1)
    month.setHours(0, 0, 0, 0)
    return month
  })
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() =>
    getDateKey(new Date()),
  )
  const [sleepType, setSleepType] = useState<SleepType>('nap')
  const [sleepStart, setSleepStart] = useState(() => {
    const start = new Date(Date.now() - 45 * 60_000)
    return currentLocalInputValue(start)
  })
  const [sleepEnd, setSleepEnd] = useState(() => currentLocalInputValue())
  const [wakeTimeInput, setWakeTimeInput] = useState(() =>
    currentLocalInputValue(),
  )
  const [formError, setFormError] = useState('')
  const [wakeTimeError, setWakeTimeError] = useState('')
  const [wakeUpMessage, setWakeUpMessage] = useState('')
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  )
  const [installHelpOpen, setInstallHelpOpen] = useState(false)
  const [isInstalled, setIsInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches,
  )
  const [installError, setInstallError] = useState('')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = nightMode ? 'night' : 'day'
  }, [nightMode])

  useEffect(() => {
    const storage = navigator.storage
    if (!storage?.persisted || !storage.persist) return

    let cancelled = false
    void (async () => {
      try {
        const alreadyPersistent = await storage.persisted()
        const persistent = alreadyPersistent || (await storage.persist())
        if (!cancelled) {
          setStoragePersistence(persistent ? 'granted' : 'not-granted')
        }
      } catch {
        if (!cancelled) setStoragePersistence('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
      setInstallHelpOpen(false)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function handleInstallClick() {
    setInstallError('')
    if (!installPrompt) {
      setInstallHelpOpen((open) => !open)
      return
    }
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      setInstallPrompt(null)
      if (outcome === 'accepted') setIsInstalled(true)
    } catch (error) {
      setInstallError(
        error instanceof Error
          ? `The install prompt couldn't be opened: ${error.message}`
          : 'The install prompt couldn’t be opened.',
      )
    }
  }

  function saveData(next: PlannerData) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setStorageError('')
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? `Your changes couldn't be saved: ${error.message}`
          : 'Your changes couldn’t be saved in this browser.',
      )
    }
  }

  function toggleNightMode() {
    const next = !nightMode
    setNightMode(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, String(next))
      setStorageError('')
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? `Your display preference couldn't be saved: ${error.message}`
          : 'Your display preference couldn’t be saved in this browser.',
      )
    }
  }

  const lastWake = new Date(data.lastWakeAt)
  const minutesAwake = Math.max(
    0,
    Math.floor((now - lastWake.getTime()) / 60_000),
  )
  const previousNap = [...data.sleeps].filter((sleep) => sleep.type === 'nap').sort(
    (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime(),
  ).find((sleep) => {
    const endedAt = new Date(sleep.endedAt).getTime()
    return endedAt <= now && endedAt >= now - 24 * 60 * 60_000
  })
  const recentSleepMinutes = data.sleeps.reduce((total, sleep) => {
    const start = Math.max(
      new Date(sleep.startedAt).getTime(),
      now - 24 * 60 * 60_000,
    )
    const end = Math.min(new Date(sleep.endedAt).getTime(), now)
    return total + Math.max(0, Math.round((end - start) / 60_000))
  }, 0)
  const sleepTrackingStarted = data.sleeps.some((sleep) => {
    const endedAt = new Date(sleep.endedAt).getTime()
    return endedAt <= now && endedAt >= now - 24 * 60 * 60_000
  })
  const sleepDeficitMinutes = sleepTrackingStarted
    ? Math.max(0, sleepTargetHours(data.ageMonths) * 60 - recentSleepMinutes)
    : 0
  const debtAdjustment = -Math.min(
    30,
    Math.round((sleepDeficitMinutes / 60) * 5),
  )
  const previousNapAdjustment = previousNap
    ? getDurationMinutes(previousNap) < 45
      ? -15
      : getDurationMinutes(previousNap) > 90
        ? 10
        : 0
    : 0
  const wakeWindow = getWakeWindow(data.ageMonths)
  const adjustedWindow = estimateWakeFromSleepPressure(
    wakeWindow.target,
    debtAdjustment + previousNapAdjustment,
  )
  const napStartAt = new Date(
    lastWake.getTime() + adjustedWindow * 60_000 - 15 * 60_000,
  )
  const napEndAt = new Date(
    lastWake.getTime() + adjustedWindow * 60_000 + 15 * 60_000,
  )
  const nextNapAt = new Date(lastWake.getTime() + adjustedWindow * 60_000)
  const napIsDue = nextNapAt.getTime() <= now
  const awakeHours = Math.floor(minutesAwake / 60)
  const awakeRemainder = minutesAwake % 60
  const awakeLabel =
    awakeHours > 0
      ? `${awakeHours}h ${awakeRemainder}m`
      : `${awakeRemainder} min`
  const pastSleepSessions = [...data.sleeps]
    .sort(
      (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime(),
    )
    .slice(0, 4)
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const todaySleepMinutes = data.sleeps.reduce((total, sleep) => {
    const start = Math.max(
      new Date(sleep.startedAt).getTime(),
      startOfToday.getTime(),
    )
    const end = Math.min(new Date(sleep.endedAt).getTime(), now)
    return total + Math.max(0, Math.round((end - start) / 60_000))
  }, 0)
  const todaySleepSessions = data.sleeps.filter(
    (sleep) =>
      new Date(sleep.endedAt).getTime() > startOfToday.getTime() &&
      new Date(sleep.startedAt).getTime() <= now,
  )
  const calendarToday = new Date(now)
  calendarToday.setHours(0, 0, 0, 0)
  const selectedDate = getDateFromKey(selectedCalendarDate)
  const selectedDateStart = new Date(selectedDate)
  selectedDateStart.setHours(0, 0, 0, 0)
  const selectedDateEnd = new Date(selectedDateStart)
  selectedDateEnd.setDate(selectedDateEnd.getDate() + 1)
  const selectedDaySleeps = data.sleeps
    .filter(
      (sleep) =>
        new Date(sleep.startedAt).getTime() < selectedDateEnd.getTime() &&
        new Date(sleep.endedAt).getTime() > selectedDateStart.getTime() &&
        new Date(sleep.startedAt).getTime() <= now,
    )
    .sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    )
  const selectedDaySleepMinutes = getSleepMinutesForDay(
    data.sleeps,
    selectedDate,
    now,
  )
  const selectedDayTargetMinutes = sleepTargetHours(data.ageMonths) * 60
  const selectedDayIsToday =
    selectedCalendarDate === getDateKey(calendarToday)
  const calendarMonthStart = new Date(
    calendarMonth.getFullYear(),
    calendarMonth.getMonth(),
    1,
  )
  const calendarDaysInMonth = new Date(
    calendarMonth.getFullYear(),
    calendarMonth.getMonth() + 1,
    0,
  ).getDate()
  const calendarCells = Array.from(
    { length: Math.ceil((calendarDaysInMonth + calendarMonthStart.getDay()) / 7) * 7 },
    (_, index) => {
      const day = index - calendarMonthStart.getDay() + 1
      return day > 0 && day <= calendarDaysInMonth
        ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day)
        : null
    },
  )
  const currentMonth = new Date(now)
  const isCurrentMonth =
    calendarMonth.getFullYear() === currentMonth.getFullYear() &&
    calendarMonth.getMonth() === currentMonth.getMonth()

  function changeCalendarMonth(offset: number) {
    const nextMonth = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() + offset,
      1,
    )
    setCalendarMonth(nextMonth)
    setSelectedCalendarDate(getDateKey(nextMonth))
  }

  function updateData(updates: Partial<PlannerData>) {
    const next = { ...data, ...updates }
    setData(next)
    saveData(next)
  }

  function handleAddNap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const start = new Date(sleepStart)
    const end = new Date(sleepEnd)
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      setFormError('Choose an end time that comes after the start time.')
      return
    }
    if (end.getTime() > Date.now()) {
      setFormError('A sleep end time can’t be in the future.')
      return
    }
    const newNap: SleepSession = {
      id: crypto.randomUUID(),
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      type: sleepType,
    }
    const next = {
      ...data,
      lastWakeAt: end.toISOString(),
      sleeps: [...data.sleeps, newNap],
    }
    setData(next)
    saveData(next)
    setFormError('')
    setWakeUpMessage('')
    const nowValue = currentLocalInputValue()
    setSleepStart(currentLocalInputValue(new Date(Date.now() - 45 * 60_000)))
    setSleepEnd(nowValue)
  }

  function handleLogWake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const wakeTime = new Date(wakeTimeInput)
    if (Number.isNaN(wakeTime.getTime())) {
      setWakeTimeError('Choose a valid wake-up time.')
      return
    }
    if (wakeTime.getTime() > Date.now()) {
      setWakeTimeError('A wake-up time can’t be in the future.')
      return
    }
    updateData({ lastWakeAt: wakeTime.toISOString() })
    setWakeTimeError('')
    setWakeUpMessage(
      `Wake-up logged at ${formatTime(wakeTime)}. The next wake window starts from this time.`,
    )
  }

  function handleRemoveSleep(sleepId: string) {
    const next = {
      ...data,
      sleeps: data.sleeps.filter((sleep) => sleep.id !== sleepId),
    }
    setData(next)
    saveData(next)
  }

  function handleReset() {
    if (
      window.confirm(
        'Clear this baby’s profile and all sleep history saved on this device?',
      )
    ) {
      const cleared = defaultData()
      setData(cleared)
      saveData(cleared)
      setFormError('')
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Little Day home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="M22.5 5.2a11.2 11.2 0 1 0 4.3 19.5A11.2 11.2 0 0 1 22.5 5.2Z"
                fill="currentColor"
              />
              <path d="m9 8 .7 2.2L12 11l-2.3.8L9 14l-.7-2.2L6 11l2.3-.8L9 8Z" fill="currentColor" />
              <path d="m18 2 .5 1.5L20 4l-1.5.5L18 6l-.5-1.5L16 4l1.5-.5L18 2Z" fill="currentColor" />
            </svg>
          </span>
          <span>little day</span>
        </a>
        <div className="private-note">
          <span className="lock-icon" aria-hidden="true">⌑</span>
          Saved on this device
        </div>
        <button
          className="theme-button"
          type="button"
          aria-pressed={nightMode}
          onClick={toggleNightMode}
        >
          <span aria-hidden="true">{nightMode ? '☀' : '☾'}</span>
          <span className="theme-button-label">
            {nightMode ? 'Day mode' : 'Night mode'}
          </span>
        </button>
        {!isInstalled && (
          <button className="install-button" type="button" onClick={handleInstallClick}>
            Install app
          </button>
        )}
      </header>

      {installError && <div className="notice error-notice" role="alert">{installError}</div>}
      {installHelpOpen && !isInstalled && (
        <aside className="install-help" aria-label="How to install Little Day">
          <button
            className="install-help-close"
            type="button"
            aria-label="Close installation instructions"
            onClick={() => setInstallHelpOpen(false)}
          >
            ×
          </button>
          <strong>Install Little Day on your device</strong>
          <p>
            In Chrome or Edge, choose <b>Install Little Day</b> from the browser
            menu or address bar. On iPhone or iPad, tap <b>Share</b>, then{' '}
            <b>Add to Home Screen</b>. In Safari on Mac, choose{' '}
            <b>File → Add to Dock</b>.
          </p>
        </aside>
      )}

      {storageError && (
        <div className="notice error-notice" role="alert">
          <span>{storageError}</span>
          <button type="button" onClick={() => setStorageError('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <section className="welcome">
        <p className="eyebrow"><span className="sun-icon">✳</span> A gentler rhythm, one nap at a time</p>
        <h1>Good day{data.babyName ? `, ${data.babyName}` : ''}<span className="heading-period">.</span></h1>
        <p className="welcome-copy">Little clues add up. Let’s find a nap rhythm that feels right for your little one.</p>
      </section>

      <section className="planner-grid" aria-label="Nap planner">
        <article className="nap-card">
          <div className="card-topline">
            <span className="card-kicker">YOUR NEXT NAP</span>
            <span className="moon-sticker" aria-hidden="true">☾</span>
          </div>
          <p className="nap-intro">
            {napIsDue
              ? 'The estimated nap time has passed'
              : minutesAwake >= adjustedWindow
              ? 'Your little one may be ready for a nap'
              : 'A little window to wind down is coming up'}
          </p>
          {napIsDue ? (
            <div className="nap-time nap-time-due">
              <span className="nap-time-range">
                {formatTime(napStartAt)}
                <span className="time-dash">—</span>
                {formatTime(napEndAt)}
              </span>
              <span className="nap-time-now">Now</span>
            </div>
          ) : (
            <div className="nap-time">
              {formatTime(napStartAt)}
              <span className="time-dash">—</span>
              {formatTime(napEndAt)}
            </div>
          )}
          <p className="nap-date">
            {napIsDue
              ? `It was due around ${formatTime(nextNapAt)}. If they haven't slept yet, consider settling them now.`
              : `${formatDayLabel(nextNapAt, now)} · around ${formatTime(nextNapAt)}`}
          </p>
          <div className="nap-progress" aria-label={`${Math.min(100, Math.round((minutesAwake / adjustedWindow) * 100))}% of the estimated wake window elapsed`}>
            <div
              className="nap-progress-fill"
              style={{ width: `${Math.min(100, Math.round((minutesAwake / adjustedWindow) * 100))}%` }}
            />
            <span className="progress-sun" aria-hidden="true">☼</span>
          </div>
          <div className="nap-progress-caption">
            <span>Last woke {formatTime(lastWake)}</span>
            <span>{awakeLabel} awake</span>
          </div>
          <div className="math-summary">
            <span><i className="math-dot base-dot" />Base {formatDuration(wakeWindow.min)}–{formatDuration(wakeWindow.max)}</span>
            {debtAdjustment !== 0 && (
              <span><i className="math-dot debt-dot" />Sleep balance {debtAdjustment} min</span>
            )}
            {previousNapAdjustment !== 0 && (
              <span><i className="math-dot nap-dot" />Last nap {previousNapAdjustment > 0 ? '+' : ''}{previousNapAdjustment} min</span>
            )}
          </div>
          <form className="wake-up-form" onSubmit={handleLogWake}>
            <div className="datetime-field">
              <label className="field-label" htmlFor="wake-up-time">
                When did they wake?
              </label>
              <input
                id="wake-up-time"
                type="datetime-local"
                value={wakeTimeInput}
                max={currentLocalInputValue(new Date(now))}
                onChange={(event) => setWakeTimeInput(event.target.value)}
                required
              />
            </div>
            <button className="wake-button" type="submit">
              <span aria-hidden="true">☼</span> Log wake-up
            </button>
          </form>
          <p className="wake-up-hint">
            You can enter an earlier time. Adding sleep in the journal also
            updates this wake-window clock.
          </p>
          {wakeTimeError && <p className="form-error" role="alert">{wakeTimeError}</p>}
          {wakeUpMessage && <p className="wake-up-message" role="status" aria-live="polite">{wakeUpMessage}</p>}
        </article>

        <aside className="side-stack">
          <article className="profile-card">
            <div className="section-heading">
              <span className="section-icon profile-icon" aria-hidden="true">♡</span>
              <div>
                <h2>A little about them</h2>
                <p>We’ll tailor the timing as they grow.</p>
              </div>
            </div>
            <label className="field-label" htmlFor="baby-name">Their name <span>OPTIONAL</span></label>
            <input
              id="baby-name"
              className="text-input"
              type="text"
              maxLength={30}
              placeholder="Your little one"
              value={data.babyName}
              onChange={(event) => updateData({ babyName: event.target.value })}
            />
            <label className="field-label age-label" htmlFor="age-months">Age <span>IN MONTHS</span></label>
            <div className="age-control">
              <button
                type="button"
                aria-label="Decrease age by one month"
                disabled={data.ageMonths <= 0}
                onClick={() => updateData({ ageMonths: Math.max(0, data.ageMonths - 1) })}
              >−</button>
              <input
                id="age-months"
                className="age-input"
                type="number"
                min="0"
                max="24"
                step="1"
                aria-label="Age in months"
                value={data.ageMonths}
                onChange={(event) => {
                  const age = Number(event.target.value)
                  if (Number.isFinite(age)) updateData({ ageMonths: Math.min(24, Math.max(0, age)) })
                }}
              />
              <button
                type="button"
                aria-label="Increase age by one month"
                disabled={data.ageMonths >= 24}
                onClick={() => updateData({ ageMonths: Math.min(24, data.ageMonths + 1) })}
              >+</button>
            </div>
            <p className="field-hint">Up to 24 months</p>
          </article>

          <article className="day-card">
            <div className="day-card-heading">
              <span className="section-icon day-icon" aria-hidden="true">☀</span>
              <div><h2>Today, so far</h2><p>A little snapshot of their day.</p></div>
            </div>
            <div className="day-stats">
              <div><strong>{todaySleepSessions.length}</strong><span>{todaySleepSessions.length === 1 ? 'sleep entry' : 'sleep entries'}</span></div>
              <div className="stat-divider" />
              <div><strong>{todaySleepMinutes === 0 ? '—' : formatDuration(todaySleepMinutes)}</strong><span>sleep today</span></div>
            </div>
          </article>
        </aside>
      </section>

      <section className="lower-grid">
        <article className="log-card">
          <div className="section-heading">
            <span className="section-icon log-icon" aria-hidden="true">✎</span>
            <div><h2>Sleep journal</h2><p>Log naps and overnight sleep.</p></div>
          </div>
          <form className="nap-form" onSubmit={handleAddNap}>
            <div className="datetime-field">
              <label className="field-label" htmlFor="sleep-type">Sleep type</label>
              <select id="sleep-type" value={sleepType} onChange={(event) => setSleepType(event.target.value === 'overnight' ? 'overnight' : 'nap')}>
                <option value="nap">Nap</option>
                <option value="overnight">Overnight sleep</option>
              </select>
            </div>
            <div className="datetime-field">
              <label className="field-label" htmlFor="sleep-start">Sleep started</label>
              <input id="sleep-start" type="datetime-local" value={sleepStart} max={currentLocalInputValue()} onChange={(event) => setSleepStart(event.target.value)} required />
            </div>
            <div className="datetime-field">
              <label className="field-label" htmlFor="sleep-end">Woke up</label>
              <input id="sleep-end" type="datetime-local" value={sleepEnd} max={currentLocalInputValue()} onChange={(event) => setSleepEnd(event.target.value)} required />
            </div>
            <button className="add-nap-button" type="submit"><span aria-hidden="true">＋</span> Add {sleepType === 'nap' ? 'nap' : 'overnight sleep'}</button>
          </form>
          <p className="journal-hint">For overnight sleep, set the start and wake-up date across midnight as needed.</p>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          {pastSleepSessions.length > 0 ? (
            <ul className="sleep-list">
              {pastSleepSessions.map((sleep) => (
                <li key={sleep.id}>
                  <span className="sleep-list-icon" aria-hidden="true">☾</span>
                  <div className="sleep-list-time">
                    <strong>{formatSleepType(sleep.type)} · {formatDateTime(sleep.startedAt)}</strong>
                    <span>Woke {formatDateTime(sleep.endedAt)}</span>
                  </div>
                  <span className="sleep-duration">{formatDuration(getDurationMinutes(sleep))}</span>
                  <button
                    className="remove-sleep-button"
                    type="button"
                    aria-label={`Remove ${formatSleepType(sleep.type).toLowerCase()} from ${formatDateTime(sleep.startedAt)}`}
                    onClick={() => handleRemoveSleep(sleep.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-journal"><span aria-hidden="true">☁</span><p>No sleep logged yet. Your first entry starts the rhythm.</p></div>
          )}
        </article>

        <aside className="insight-card">
          <div className="insight-sparkle" aria-hidden="true">✳</div>
          <p className="card-kicker">A NOTE ON THE MATH</p>
          <h2>Every baby has their own rhythm.</h2>
          <p className="insight-copy">The estimate uses a normalized sleep-pressure curve, calibrated to a typical wake window for their age. Recent sleep and the last nap adjust the starting pressure. It’s a planning guide, not a biological measurement or a rulebook.</p>
          <div className="formula">S(t) = Smax − (Smax − S₀) · e<sup>−t/τw</sup></div>
        </aside>
      </section>

      <section className="calendar-card" aria-labelledby="sleep-calendar-heading">
      <div className="section-heading calendar-heading">
        <span className="section-icon calendar-icon" aria-hidden="true">▦</span>
        <div>
          <h2 id="sleep-calendar-heading">Sleep calendar</h2>
          <p>Look back at logged sleep and daily totals.</p>
        </div>
      </div>
      <div className="calendar-layout">
        <div className="calendar-month">
          <div className="calendar-month-heading">
            <h3>
              {new Intl.DateTimeFormat(undefined, {
                month: 'long',
                year: 'numeric',
              }).format(calendarMonth)}
            </h3>
            <div className="calendar-navigation">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => changeCalendarMonth(-1)}
              >‹</button>
              <button
                type="button"
                aria-label="Next month"
                disabled={isCurrentMonth}
                onClick={() => changeCalendarMonth(1)}
              >›</button>
            </div>
          </div>
          <div className="calendar-grid calendar-weekdays" aria-hidden="true">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid calendar-days">
            {calendarCells.map((date, index) => {
              if (!date) {
                return <span className="calendar-empty-cell" key={`empty-${index}`} />
              }
              const dateKey = getDateKey(date)
              const daySleepMinutes = getSleepMinutesForDay(data.sleeps, date, now)
              const isToday = dateKey === getDateKey(calendarToday)
              const isSelected = dateKey === selectedCalendarDate
              const isFuture = date.getTime() > calendarToday.getTime()
              return (
                <button
                  className={[
                    'calendar-day',
                    daySleepMinutes > 0 ? 'has-sleep' : '',
                    isToday ? 'is-today' : '',
                    isSelected ? 'is-selected' : '',
                  ].filter(Boolean).join(' ')}
                  type="button"
                  key={dateKey}
                  aria-pressed={isSelected}
                  aria-label={`${new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'full',
                  }).format(date)}${daySleepMinutes > 0 ? `, ${formatDuration(daySleepMinutes)} logged sleep` : ', no sleep logged'}${isToday ? ', today' : ''}`}
                  disabled={isFuture}
                  onClick={() => setSelectedCalendarDate(dateKey)}
                >
                  <span className="calendar-day-number">{date.getDate()}</span>
                  <span className="calendar-day-sleep">
                    {daySleepMinutes > 0
                      ? `${Math.floor(daySleepMinutes / 60)}h`
                      : ' '}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="calendar-legend">
            Hours shown for logged sleep. Overnight sleep is counted on each
            day it overlaps.
          </p>
        </div>

        <aside className="calendar-day-detail" aria-live="polite">
          <p className="card-kicker">DAY SUMMARY</p>
          <h3>
            {selectedDayIsToday
              ? 'Today'
              : new Intl.DateTimeFormat(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                }).format(selectedDate)}
          </h3>
          {selectedDaySleeps.length > 0 ? (
            <>
              <p className="calendar-total">
                {formatDuration(selectedDaySleepMinutes)}
                <span> logged sleep</span>
              </p>
              <p className="calendar-target">
                {selectedDayIsToday
                  ? selectedDaySleepMinutes >= selectedDayTargetMinutes
                    ? `Approximate daily target reached with ${formatDuration(selectedDaySleepMinutes)} logged so far.`
                    : `${formatDuration(selectedDaySleepMinutes)} logged so far of an approximate ${selectedDayTargetMinutes / 60} hr daily target.`
                  : selectedDaySleepMinutes >= selectedDayTargetMinutes
                    ? `Met the approximate ${selectedDayTargetMinutes / 60} hr daily target.`
                    : `${formatDuration(selectedDayTargetMinutes - selectedDaySleepMinutes)} below the approximate ${selectedDayTargetMinutes / 60} hr daily target.`}
              </p>
              <ul className="calendar-sleep-list">
                {selectedDaySleeps.map((sleep) => {
                  const sessionMinutes = getSleepMinutesForDay(
                    [sleep],
                    selectedDate,
                    now,
                  )
                  return (
                    <li key={sleep.id}>
                      <span>
                        <strong>{formatSleepType(sleep.type)}</strong>
                        <small>
                          {formatDateTime(sleep.startedAt)} · woke {formatDateTime(sleep.endedAt)}
                        </small>
                      </span>
                      <span className="calendar-entry-duration">
                        {formatDuration(sessionMinutes)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <div className="calendar-no-sleep">
              <span aria-hidden="true">☁</span>
              <p>No sleep logged for this day.</p>
              <small>
                The approximate daily target for their age is {selectedDayTargetMinutes / 60} hours.
              </small>
            </div>
          )}
          <p className="calendar-disclaimer">
            Daily sleep needs are approximate. The calendar reflects entries
            logged in this browser.
          </p>
        </aside>
      </div>
      </section>

      <section className="how-to-card" aria-labelledby="how-to-heading">
        <div className="section-heading">
          <span className="section-icon how-to-icon" aria-hidden="true">?</span>
          <div>
            <h2 id="how-to-heading">How to use Little Day</h2>
            <p>A few simple steps to get started.</p>
          </div>
        </div>
        <ol className="how-to-steps">
          <li>
            <strong>Set their age</strong>
            <span>Wake-window estimates adjust to your baby’s age.</span>
          </li>
          <li>
            <strong>Log sleep when they wake</strong>
            <span>Choose nap or overnight sleep, then enter when sleep started and when they woke.</span>
          </li>
          <li>
            <strong>Check the next nap estimate</strong>
            <span>The planner uses their last wake-up and sleep history as a gentle guide.</span>
          </li>
          <li>
            <strong>Log a wake-up, even after the fact</strong>
            <span>Enter when they actually woke. Adding a sleep entry also sets the wake-window clock to that sleep’s end time.</span>
          </li>
          <li>
            <strong>Review sleep by day</strong>
            <span>The calendar shows logged sleep totals alongside an approximate daily target for their age.</span>
          </li>
        </ol>
        <p className="how-to-note">Your profile and sleep log are saved locally in this browser.</p>
      </section>

      <footer className="page-footer">
        <p>Made for the little moments <span aria-hidden="true">♡</span></p>
        <div className="footer-actions">
          <span role="status">
            {storagePersistence === 'checking' && 'Checking device storage…'}
            {storagePersistence === 'granted' &&
              'Saved on this device · protected from automatic cleanup'}
            {storagePersistence === 'not-granted' &&
              'Saved on this device · browser may clear storage'}
            {storagePersistence === 'unsupported' &&
              'Saved on this device · browser manages storage'}
            {storagePersistence === 'error' &&
              'Saved on this device · storage protection unavailable'}
          </span>
          <button type="button" onClick={handleReset}>Clear saved data</button>
        </div>
      </footer>
    </main>
  )
}

export default App
