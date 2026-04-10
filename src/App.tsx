import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { getSupabaseClient, isSupabaseConfigured, type NestEggCard, type TableRow } from './lib/supabase'
import { hashPin } from './lib/pin'

const AUTH_STORAGE_KEY = 'nest-egg.remembered-auth'
const PIN_HASH_STORAGE_KEY = 'nest-egg.pin-hash'
const DEFAULT_PIN = '1234'
const SETTINGS_ROW_ID = 'global'

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
  return msg
}

function genId() {
  return crypto.randomUUID()
}

function formatAmount(n: number): string {
  return n.toLocaleString('ko-KR')
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

// ─── icons ──────────────────────────────────────────────────────────────────

function IconEgg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C8.5 2 5 6.5 5 12c0 3.87 3.13 7 7 7s7-3.13 7-7c0-5.5-3.5-10-7-10z" />
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

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
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
          <button className="primary-button" style={{ background: '#dc2626', boxShadow: 'none' }} onClick={onConfirm}>삭제</button>
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

  // confirm dialog
  const [confirmState, setConfirmState] = useState<{
    title: string; message: string; resolve: (v: boolean) => void
  } | null>(null)

  // detail: selected row
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)

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
      setCards((data as NestEggCard[]) ?? [])
    } catch (err) {
      setDataError(getErrorMessage(err))
      console.error('카드 로딩 오류:', err)
    } finally {
      setLoadingCards(false)
    }
  }, [supabaseReady])

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

      // Copy content from the most recent card if exists (keep col2, clear col3)
      let rows: TableRow[]
      if (cards.length > 0) {
        const prevCard = cards[0] // newest first
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

      const { error } = await supabase.from('nest_egg_cards').insert({ name, rows, manual_total: null })
      if (error) throw error

      await loadCards()
      setShowCreateModal(false)
      setNewCardName('')
      showToast(`'${name}' 카드를 만들었어요`)
    } catch (err) {
      console.error('카드 생성 오류:', err)
      const msg = getErrorMessage(err)
      setCreateCardError(msg)
      showToast(msg)
    } finally {
      setCreating(false)
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
    setView('detail')
    window.scrollTo(0, 0)
  }

  function goBack() {
    setView('main')
    setSelectedCard(null)
    setSelectedRowId(null)
  }

  // ── save rows (debounced) ─────────────────────────────────────────────────

  const scheduleRowSave = useCallback((card: NestEggCard) => {
    const json = JSON.stringify({ rows: card.rows, manual_total: card.manual_total })
    if (json === lastSavedJson.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      lastSavedJson.current = json
      try {
        const supabase = getSupabaseClient()
        await supabase
          .from('nest_egg_cards')
          .update({ rows: card.rows, manual_total: card.manual_total })
          .eq('id', card.id)
      } catch (err) {
        console.error('저장 오류:', err)
      }
    }, 600)
  }, [])

  // ── update selected card rows ─────────────────────────────────────────────

  function updateCard(updater: (card: NestEggCard) => NestEggCard) {
    if (!selectedCard) return
    const updated = updater(selectedCard)
    setSelectedCard(updated)
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    scheduleRowSave(updated)
  }

  // ── row operations ────────────────────────────────────────────────────────

  function updateRow(rowId: string, field: keyof TableRow, value: string | number | boolean) {
    updateCard((card) => ({
      ...card,
      rows: card.rows.map((r) =>
        r.id === rowId ? { ...r, [field]: value } : r
      ),
    }))
  }

  function addRow() {
    updateCard((card) => {
      const maxOrder = card.rows.reduce((m, r) => Math.max(m, r.sort_order), -1)
      const newRow: TableRow = {
        id: genId(),
        content: '',
        amount: 0,
        checked: false,
        sort_order: maxOrder + 1,
      }
      return { ...card, rows: [...card.rows, newRow] }
    })
  }

  function moveRowUp() {
    if (!selectedRowId) return
    updateCard((card) => {
      const rows = [...card.rows].sort((a, b) => a.sort_order - b.sort_order)
      const idx = rows.findIndex((r) => r.id === selectedRowId)
      if (idx <= 0) return card
      const newRows = [...rows]
      ;[newRows[idx - 1], newRows[idx]] = [newRows[idx], newRows[idx - 1]]
      return {
        ...card,
        rows: newRows.map((r, i) => ({ ...r, sort_order: i })),
      }
    })
  }

  function moveRowDown() {
    if (!selectedRowId) return
    updateCard((card) => {
      const rows = [...card.rows].sort((a, b) => a.sort_order - b.sort_order)
      const idx = rows.findIndex((r) => r.id === selectedRowId)
      if (idx < 0 || idx >= rows.length - 1) return card
      const newRows = [...rows]
      ;[newRows[idx], newRows[idx + 1]] = [newRows[idx + 1], newRows[idx]]
      return {
        ...card,
        rows: newRows.map((r, i) => ({ ...r, sort_order: i })),
      }
    })
  }

  async function deleteSelectedRow() {
    if (!selectedRowId || !selectedCard) return
    if (selectedCard.rows.length <= 1) {
      showToast('마지막 행은 삭제할 수 없어요')
      return
    }
    const yes = await askConfirm('행 삭제', '선택한 행을 삭제할까요?')
    if (!yes) return
    updateCard((card) => {
      const rows = card.rows
        .filter((r) => r.id !== selectedRowId)
        .map((r, i) => ({ ...r, sort_order: i }))
      return { ...card, rows }
    })
    setSelectedRowId(null)
  }

  function handleTotalInput(raw: string) {
    if (raw.trim() === '') {
      updateCard((card) => ({ ...card, manual_total: null }))
      return
    }
    const n = parseFloat(raw.replace(/,/g, ''))
    if (!isNaN(n)) {
      updateCard((card) => ({ ...card, manual_total: n }))
    }
  }

  // ── enter key moves focus ─────────────────────────────────────────────────

  function handleEnterMove(e: React.KeyboardEvent<HTMLInputElement>, rowId: string, col: 'content' | 'amount') {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!selectedCard) return
    const sorted = [...selectedCard.rows].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex((r) => r.id === rowId)
    const next = sorted[idx + 1]
    if (next) {
      const nextInput = document.querySelector<HTMLInputElement>(
        `[data-row-id="${next.id}"][data-col="${col}"]`
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
            <IconEgg />
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
                <IconEgg />
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
    const sortedRows = [...selectedCard.rows].sort((a, b) => a.sort_order - b.sort_order)
    const autoTotal = computeTotal(selectedCard.rows)
    const selectedIdx = sortedRows.findIndex((r) => r.id === selectedRowId)

    return (
      <div className="app-shell">
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

        <header className="topbar">
          <button type="button" className="back-button" onClick={goBack}>
            <IconChevronLeft /> 뒤로
          </button>
          <div className="detail-topbar-center">
            <h1>{selectedCard.name}</h1>
          </div>
          <div className="topbar-actions">
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

        <div className="table-card">
          <div className="excel-wrap">
            {/* header */}
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

            {/* data rows */}
            {sortedRows.map((row, idx) => (
              <div
                key={row.id}
                className={`excel-row${selectedRowId === row.id ? ' excel-row--selected' : ''}`}
                onClick={() => setSelectedRowId(row.id)}
              >
                <div className="excel-cell cell-check">
                  <input
                    type="checkbox"
                    className={`row-check-input${idx === 0 ? ' row-check-input--center' : ''}`}
                    checked={row.checked}
                    onChange={(e) => {
                      setSelectedRowId(row.id)
                      e.stopPropagation()
                      updateRow(row.id, 'checked', e.target.checked)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setSelectedRowId(row.id)}
                  />
                </div>
                <div className="excel-cell cell-content">
                  <input
                    className="excel-input"
                    type="text"
                    value={row.content}
                    placeholder="내용 입력"
                    data-row-id={row.id}
                    data-col="content"
                    onChange={(e) => updateRow(row.id, 'content', e.target.value)}
                    onKeyDown={(e) => handleEnterMove(e, row.id, 'content')}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setSelectedRowId(row.id)}
                  />
                </div>
                <div className="excel-cell cell-amount">
                  <input
                    className="excel-input excel-input--amount"
                    type="number"
                    value={row.amount === 0 ? '' : row.amount}
                    placeholder="0"
                    data-row-id={row.id}
                    data-col="amount"
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : parseFloat(e.target.value)
                      updateRow(row.id, 'amount', isNaN(v) ? 0 : v)
                    }}
                    onKeyDown={(e) => handleEnterMove(e, row.id, 'amount')}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setSelectedRowId(row.id)}
                  />
                </div>
              </div>
            ))}

            {/* total row */}
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
                  value={selectedCard.manual_total !== null ? formatAmount(selectedCard.manual_total) : formatAmount(autoTotal)}
                  placeholder={formatAmount(autoTotal)}
                  onChange={(e) => handleTotalInput(e.target.value)}
                  onFocus={(e) => {
                    const raw = selectedCard.manual_total !== null
                      ? String(selectedCard.manual_total)
                      : String(autoTotal)
                    e.target.value = raw
                  }}
                  onBlur={(e) => {
                    if (e.target.value.trim() === '') {
                      updateCard((card) => ({ ...card, manual_total: null }))
                    }
                  }}
                  title={`자동 계산: ${formatAmount(autoTotal)}원 / 직접 입력 가능`}
                />
              </div>
            </div>
          </div>

          {/* footer actions */}
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
                disabled={!selectedRowId || selectedIdx < 0 || selectedIdx >= sortedRows.length - 1}
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

        <div style={{ marginTop: 12, fontSize: '0.8rem', color: '#c084a8', textAlign: 'center' }}>
          행을 클릭해서 선택 후 ↑↓ 이동 또는 삭제할 수 있어요 · 합계는 직접 입력도 가능해요
        </div>
      </div>
    )
  }

  // ── main view ─────────────────────────────────────────────────────────────

  const displayTotal = (card: NestEggCard) => {
    if (card.manual_total !== null) return card.manual_total
    return computeTotal(card.rows)
  }

  return (
    <div className="app-shell">
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

      {(toastMsg || statusMessage) ? (
        <div className="toast-message">{toastMsg || statusMessage}</div>
      ) : null}

      <header className="topbar">
        <div className="topbar-title">
          <div className="app-icon"><IconEgg /></div>
          <h1>Nest Egg</h1>
        </div>
        <div className="topbar-actions">
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

      {loadingCards ? (
        <div style={{ textAlign: 'center', color: 'var(--pink-mid)', padding: '40px 0', fontWeight: 600 }}>
          불러오는 중...
        </div>
      ) : cards.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illustration"><IconEgg /></div>
          <h2>카드가 없어요</h2>
          <p>오른쪽 아래 + 버튼을 눌러 첫 카드를 만들어 보세요</p>
        </div>
      ) : (
        <div className="card-list">
          {cards.map((card, i) => {
            const total = displayTotal(card)
            return (
              <div
                key={card.id}
                className={`summary-card${i === 0 ? ' summary-card--latest' : ''}`}
                onClick={() => openDetail(card)}
              >
                <div className="card-header">
                  <p className="card-name">{card.name}</p>
                  <span className="card-amount">{formatAmount(total)}원</span>
                  <button
                    className="card-delete-btn"
                    title="카드 삭제"
                    onClick={(e) => handleDeleteCard(e, card.id, card.name)}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            )
          })}
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
