import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { getSupabaseClient, isSupabaseConfigured, type NestEggCard, type TableRow } from './lib/supabase'
import { hashPin } from './lib/pin'

const AUTH_STORAGE_KEY = 'nest-egg.remembered-auth'
const PIN_HASH_STORAGE_KEY = 'nest-egg.pin-hash'
const HOME_MODE_STORAGE_KEY = 'nest-egg.home-mode'
const DEFAULT_PIN = '1234'
const SETTINGS_ROW_ID = 'global'

type HomeMode = 'A' | 'B'

// ─── helpers ────────────────────────────────────────────────────────────────

function getErrorMessage(error: unknown) {
  let msg: string
  if (error instanceof Error) msg = error.message
  else if (typeof error === 'object' && error !== null && 'message' in error) {
    msg = String((error as { message: string }).message)
  } else {
    return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
  if (msg.includes('row-level security') || msg.includes('RLS')) {
    return '저장이 막혀 있어요. Supabase → SQL Editor에서 nest_egg/migration-2-pin-auth.sql 내용을 붙여넣고 Run 하세요. (또는 migration.sql 전체)'
  }
  if (msg.includes('user_id') && msg.includes('null')) {
    return 'DB에 user_id 열이 남아 있어요. migration-2-pin-auth.sql (또는 migration.sql) 을 SQL Editor에서 실행해 주세요.'
  }
  if (msg.includes('include_negatives')) {
    return 'DB에 include_negatives 열이 없어요. Supabase → SQL Editor에서 nest_egg/migration-3-include-negatives.sql 을 실행해 주세요.'
  }
  if (msg.includes('pair_id') || msg.includes('minus_rows')) {
    return 'DB에 pair_id/minus_rows 열이 없어요. Supabase → SQL Editor에서 nest_egg/migration-4-pair-minus.sql 을 실행해 주세요.'
  }
  return msg
}

function genId() {
  return crypto.randomUUID()
}

function formatAmount(n: number): string {
  return n.toLocaleString('ko-KR')
}

function parseAmountInput(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function sanitizeAmountInput(raw: string): string {
  let s = raw.replace(/[^\d,.\-]/g, '')
  const negative = s.startsWith('-')
  s = s.replace(/-/g, '')
  if (negative) s = '-' + s
  const dotIdx = s.indexOf('.')
  if (dotIdx !== -1) {
    s = s.slice(0, dotIdx + 1) + s.slice(dotIdx + 1).replace(/\./g, '')
  }
  return s
}

function formatAmountDisplay(amount: number): string {
  if (amount === 0) return ''
  return formatAmount(amount)
}

function extractYear(cardName: string): number | null {
  // "2025년 12월" / "2026년1월" 같이 한글/공백 변형을 모두 허용
  const m = String(cardName ?? '').trim().match(/^(\d{4})년/)
  if (!m) return null
  const y = Number(m[1])
  return Number.isFinite(y) ? y : null
}

function pickLatestCard(cards: NestEggCard[]) {
  if (cards.length === 0) return null
  const sorted = [...cards].sort((a, b) => {
    const aCreated = new Date((a as any).created_at ?? 0).getTime()
    const bCreated = new Date((b as any).created_at ?? 0).getTime()
    if (aCreated && bCreated && aCreated !== bCreated) return bCreated - aCreated
    return 0
  })
  return sorted[0] ?? null
}

function makeDefaultRows(count = 10): TableRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: genId(),
    content: '',
    amount: 0,
    checked: false,
    sort_order: i,
  }))
}

function computeTotal(rows: TableRow[]): number {
  return rows.reduce((sum, r) => sum + (r.amount || 0), 0)
}

function isPairedB(card: NestEggCard) {
  return Boolean(card.pair_id) && !card.include_negatives
}

function isPairedA(card: NestEggCard) {
  return Boolean(card.pair_id) && Boolean(card.include_negatives)
}

function cardBaseTotal(card: NestEggCard) {
  if (card.manual_total !== null) return card.manual_total
  return computeTotal(card.rows)
}

function cardDisplayTotal(card: NestEggCard) {
  const base = cardBaseTotal(card)
  if (isPairedB(card)) return base + computeTotal(card.minus_rows ?? [])
  return base
}

/** A 행을 B에 반영하되, 가능하면 B 행 id를 유지 */
function syncRowsPreserveIds(aRows: TableRow[], bRows: TableRow[]): TableRow[] {
  const sortedA = [...aRows].sort((a, b) => a.sort_order - b.sort_order)
  const sortedB = [...bRows].sort((a, b) => a.sort_order - b.sort_order)
  return sortedA.map((aRow, i) => ({
    id: sortedB[i]?.id ?? genId(),
    content: aRow.content,
    amount: aRow.amount,
    checked: aRow.checked,
    sort_order: i,
  }))
}


// ─── icons ──────────────────────────────────────────────────────────────────

function IconEgg() {
  const uid = useId().replace(/:/g, '')
  const shell = `egg-shell-${uid}`
  const shine = `egg-shine-${uid}`
  const nest = `egg-nest-${uid}`

  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={shell} x1="14" y1="4" x2="34" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fffaf5" />
          <stop offset="0.45" stopColor="#d2b48c" />
          <stop offset="1" stopColor="#a67c52" />
        </linearGradient>
        <linearGradient id={shine} x1="16" y1="8" x2="24" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={nest} x1="8" y1="34" x2="40" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d2b48c" />
          <stop offset="1" stopColor="#8b5a2b" />
        </linearGradient>
      </defs>
      <path
        d="M10 38c2.2-3.2 6.8-5.2 14-5.2s11.8 2 14 5.2c.6.9-.1 2-1.2 2H11.2c-1.1 0-1.8-1.1-1.2-2Z"
        fill={`url(#${nest})`}
        opacity="0.9"
      />
      <path
        d="M13 39.5c2-1.6 5.4-2.6 11-2.6s9 1 11 2.6"
        stroke="#6b4423"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M24 6c-5.6 0-11 7.2-11 16.2C13 30.6 17.9 37 24 37s11-6.4 11-14.8C35 13.2 29.6 6 24 6Z"
        fill={`url(#${shell})`}
      />
      <path
        d="M18.5 12.5c1.6-2.8 3.8-4.4 5.6-4.4 1.2 0 2 .8 1.6 2.4-.6 2.4-2.8 4.6-5.4 5.8-.9.4-1.8-.6-1.8-1.8 0-.7.2-1.4.6-2Z"
        fill={`url(#${shine})`}
      />
      <ellipse cx="27.5" cy="22" rx="2.2" ry="2.8" fill="#ffffff" opacity="0.28" />
    </svg>
  )
}


function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}

function IconArrowUp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

function IconArrowDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.5 11V8.75a4.5 4.5 0 1 1 9 0V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7.25 11h9.5a2 2 0 0 1 2 2v5.5a2.25 2.25 0 0 1-2.25 2.25h-9A2.25 2.25 0 0 1 5.25 18.5V13a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M12 15.3v2.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// ─── ConfirmDialog ───────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-title">{title}</p>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel}>취소</button>
          <button className="primary-button" style={{ background: 'var(--pink-mid)', boxShadow: 'none' }} onClick={onConfirm}>삭제</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(false)
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')
  const [isChangingPin, setIsChangingPin] = useState(false)
  const [currentPinInput, setCurrentPinInput] = useState('')
  const [newPinInput, setNewPinInput] = useState('')
  const [pinChangeError, setPinChangeError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [dataError, setDataError] = useState('')
  const [view, setView] = useState<'main' | 'detail'>('main')
  /** A = 마이너스 포함(기본), B = 마이너스 미포함 */
  const [homeMode, setHomeMode] = useState<HomeMode>(() => {
    const saved = window.localStorage.getItem(HOME_MODE_STORAGE_KEY)
    if (saved === 'B') return 'B'
    // 이전 키 호환
    if (window.localStorage.getItem('nest-egg.include-negatives') === 'false') return 'B'
    return 'A'
  })
  const includeNegatives = homeMode === 'A'
  const [modeSlide, setModeSlide] = useState<'idle' | 'out' | 'in'>('idle')
  const [modeDir, setModeDir] = useState<'forward' | 'back'>('forward')
  const modeBusy = useRef(false)
  const modeTimers = useRef<{ out?: ReturnType<typeof setTimeout>; inn?: ReturnType<typeof setTimeout> }>({})
  const [cards, setCards] = useState<NestEggCard[]>([])
  const [selectedCard, setSelectedCard] = useState<NestEggCard | null>(null)
  const [loadingCards, setLoadingCards] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // create modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newCardName, setNewCardName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createCardError, setCreateCardError] = useState('')

  // rename modal
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameCardId, setRenameCardId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')

  // confirm dialog
  const [confirmState, setConfirmState] = useState<{
    title: string; message: string; resolve: (v: boolean) => void
  } | null>(null)

  // detail: selected row
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<'main' | 'minus'>('main')
  const [editingAmountRowId, setEditingAmountRowId] = useState<string | null>(null)
  const [amountDraft, setAmountDraft] = useState<string | null>(null)
  const [editingTotal, setEditingTotal] = useState(false)
  const [totalDraft, setTotalDraft] = useState<string | null>(null)

  // save debounce
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedJson = useRef<string>('')

  const defaultPin = String(import.meta.env.VITE_APP_PIN ?? DEFAULT_PIN).trim()
  const supabaseReady = isSupabaseConfigured()
  const defaultPinHashPromise = useMemo(() => hashPin(defaultPin), [defaultPin])

  // ── auth (cashflow와 동일: PIN + 이 기기 기억) ─────────────────────────────

  useEffect(() => {
    const remembered = window.localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
    setRememberDevice(remembered)
    setIsAuthenticated(remembered)
    setIsCheckingAuth(false)
  }, [])

  useEffect(() => {
    if (!statusMessage) return
    const id = window.setTimeout(() => setStatusMessage(''), 2500)
    return () => window.clearTimeout(id)
  }, [statusMessage])

  const ensureRemotePinHash = useCallback(async () => {
    const fallback = await defaultPinHashPromise
    if (!supabaseReady) return fallback
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('nest_egg_app_settings')
      .select('pin_hash')
      .eq('id', SETTINGS_ROW_ID)
      .maybeSingle()
    if (error) throw error
    if (data?.pin_hash) return data.pin_hash
    const { error: upsertError } = await supabase
      .from('nest_egg_app_settings')
      .upsert({ id: SETTINGS_ROW_ID, pin_hash: fallback })
    if (upsertError) throw upsertError
    return fallback
  }, [defaultPinHashPromise, supabaseReady])

  const resolveExpectedPinHash = useCallback(async () => {
    try {
      const remote = await ensureRemotePinHash()
      window.localStorage.setItem(PIN_HASH_STORAGE_KEY, remote)
      return remote
    } catch {
      const saved = window.localStorage.getItem(PIN_HASH_STORAGE_KEY)
      if (saved) return saved
      return defaultPinHashPromise
    }
  }, [defaultPinHashPromise, ensureRemotePinHash])

  async function handlePinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pin.length !== 4) {
      setAuthError('PIN 4자리를 입력해 주세요.')
      return
    }
    try {
      const expected = await resolveExpectedPinHash()
      const input = await hashPin(pin)
      if (input !== expected) {
        setAuthError('입력한 PIN이 일치하지 않습니다.')
        return
      }
    } catch {
      setAuthError('PIN 확인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.')
      return
    }
    if (rememberDevice) window.localStorage.setItem(AUTH_STORAGE_KEY, 'true')
    else window.localStorage.removeItem(AUTH_STORAGE_KEY)
    setAuthError('')
    setPin('')
    setHomeMode('A')
    window.localStorage.setItem(HOME_MODE_STORAGE_KEY, 'A')
    setIsAuthenticated(true)
  }

  async function handlePinChangeSave() {
    setPinChangeError('')
    if (currentPinInput.length !== 4) {
      setPinChangeError('현재 PIN 4자리를 입력해 주세요.')
      return
    }
    if (newPinInput.length !== 4) {
      setPinChangeError('새 PIN 4자리를 입력해 주세요.')
      return
    }
    try {
      const expected = await resolveExpectedPinHash()
      const current = await hashPin(currentPinInput)
      if (current !== expected) {
        setPinChangeError('현재 PIN이 일치하지 않습니다.')
        return
      }
      const next = await hashPin(newPinInput)
      if (supabaseReady) {
        const supabase = getSupabaseClient()
        const { error } = await supabase
          .from('nest_egg_app_settings')
          .upsert({ id: SETTINGS_ROW_ID, pin_hash: next })
        if (error) throw error
      }
      window.localStorage.setItem(PIN_HASH_STORAGE_KEY, next)
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      setRememberDevice(false)
      setIsAuthenticated(false)
      setIsChangingPin(false)
      setCurrentPinInput('')
      setNewPinInput('')
      setPin('')
      setAuthError('')
      setHomeMode('A')
      window.localStorage.setItem(HOME_MODE_STORAGE_KEY, 'A')
      setStatusMessage('PIN을 변경했어요. 다시 로그인해 주세요.')
    } catch (error) {
      setPinChangeError(getErrorMessage(error))
    }
  }

  function handlePinDigits(setter: (v: string) => void, e: ChangeEvent<HTMLInputElement>) {
    setter(e.target.value.replace(/\D/g, '').slice(0, 4))
  }

  function handlePinChange(e: ChangeEvent<HTMLInputElement>) {
    setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
    if (authError) setAuthError('')
  }

  function handleLock() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    setRememberDevice(false)
    setPin('')
    setIsAuthenticated(false)
    setView('main')
    setSelectedCard(null)
    setHomeMode('A')
    window.localStorage.setItem(HOME_MODE_STORAGE_KEY, 'A')
  }

  // ── toast ─────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 2400)
  }

  // ── confirm ───────────────────────────────────────────────────────────────

  function askConfirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmState({ title, message, resolve })
    })
  }

  function handleConfirmAnswer(answer: boolean) {
    confirmState?.resolve(answer)
    setConfirmState(null)
  }

  // ── load cards ────────────────────────────────────────────────────────────

  const normalizeCards = (data: NestEggCard[] | null) =>
    (data ?? []).map((card) => ({
      ...card,
      include_negatives: card.include_negatives !== false,
      pair_id: card.pair_id ?? null,
      minus_rows: Array.isArray(card.minus_rows) ? card.minus_rows : [],
    }))

  /** B(마이너스 미포함)가 비어 있으면 A 카드를 그대로 복제해 채운다 */
  const seedBCardsFromA = useCallback(async (allCards: NestEggCard[]) => {
    const aCards = allCards.filter((c) => c.include_negatives)
    const bCards = allCards.filter((c) => !c.include_negatives)
    if (aCards.length === 0 || bCards.length > 0) return allCards

    const supabase = getSupabaseClient()
    const copies = aCards.map((card) => ({
      name: card.name,
      rows: card.rows.map((r) => ({
        ...r,
        id: genId(),
      })),
      manual_total: card.manual_total,
      include_negatives: false,
      pair_id: null as string | null,
      minus_rows: [] as TableRow[],
      created_at: card.created_at,
    }))
    const { error } = await supabase.from('nest_egg_cards').insert(copies)
    if (error) throw error

    const { data, error: reloadError } = await supabase
      .from('nest_egg_cards')
      .select('*')
      .order('created_at', { ascending: false })
    if (reloadError) throw reloadError
    return normalizeCards(data as NestEggCard[])
  }, [])

  /** 페어인데 B 기본 내역이 A와 다르면 A 기준으로 맞춤 (기존 빈 B 복구) */
  const repairPairedCards = useCallback(async (allCards: NestEggCard[]) => {
    const aCards = allCards.filter(isPairedA)
    if (aCards.length === 0) return allCards

    const supabase = getSupabaseClient()
    let next = allCards
    let changed = false

    for (const aCard of aCards) {
      const bCard = next.find((c) => c.pair_id === aCard.pair_id && !c.include_negatives)
      if (!bCard) continue

      const aSig = JSON.stringify(
        [...aCard.rows]
          .sort((x, y) => x.sort_order - y.sort_order)
          .map((r) => [r.content, r.amount, r.checked]),
      )
      const bSig = JSON.stringify(
        [...bCard.rows]
          .sort((x, y) => x.sort_order - y.sort_order)
          .map((r) => [r.content, r.amount, r.checked]),
      )
      if (aSig === bSig && aCard.name === bCard.name && aCard.manual_total === bCard.manual_total) {
        continue
      }

      const syncedRows = syncRowsPreserveIds(aCard.rows, bCard.rows)
      const { error } = await supabase
        .from('nest_egg_cards')
        .update({
          name: aCard.name,
          rows: syncedRows,
          manual_total: aCard.manual_total,
        })
        .eq('id', bCard.id)
      if (error) {
        console.error('페어 복구 오류:', error)
        continue
      }
      changed = true
      next = next.map((c) =>
        c.id === bCard.id
          ? { ...c, name: aCard.name, rows: syncedRows, manual_total: aCard.manual_total }
          : c,
      )
    }

    return changed ? next : allCards
  }, [])

  const loadCards = useCallback(async () => {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않았어요.')
      return
    }
    setLoadingCards(true)
    setDataError('')
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('nest_egg_cards')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      const normalized = normalizeCards(data as NestEggCard[])
      const withB = await seedBCardsFromA(normalized)
      const repaired = await repairPairedCards(withB)
      setCards(repaired)
    } catch (err) {
      setDataError(getErrorMessage(err))
      console.error('카드 로딩 오류:', err)
    } finally {
      setLoadingCards(false)
    }
  }, [repairPairedCards, seedBCardsFromA, supabaseReady])

  useEffect(() => {
    if (!isAuthenticated) {
      setCards([])
      return
    }
    void loadCards()
  }, [isAuthenticated, loadCards])

  // ── create card ───────────────────────────────────────────────────────────

  async function handleCreateCard(e: React.FormEvent) {
    e.preventDefault()
    const name = newCardName.trim()
    if (!name) return
    if (!supabaseReady) {
      setDataError('Supabase가 설정되지 않았어요.')
      return
    }
    setCreating(true)
    setCreateCardError('')
    setDataError('')
    try {
      const supabase = getSupabaseClient()

      // 직전 카드에서 내용만 복사, 금액은 0원
      let rows: TableRow[]
      const sameModeCards = cards.filter((c) => c.include_negatives === includeNegatives)
      if (sameModeCards.length > 0) {
        const prevCard = pickLatestCard(sameModeCards) ?? sameModeCards[0]
        rows = prevCard.rows.map((r) => ({
          id: genId(),
          content: r.content,
          amount: 0,
          checked: false,
          sort_order: r.sort_order,
        }))
      } else {
        rows = makeDefaultRows(10)
      }

      const createdAt = new Date().toISOString()

      if (includeNegatives) {
        // 신규 카드만 pair_id로 A↔B 연결 (select 없이 insert — RLS로 인한 단독 A 생성 방지)
        const pairId = genId()
        const bRows = rows.map((r) => ({
          id: genId(),
          content: r.content,
          amount: 0,
          checked: false,
          sort_order: r.sort_order,
        }))

        const { error: aError } = await supabase.from('nest_egg_cards').insert({
          name,
          rows,
          manual_total: null,
          include_negatives: true,
          pair_id: pairId,
          minus_rows: [],
          created_at: createdAt,
        })
        if (aError) throw aError

        const { error: bError } = await supabase.from('nest_egg_cards').insert({
          name,
          rows: bRows,
          manual_total: null,
          include_negatives: false,
          pair_id: pairId,
          minus_rows: makeDefaultRows(3),
          created_at: createdAt,
        })
        if (bError) {
          // B 실패 시 고아 A 제거 시도
          await supabase.from('nest_egg_cards').delete().eq('pair_id', pairId)
          throw bError
        }
      } else {
        const { error } = await supabase.from('nest_egg_cards').insert({
          name,
          rows,
          manual_total: null,
          include_negatives: false,
          pair_id: null,
          minus_rows: [],
          created_at: createdAt,
        })
        if (error) throw error
      }

      await loadCards()
      setShowCreateModal(false)
      setNewCardName('')
      showToast(
        includeNegatives
          ? `'${name}' 카드를 A·B에 만들었어요`
          : `'${name}' 카드를 만들었어요`,
      )
    } catch (err) {
      console.error('카드 생성 오류:', err)
      const msg = getErrorMessage(err)
      setCreateCardError(msg)
      showToast(msg)
    } finally {
      setCreating(false)
    }
  }

  async function handleRenameCardSubmit(e: React.FormEvent) {
    e.preventDefault()
    const nextName = renameValue.trim()
    if (!renameCardId) return
    if (!nextName) {
      setRenameError('카드 이름을 입력해 주세요.')
      return
    }
    if (!supabaseReady) {
      setRenameError('Supabase가 설정되지 않았어요.')
      return
    }
    setRenaming(true)
    setRenameError('')
    try {
      const supabase = getSupabaseClient()
      const target = cards.find((c) => c.id === renameCardId)
      const { error } = await supabase.from('nest_egg_cards').update({ name: nextName }).eq('id', renameCardId)
      if (error) throw error

      // 신규 페어: A 이름 변경 시 B에도 동기화
      if (target && isPairedA(target) && target.pair_id) {
        const { error: syncError } = await supabase
          .from('nest_egg_cards')
          .update({ name: nextName })
          .eq('pair_id', target.pair_id)
          .eq('include_negatives', false)
        if (syncError) throw syncError
      }

      await loadCards()
      setShowRenameModal(false)
      setRenameCardId(null)
      setRenameValue('')
      showToast('카드 이름을 수정했어요')
    } catch (err) {
      const msg = getErrorMessage(err)
      setRenameError(msg)
      showToast(msg)
    } finally {
      setRenaming(false)
    }
  }

  // ── delete card ───────────────────────────────────────────────────────────

  async function handleDeleteCard(e: React.MouseEvent, cardId: string, cardName: string) {
    e.stopPropagation()
    const yes = await askConfirm('카드 삭제', `'${cardName}' 카드를 삭제할까요? 이 작업은 되돌릴 수 없어요.`)
    if (!yes) return
    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('nest_egg_cards').delete().eq('id', cardId)
      if (error) throw error
      setCards((prev) => prev.filter((c) => c.id !== cardId))
      if (selectedCard?.id === cardId) {
        setSelectedCard(null)
        setView('main')
      }
      showToast('카드를 삭제했어요')
    } catch (err) {
      console.error('카드 삭제 오류:', err)
    }
  }

  // ── open detail ───────────────────────────────────────────────────────────

  function openDetail(card: NestEggCard) {
    setSelectedCard(card)
    setSelectedRowId(null)
    setSelectedSection(isPairedB(card) ? 'minus' : 'main')
    setEditingAmountRowId(null)
    setAmountDraft(null)
    setEditingTotal(false)
    setTotalDraft(null)
    setView('detail')
    window.scrollTo(0, 0)
  }

  function goBack() {
    setView('main')
    setSelectedCard(null)
    setSelectedRowId(null)
    setSelectedSection('main')
    setEditingAmountRowId(null)
    setAmountDraft(null)
    setEditingTotal(false)
    setTotalDraft(null)
  }

  function clearModeTimers() {
    if (modeTimers.current.out) clearTimeout(modeTimers.current.out)
    if (modeTimers.current.inn) clearTimeout(modeTimers.current.inn)
    modeTimers.current = {}
  }

  function transitionHomeMode(next: HomeMode) {
    if (next === homeMode) {
      goBack()
      window.scrollTo(0, 0)
      return
    }
    if (modeBusy.current) return
    modeBusy.current = true
    clearModeTimers()
    setModeDir(next === 'B' ? 'forward' : 'back')
    setModeSlide('out')
    goBack()
    modeTimers.current.out = setTimeout(() => {
      setHomeMode(next)
      window.localStorage.setItem(HOME_MODE_STORAGE_KEY, next)
      setModeSlide('in')
      window.scrollTo(0, 0)
      modeTimers.current.inn = setTimeout(() => {
        setModeSlide('idle')
        modeBusy.current = false
      }, 300)
    }, 180)
  }

  function goHome() {
    transitionHomeMode('A')
  }

  // ── save rows (debounced) ─────────────────────────────────────────────────

  /** 신규 페어: A 기본 내역을 B에 반영 (마이너스 내역은 유지) */
  const syncPairBFromA = useCallback(async (aCard: NestEggCard) => {
    if (!isPairedA(aCard) || !aCard.pair_id) return
    try {
      const supabase = getSupabaseClient()
      const { data: bList, error: findError } = await supabase
        .from('nest_egg_cards')
        .select('id, rows')
        .eq('pair_id', aCard.pair_id)
        .eq('include_negatives', false)
        .limit(1)
      if (findError) throw findError
      const bCard = bList?.[0]
      if (!bCard) return

      const syncedRows = syncRowsPreserveIds(aCard.rows, (bCard.rows as TableRow[]) ?? [])
      const { error: updateError } = await supabase
        .from('nest_egg_cards')
        .update({
          name: aCard.name,
          rows: syncedRows,
          manual_total: aCard.manual_total,
        })
        .eq('id', bCard.id)
      if (updateError) throw updateError

      setCards((prev) =>
        prev.map((c) =>
          c.id === bCard.id
            ? { ...c, name: aCard.name, rows: syncedRows, manual_total: aCard.manual_total }
            : c,
        ),
      )
      setSelectedCard((prev) =>
        prev && prev.id === bCard.id
          ? { ...prev, name: aCard.name, rows: syncedRows, manual_total: aCard.manual_total }
          : prev,
      )
    } catch (err) {
      console.error('A→B 동기화 오류:', err)
    }
  }, [])

  const scheduleRowSave = useCallback((card: NestEggCard) => {
    const json = JSON.stringify({
      rows: card.rows,
      manual_total: card.manual_total,
      minus_rows: card.minus_rows,
      name: card.name,
    })
    if (json === lastSavedJson.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      lastSavedJson.current = json
      try {
        const supabase = getSupabaseClient()
        const { error } = await supabase
          .from('nest_egg_cards')
          .update({
            rows: card.rows,
            manual_total: card.manual_total,
            minus_rows: card.minus_rows ?? [],
          })
          .eq('id', card.id)
        if (error) throw error

        if (isPairedA(card)) {
          await syncPairBFromA(card)
        }
      } catch (err) {
        console.error('저장 오류:', err)
      }
    }, 600)
  }, [syncPairBFromA])

  // ── update selected card rows ─────────────────────────────────────────────

  function updateCard(updater: (card: NestEggCard) => NestEggCard) {
    if (!selectedCard) return
    const updated = updater(selectedCard)
    setSelectedCard(updated)
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    scheduleRowSave(updated)
  }

  function getSectionRows(card: NestEggCard, section: 'main' | 'minus') {
    return section === 'minus' ? (card.minus_rows ?? []) : card.rows
  }

  function setSectionRows(card: NestEggCard, section: 'main' | 'minus', rows: TableRow[]): NestEggCard {
    if (section === 'minus') return { ...card, minus_rows: rows }
    return { ...card, rows }
  }

  // ── row operations ────────────────────────────────────────────────────────

  function updateRow(
    rowId: string,
    field: keyof TableRow,
    value: string | number | boolean,
    section: 'main' | 'minus' = 'main',
  ) {
    if (section === 'main' && selectedCard && isPairedB(selectedCard)) return
    updateCard((card) => {
      const rows = getSectionRows(card, section).map((r) =>
        r.id === rowId ? { ...r, [field]: value } : r,
      )
      return setSectionRows(card, section, rows)
    })
  }

  function addRow() {
    const targetSection = selectedCard && isPairedB(selectedCard) ? 'minus' : 'main'
    updateCard((card) => {
      const rows = getSectionRows(card, targetSection)
      const maxOrder = rows.reduce((m, r) => Math.max(m, r.sort_order), -1)
      const newRow: TableRow = {
        id: genId(),
        content: '',
        amount: 0,
        checked: false,
        sort_order: maxOrder + 1,
      }
      return setSectionRows(card, targetSection, [...rows, newRow])
    })
    setSelectedSection(targetSection)
  }

  function moveRowUp() {
    if (!selectedRowId || !selectedCard) return
    if (isPairedB(selectedCard) && selectedSection === 'main') return
    const section = selectedSection
    updateCard((card) => {
      const rows = [...getSectionRows(card, section)].sort((a, b) => a.sort_order - b.sort_order)
      const idx = rows.findIndex((r) => r.id === selectedRowId)
      if (idx <= 0) return card
      const newRows = [...rows]
      ;[newRows[idx - 1], newRows[idx]] = [newRows[idx], newRows[idx - 1]]
      return setSectionRows(
        card,
        section,
        newRows.map((r, i) => ({ ...r, sort_order: i })),
      )
    })
  }

  function moveRowDown() {
    if (!selectedRowId || !selectedCard) return
    if (isPairedB(selectedCard) && selectedSection === 'main') return
    const section = selectedSection
    updateCard((card) => {
      const rows = [...getSectionRows(card, section)].sort((a, b) => a.sort_order - b.sort_order)
      const idx = rows.findIndex((r) => r.id === selectedRowId)
      if (idx < 0 || idx >= rows.length - 1) return card
      const newRows = [...rows]
      ;[newRows[idx], newRows[idx + 1]] = [newRows[idx + 1], newRows[idx]]
      return setSectionRows(
        card,
        section,
        newRows.map((r, i) => ({ ...r, sort_order: i })),
      )
    })
  }

  async function deleteSelectedRow() {
    if (!selectedRowId || !selectedCard) return
    if (isPairedB(selectedCard) && selectedSection === 'main') {
      showToast('기본 내역은 A에서 수정해 주세요')
      return
    }
    const section = selectedSection
    const rows = getSectionRows(selectedCard, section)
    if (rows.length <= 1) {
      showToast('마지막 행은 삭제할 수 없어요')
      return
    }
    const yes = await askConfirm('행 삭제', '선택한 행을 삭제할까요?')
    if (!yes) return
    updateCard((card) => {
      const next = getSectionRows(card, section)
        .filter((r) => r.id !== selectedRowId)
        .map((r, i) => ({ ...r, sort_order: i }))
      return setSectionRows(card, section, next)
    })
    setSelectedRowId(null)
  }

  function handleTotalDraftChange(raw: string) {
    const sanitized = sanitizeAmountInput(raw)
    setTotalDraft(sanitized)
    if (sanitized.replace(/,/g, '').trim() === '') {
      updateCard((card) => ({ ...card, manual_total: null }))
      return
    }
    const n = parseAmountInput(sanitized)
    if (n !== null) {
      updateCard((card) => ({ ...card, manual_total: n }))
    }
  }

  function commitTotalDraft() {
    const cleaned = (totalDraft ?? '').replace(/,/g, '').trim()
    if (cleaned === '' || cleaned === '-') {
      updateCard((card) => ({ ...card, manual_total: null }))
    } else {
      const n = parseAmountInput(totalDraft ?? '')
      if (n !== null) {
        updateCard((card) => ({ ...card, manual_total: n }))
      }
    }
    setEditingTotal(false)
    setTotalDraft(null)
  }

  // ── enter key moves focus ─────────────────────────────────────────────────

  function handleEnterMove(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowId: string,
    col: 'content' | 'amount',
    section: 'main' | 'minus' = 'main',
  ) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!selectedCard) return
    const sorted = [...getSectionRows(selectedCard, section)].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex((r) => r.id === rowId)
    const next = sorted[idx + 1]
    if (next) {
      const nextInput = document.querySelector<HTMLInputElement>(
        `[data-row-id="${next.id}"][data-col="${col}"]`,
      )
      nextInput?.focus()
    }
  }

  // ── loading / auth gate ───────────────────────────────────────────────────

  if (!isSupabaseConfigured()) {
    return (
      <div className="auth-shell">
        <div className="pin-card">
          <div className="app-badge">
            <img src="/nest-egg-icon-clear.png?v=2" alt="" className="app-badge-img" />
            <span>Nest Egg</span>
          </div>
          <section className="notice-card" style={{ margin: 0, border: '1px solid #fed7aa', background: '#fff7ed' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Supabase 연결이 필요해요</h2>
            <p style={{ margin: 0, color: '#78350f', fontSize: '0.92rem' }}>
              `.env`에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 넣은 뒤 다시 실행해 주세요.
            </p>
          </section>
        </div>
      </div>
    )
  }

  if (isCheckingAuth) {
    return (
      <div className="auth-shell">
        <div className="pin-card">
          <p className="pin-subtitle">Nest Egg를 준비하는 중...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-shell">
        <form className="pin-card" onSubmit={handlePinSubmit}>
          {isChangingPin ? (
            <>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)' }}>PIN 변경하기</h1>
              <div className="pin-change-panel">
                <label className="field">
                  <span>현재 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="현재 PIN"
                    value={currentPinInput}
                    onChange={(e) => handlePinDigits(setCurrentPinInput, e)}
                  />
                </label>
                <label className="field">
                  <span>새 PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="새 PIN"
                    value={newPinInput}
                    onChange={(e) => handlePinDigits(setNewPinInput, e)}
                  />
                </label>
                {pinChangeError ? <p className="error-text">{pinChangeError}</p> : null}
                <button type="button" className="secondary-button" onClick={() => void handlePinChangeSave()}>
                  PIN 저장
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setIsChangingPin(false)
                    setPinChangeError('')
                  }}
                >
                  로그인으로 돌아가기
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="app-badge">
                <img src="/nest-egg-icon-clear.png?v=2" alt="" className="app-badge-img" />
                <span>Nest Egg</span>
              </div>
              <div className="pin-entry-field">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="0000"
                  aria-label="4자리 숫자 입력"
                  value={pin}
                  onChange={handlePinChange}
                  className="pin-entry-input"
                />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                />
                <span>이 기기 기억하기</span>
              </label>
              {authError ? <p className="error-text">{authError}</p> : null}
              <button type="submit" className="primary-button">
                입장하기
              </button>
              <button
                type="button"
                className="text-button pin-change-button"
                onClick={() => {
                  setIsChangingPin(true)
                  setPinChangeError('')
                  setCurrentPinInput('')
                  setNewPinInput('')
                }}
              >
                PIN 변경하기
              </button>
            </>
          )}
        </form>
      </div>
    )
  }

  // ── detail view ───────────────────────────────────────────────────────────

  if (view === 'detail' && selectedCard) {
    const pairedB = isPairedB(selectedCard)
    const sortedRows = [...selectedCard.rows].sort((a, b) => a.sort_order - b.sort_order)
    const sortedMinusRows = [...(selectedCard.minus_rows ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    const baseTotal = cardBaseTotal(selectedCard)
    const minusTotal = computeTotal(selectedCard.minus_rows ?? [])
    const autoTotal = pairedB ? baseTotal + minusTotal : computeTotal(selectedCard.rows)
    const activeRows = pairedB && selectedSection === 'minus' ? sortedMinusRows : sortedRows
    const selectedIdx = activeRows.findIndex((r) => r.id === selectedRowId)
    const mainReadOnly = pairedB

    const renderDataRow = (row: TableRow, idx: number, section: 'main' | 'minus', readOnly: boolean) => (
      <div
        key={row.id}
        className={`excel-row${selectedRowId === row.id && selectedSection === section ? ' excel-row--selected' : ''}${readOnly ? ' excel-row--readonly' : ''}`}
        onClick={() => {
          setSelectedRowId(row.id)
          setSelectedSection(section)
        }}
      >
        <div className="excel-cell cell-check">
          <input
            type="checkbox"
            className={`row-check-input${idx === 0 ? ' row-check-input--center' : ''}`}
            checked={row.checked}
            disabled={readOnly}
            onChange={(e) => {
              setSelectedRowId(row.id)
              setSelectedSection(section)
              e.stopPropagation()
              updateRow(row.id, 'checked', e.target.checked, section)
            }}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => {
              setSelectedRowId(row.id)
              setSelectedSection(section)
            }}
          />
        </div>
        <div className="excel-cell cell-content">
          <input
            className="excel-input"
            type="text"
            value={row.content}
            placeholder="내용 입력"
            readOnly={readOnly}
            data-row-id={row.id}
            data-col="content"
            onChange={(e) => updateRow(row.id, 'content', e.target.value, section)}
            onKeyDown={(e) => handleEnterMove(e, row.id, 'content', section)}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => {
              setSelectedRowId(row.id)
              setSelectedSection(section)
            }}
          />
        </div>
        <div className="excel-cell cell-amount">
          <input
            className="excel-input excel-input--amount"
            type="text"
            inputMode="numeric"
            readOnly={readOnly}
            value={
              !readOnly && editingAmountRowId === row.id && amountDraft !== null
                ? amountDraft
                : formatAmountDisplay(row.amount)
            }
            placeholder="0"
            data-row-id={row.id}
            data-col="amount"
            onChange={(e) => {
              if (readOnly) return
              const sanitized = sanitizeAmountInput(e.target.value)
              setAmountDraft(sanitized)
              const n = parseAmountInput(sanitized)
              if (n !== null) updateRow(row.id, 'amount', n, section)
            }}
            onKeyDown={(e) => handleEnterMove(e, row.id, 'amount', section)}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => {
              setSelectedRowId(row.id)
              setSelectedSection(section)
              if (readOnly) return
              setEditingAmountRowId(row.id)
              setAmountDraft(row.amount === 0 ? '' : String(row.amount))
            }}
            onBlur={() => {
              if (readOnly) return
              if (editingAmountRowId === row.id) {
                const n = parseAmountInput(amountDraft ?? '')
                updateRow(row.id, 'amount', n ?? 0, section)
                setAmountDraft(null)
                setEditingAmountRowId(null)
              }
            }}
          />
        </div>
      </div>
    )

    return (
      <div className={`app-shell${homeMode === 'B' ? ' app-shell--mode-b' : ''}`}>
        {confirmState && (
          <ConfirmDialog
            title={confirmState.title}
            message={confirmState.message}
            onConfirm={() => handleConfirmAnswer(true)}
            onCancel={() => handleConfirmAnswer(false)}
          />
        )}
        {(toastMsg || statusMessage) ? (
          <div className="toast-message">{toastMsg || statusMessage}</div>
        ) : null}

        <header className="topbar topbar--detail">
          <button type="button" className="app-icon app-icon--home app-icon--image" aria-label="홈" title="홈" onClick={goHome}>
            <img src="/nest-egg-icon-clear.png?v=2" alt="" className="app-icon-img" />
          </button>
          <div className="detail-topbar-center">
            <h1>{selectedCard.name}</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" className="list-view-button" onClick={goBack}>
              목록보기
            </button>
            <button type="button" className="secondary-button lock-button" aria-label="잠금" onClick={handleLock}>
              <LockIcon />
            </button>
          </div>
        </header>

        {!supabaseReady ? (
          <section className="notice-card">
            <h2>Supabase 연결이 필요해요</h2>
            <p>`.env`에 URL, Anon Key, PIN 값을 넣은 뒤 다시 실행해 주세요.</p>
          </section>
        ) : null}

        {dataError ? (
          <section className="notice-card" style={{ borderColor: 'rgba(239, 68, 68, 0.18)' }}>
            <h2>처리 중 문제가 생겼어요</h2>
            <p>{dataError}</p>
          </section>
        ) : null}

        {pairedB ? (
          <div className="detail-tables">
            <div className="table-card table-card--section">
              <div className="section-label">기본 내역</div>
              <div className="excel-wrap">
                <div className="excel-row excel-header">
                  <div className="excel-cell cell-check">
                    <span className="header-cell-text header-cell-text--center">✓</span>
                  </div>
                  <div className="excel-cell cell-content">
                    <span className="header-cell-text header-cell-text--center">내용</span>
                  </div>
                  <div className="excel-cell cell-amount">
                    <span className="header-cell-text" style={{ width: '100%', textAlign: 'right', paddingRight: 4 }}>금액</span>
                  </div>
                </div>
                {sortedRows.map((row, idx) => renderDataRow(row, idx, 'main', mainReadOnly))}
                <div className="excel-row excel-row--total">
                  <div className="excel-cell cell-check" />
                  <div className="excel-cell cell-content">
                    <span className="total-label">소계</span>
                  </div>
                  <div className="excel-cell cell-amount">
                    <span className="total-amount-readonly">{formatAmount(baseTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="table-card table-card--section table-card--minus">
              <div className="section-label section-label--minus">마이너스 내역</div>
              <div className="excel-wrap excel-wrap--minus">
                <div className="excel-row excel-header">
                  <div className="excel-cell cell-check">
                    <span className="header-cell-text header-cell-text--center">✓</span>
                  </div>
                  <div className="excel-cell cell-content">
                    <span className="header-cell-text header-cell-text--center">내용</span>
                  </div>
                  <div className="excel-cell cell-amount">
                    <span className="header-cell-text" style={{ width: '100%', textAlign: 'right', paddingRight: 4 }}>금액</span>
                  </div>
                </div>
                {sortedMinusRows.map((row, idx) => renderDataRow(row, idx, 'minus', false))}
                <div className="excel-row excel-row--total">
                  <div className="excel-cell cell-check" />
                  <div className="excel-cell cell-content">
                    <span className="total-label">합계</span>
                  </div>
                  <div className="excel-cell cell-amount">
                    <span className="total-amount-readonly">{formatAmount(minusTotal)}</span>
                  </div>
                </div>
              </div>

              <div className="table-footer">
                <div className="row-actions">
                  <button
                    className="icon-chip"
                    title="위로 이동"
                    onClick={moveRowUp}
                    disabled={!selectedRowId || selectedIdx <= 0 || selectedSection === 'main'}
                  >
                    <IconArrowUp />
                  </button>
                  <button
                    className="icon-chip"
                    title="아래로 이동"
                    onClick={moveRowDown}
                    disabled={
                      !selectedRowId
                      || selectedIdx < 0
                      || selectedIdx >= activeRows.length - 1
                      || selectedSection === 'main'
                    }
                  >
                    <IconArrowDown />
                  </button>
                  <button
                    className="icon-chip icon-chip--danger"
                    title="행 삭제"
                    onClick={deleteSelectedRow}
                    disabled={!selectedRowId || selectedSection === 'main'}
                  >
                    <IconTrash />
                  </button>
                </div>
                <button className="add-row-btn" onClick={addRow}>
                  <IconPlus /> 행 추가
                </button>
              </div>
            </div>

            <div className="grand-total-card" title={`기본 ${formatAmount(baseTotal)} + 마이너스 ${formatAmount(minusTotal)}`}>
              <span className="grand-total-label">총합</span>
              <span className="grand-total-amount">{formatAmount(autoTotal)}원</span>
            </div>
          </div>
        ) : (
          <div className="table-card">
            <div className="excel-wrap">
              <div className="excel-row excel-header">
                <div className="excel-cell cell-check">
                  <span className="header-cell-text header-cell-text--center">✓</span>
                </div>
                <div className="excel-cell cell-content">
                  <span className="header-cell-text header-cell-text--center">내용</span>
                </div>
                <div className="excel-cell cell-amount">
                  <span className="header-cell-text" style={{ width: '100%', textAlign: 'right', paddingRight: 4 }}>금액</span>
                </div>
              </div>

              {sortedRows.map((row, idx) => renderDataRow(row, idx, 'main', mainReadOnly))}

              <div className="excel-row excel-row--total">
                <div className="excel-cell cell-check" />
                <div className="excel-cell cell-content">
                  <span className="total-label">합계</span>
                </div>
                <div className="excel-cell cell-amount">
                  <input
                    className="total-amount-input"
                    type="text"
                    inputMode="numeric"
                    value={
                      editingTotal && totalDraft !== null
                        ? totalDraft
                        : selectedCard.manual_total !== null
                          ? formatAmount(selectedCard.manual_total)
                          : formatAmount(autoTotal)
                    }
                    placeholder={formatAmount(autoTotal)}
                    onChange={(e) => handleTotalDraftChange(e.target.value)}
                    onFocus={() => {
                      setEditingTotal(true)
                      const base = selectedCard.manual_total !== null
                        ? selectedCard.manual_total
                        : autoTotal
                      setTotalDraft(base === 0 ? '' : String(base))
                    }}
                    onBlur={commitTotalDraft}
                    title={`자동 계산: ${formatAmount(autoTotal)}원 / 직접 입력 가능`}
                  />
                </div>
              </div>
            </div>

            <div className="table-footer">
              <div className="row-actions">
                <button
                  className="icon-chip"
                  title="위로 이동"
                  onClick={moveRowUp}
                  disabled={!selectedRowId || selectedIdx <= 0}
                >
                  <IconArrowUp />
                </button>
                <button
                  className="icon-chip"
                  title="아래로 이동"
                  onClick={moveRowDown}
                  disabled={!selectedRowId || selectedIdx < 0 || selectedIdx >= activeRows.length - 1}
                >
                  <IconArrowDown />
                </button>
                <button
                  className="icon-chip icon-chip--danger"
                  title="행 삭제"
                  onClick={deleteSelectedRow}
                  disabled={!selectedRowId}
                >
                  <IconTrash />
                </button>
              </div>
              <button className="add-row-btn" onClick={addRow}>
                <IconPlus /> 행 추가
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── main view ─────────────────────────────────────────────────────────────

  const displayTotal = (card: NestEggCard) => cardDisplayTotal(card)

  function toggleHomeMode() {
    transitionHomeMode(homeMode === 'A' ? 'B' : 'A')
  }

  const visibleCards = cards.filter((c) => c.include_negatives === includeNegatives)

  const sortedCardsLatest = (() => {
    const list = [...visibleCards]
    list.sort((a, b) => {
      const aCreated = new Date((a as any).created_at ?? 0).getTime()
      const bCreated = new Date((b as any).created_at ?? 0).getTime()
      if (aCreated && bCreated && aCreated !== bCreated) return bCreated - aCreated
      return 0
    })
    return list
  })()

  return (
    <div className={`app-shell${homeMode === 'B' ? ' app-shell--mode-b' : ''}`}>
      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          onConfirm={() => handleConfirmAnswer(true)}
          onCancel={() => handleConfirmAnswer(false)}
        />
      )}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowCreateModal(false)
            setCreateCardError('')
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">새 카드 만들기</h2>
            <form onSubmit={handleCreateCard} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label htmlFor="card-name">카드 이름</label>
                <input
                  id="card-name"
                  type="text"
                  value={newCardName}
                  onChange={(e) => {
                    setNewCardName(e.target.value)
                    if (createCardError) setCreateCardError('')
                  }}
                  autoFocus
                  required
                />
              </div>
              {createCardError ? <p className="error-text">{createCardError}</p> : null}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setCreateCardError('')
                  }}
                >
                  취소
                </button>
                <button type="submit" className="primary-button" disabled={creating || !newCardName.trim()}>
                  {creating ? '만드는 중...' : '만들기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRenameModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowRenameModal(false)
            setRenameError('')
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">카드 이름 수정</h2>
            <form onSubmit={handleRenameCardSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label htmlFor="rename-card-name">카드 이름</label>
                <input
                  id="rename-card-name"
                  type="text"
                  value={renameValue}
                  onChange={(e) => {
                    setRenameValue(e.target.value)
                    if (renameError) setRenameError('')
                  }}
                  autoFocus
                  required
                />
              </div>
              {renameError ? <p className="error-text">{renameError}</p> : null}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setShowRenameModal(false)
                    setRenameError('')
                  }}
                >
                  취소
                </button>
                <button type="submit" className="primary-button" disabled={renaming || !renameValue.trim()}>
                  {renaming ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(toastMsg || statusMessage) ? (
        <div className="toast-message">{toastMsg || statusMessage}</div>
      ) : null}

      <header className="topbar">
        <div className="topbar-left">
          <button type="button" className="topbar-title topbar-title--home" aria-label="홈" title="홈" onClick={goHome}>
            <span className="app-icon app-icon--home app-icon--image">
              <img src="/nest-egg-icon-clear.png?v=2" alt="" className="app-icon-img" />
            </span>
            <div className="topbar-title-text">
              <h1>Nest Egg</h1>
              <p className="mode-label">{homeMode === 'A' ? '투자 자산' : '마이너스 포함'}</p>
            </div>
          </button>
        </div>
        <div className="topbar-actions topbar-actions--stack">
          <button type="button" className="secondary-button lock-button" aria-label="잠금" onClick={handleLock}>
            <LockIcon />
          </button>
          <button
            type="button"
            className={`mode-switch${homeMode === 'B' ? ' mode-switch--on' : ''}`}
            role="switch"
            aria-checked={homeMode === 'B'}
            aria-label={homeMode === 'A' ? '투자 자산 — 마이너스 포함으로 전환' : '마이너스 포함 — 투자 자산으로 전환'}
            title={homeMode === 'A' ? '마이너스 포함으로 전환' : '투자 자산으로 전환'}
            onClick={toggleHomeMode}
          >
            <span className="mode-switch-track" aria-hidden="true">
              <span className="mode-switch-thumb" />
            </span>
          </button>
        </div>
      </header>

      {!supabaseReady ? (
        <section className="notice-card">
          <h2>Supabase 연결이 필요해요</h2>
          <p>`.env`에 URL, Anon Key, PIN 값을 넣은 뒤 다시 실행해 주세요.</p>
        </section>
      ) : null}

      {dataError ? (
        <section className="notice-card" style={{ borderColor: 'rgba(239, 68, 68, 0.18)' }}>
          <h2>처리 중 문제가 생겼어요</h2>
          <p>{dataError}</p>
        </section>
      ) : null}

      {loadingCards ? (
        <div style={{ textAlign: 'center', color: 'var(--pink-mid)', padding: '40px 0', fontWeight: 600 }}>
          불러오는 중...
        </div>
      ) : (
        <div
          key={homeMode}
          className={`mode-stage mode-stage--${modeDir}${modeSlide !== 'idle' ? ` mode-stage--${modeSlide}` : ''}`}
        >
          {visibleCards.length === 0 ? (
            <div className="empty-state">
              <div className="empty-illustration"><IconEgg /></div>
              <h2>카드가 없어요</h2>
              <p>
                {homeMode === 'A'
                  ? '오른쪽 아래 + 버튼을 눌러 첫 카드를 만들어 보세요'
                  : '마이너스 미포함 내역이 비어 있어요. + 버튼으로 카드를 만들어 보세요'}
              </p>
            </div>
          ) : (
            <div className="card-list">
              {sortedCardsLatest.map((card, i) => {
                const total = displayTotal(card)
                const prevYear = i > 0 ? extractYear(sortedCardsLatest[i - 1]?.name ?? '') : null
                const year = extractYear(card.name)
                const showYearGap = i > 0 && year !== null && prevYear !== null && year !== prevYear
                return (
                  <div key={card.id}>
                    {showYearGap ? <div className="year-gap" aria-hidden="true" /> : null}
                    <div
                      className={`summary-card${i === 0 ? ' summary-card--latest' : ''}`}
                      onClick={() => openDetail(card)}
                    >
                      <div className="card-header">
                        <p className="card-name">{card.name}</p>
                        <span className="card-amount">{formatAmount(total)}원</span>
                        <button
                          className="card-edit-btn"
                          title="카드 이름 수정"
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenameCardId(card.id)
                            setRenameValue(card.name ?? '')
                            setRenameError('')
                            setShowRenameModal(true)
                          }}
                        >
                          <IconEdit />
                        </button>
                        <button
                          className="card-delete-btn"
                          title="카드 삭제"
                          onClick={(e) => handleDeleteCard(e, card.id, card.name)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <button
        className="fab"
        onClick={() => {
          setNewCardName('')
          setCreateCardError('')
          setShowCreateModal(true)
        }}
        title="새 카드 만들기"
      >
        <IconPlus />
      </button>
    </div>
  )
}
