import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useMeta } from '../meta.jsx';
import './chat.css';

const STORE = 'saath_chat_v1';
const MAX_LEN = 600;               // must match MAX_USER_CHARS in server/chat.js
const REQUEST_TIMEOUT_MS = 35_000; // a little longer than the server's own wait for Claude

const STARTERS = [
  'Mere AC se paani tapak raha hai',
  'मेरे RO का पानी कड़वा लग रहा है',
  'My sofa has a tea stain',
  'Pest control bachchon ke liye safe hai?',
  'Group booking kaise kaam karti hai?',
  'What are your service prices?',
];
const GREETING = {
  role: 'assistant',
  greeting: true, // shown on screen only, never sent to the server
  content: 'Hi! I am the Saath assistant. Tell me about a problem at home, like "AC se paani tapak raha hai", or ask about services, prices, group booking and payments. You can write in English, Hindi or Hinglish.',
};

// Shown under an answer when the built-in answers were used instead of Claude.
const NOTES = {
  busy: 'Quick answer mode: the AI assistant is busy right now.',
  timeout: 'Quick answer mode: the AI assistant was slow to reply.',
  unavailable: 'Quick answer mode: the AI assistant is not available right now.',
};

const VOICE_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type your question.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type your question.',
  'no-speech': "I didn't hear anything. Tap the microphone and try again, or type your question.",
  'audio-capture': 'No microphone was found. You can type your question instead.',
};

// Voice input only exists in some browsers (Chrome, Edge, Safari). Where it is missing, the mic button is hidden.
const SpeechRec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// The assistant is for residents. It stays out of the partner and admin areas.
const HIDDEN_PATHS = /^\/(partner|admin)(\/|$)/;

function loadSaved() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* ignore */ }
  return [GREETING];
}

export default function ChatWidget() {
  const { provider, admin } = useAuth();
  const { services } = useMeta();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(loadSaved);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');       // last request failed: shows a "Try again" button
  const [hint, setHint] = useState('');         // small message under the box (empty input, voice problems)
  const [listening, setListening] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const fabRef = useRef(null);
  const recRef = useRef(null);
  const abortRef = useRef(null);
  const chatId = useRef(0);          // changes on "New chat" so a late reply never lands in the new chat
  const returnFocus = useRef(false); // put keyboard focus back on the chat button after closing

  const hidden = Boolean(provider || admin) || HIDDEN_PATHS.test(pathname);

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ }
  }, [msgs]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy, error, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);
  useEffect(() => {
    if (!open && returnFocus.current) { returnFocus.current = false; fabRef.current?.focus(); }
  }, [open]);

  const close = (refocus = true) => {
    returnFocus.current = refocus;
    recRef.current?.stop();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entering a partner or admin page: stop anything running and close the panel.
  useEffect(() => {
    if (hidden) { abortRef.current?.abort(); recRef.current?.stop(); setOpen(false); }
  }, [hidden]);
  useEffect(() => () => { abortRef.current?.abort(); recRef.current?.stop(); }, []);

  if (hidden) return null;

  // Sends `list` (the whole conversation, ending with the person's question) to the server.
  const ask = async (list) => {
    abortRef.current?.abort();
    const id = ++chatId.current;
    const ctl = new AbortController();
    abortRef.current = ctl;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, REQUEST_TIMEOUT_MS);
    setBusy(true); setError('');
    try {
      const history = list.filter((m) => !m.greeting).map(({ role, content }) => ({ role, content }));
      const d = await api('/chat', { method: 'POST', body: { messages: history }, signal: ctl.signal });
      if (id !== chatId.current) return;
      setMsgs((m) => [...m, {
        role: 'assistant', content: d.reply, service: d.service || undefined,
        note: d.source === 'builtin' && d.reason ? NOTES[d.reason] || NOTES.unavailable : undefined,
      }]);
    } catch (e) {
      if (id !== chatId.current) return; // the chat was reset or closed meanwhile: ignore
      if (e?.name === 'AbortError') setError(timedOut ? 'The assistant is taking too long to answer.' : '');
      else setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      clearTimeout(timer);
      if (id === chatId.current) setBusy(false);
    }
  };

  const send = (raw) => {
    const q = (typeof raw === 'string' ? raw : text).trim();
    if (!q) { setHint('Type a message first.'); inputRef.current?.focus(); return; }
    if (busy) return;
    if (q.length > MAX_LEN) { setHint(`Please keep your message under ${MAX_LEN} characters.`); return; }
    recRef.current?.stop();
    const next = [...msgs, { role: 'user', content: q }];
    setMsgs(next); setText(''); setHint('');
    ask(next);
  };

  const retry = () => { if (!busy) ask(msgs); };

  const newChat = () => {
    abortRef.current?.abort();
    recRef.current?.stop();
    chatId.current += 1;
    setMsgs([GREETING]); setError(''); setBusy(false); setText(''); setHint('');
    inputRef.current?.focus();
  };

  const mic = () => {
    if (!SpeechRec) return;
    if (listening) { recRef.current?.stop(); return; }
    setHint('');
    let r;
    try { r = new SpeechRec(); } catch { setHint('Voice input is not available in this browser. Please type your question.'); return; }
    r.lang = 'hi-IN'; r.interimResults = false; r.maxAlternatives = 1; // understands Hindi, Hinglish and Indian English
    r.onresult = (e) => {
      const said = e.results?.[0]?.[0]?.transcript;
      if (said) setText((t) => `${t} ${said}`.trim().slice(0, MAX_LEN));
    };
    r.onerror = (e) => { setListening(false); setHint(VOICE_ERRORS[e.error] || 'Voice input did not work. You can type your question instead.'); };
    r.onend = () => setListening(false);
    recRef.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); setHint('Voice input could not start. Please type your question.'); }
  };

  const nameOf = (slug) => services.find((s) => s.slug === slug)?.name;
  const fresh = !msgs.some((m) => m.role === 'user');
  const nearLimit = text.length >= MAX_LEN - 100;

  return (
    <div className="chat-root">
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Saath assistant" aria-modal="false">
          <header className="chat-head">
            <span className="chat-avatar" aria-hidden="true">S</span>
            <div className="chat-title"><b>Saath assistant</b><small><i className="chat-dot" />Hindi · English · Hinglish</small></div>
            <button type="button" className="chat-new" onClick={newChat} aria-label="Start a new chat" title="Start a new chat">
              <span aria-hidden="true">↺</span> New chat
            </button>
            <button type="button" className="chat-x" onClick={() => close()} aria-label="Close chat">✕</button>
          </header>

          <div className="chat-body" ref={bodyRef} role="log" aria-live="polite" aria-label="Conversation">
            {msgs.map((m, i) => (
              <div key={i} className={`chat-row ${m.role}`}>
                <div className="chat-bubble">{m.content}</div>
                {m.note && <small className="chat-inline-note">{m.note}</small>}
                {m.service && nameOf(m.service) && (
                  <Link className="chat-cta" to={`/services/${m.service}`} onClick={() => close(false)}>Book {nameOf(m.service)} →</Link>
                )}
              </div>
            ))}
            {busy && <div className="chat-row assistant"><div className="chat-bubble typing" role="status" aria-label="Assistant is typing"><i /><i /><i /></div></div>}
            {error && (
              <div className="chat-row assistant" role="alert">
                <div className="chat-bubble err">{error}</div>
                <button type="button" className="chat-retry" onClick={retry}>↻ Try again</button>
              </div>
            )}
            {fresh && !busy && (
              <div className="chat-starters" aria-label="Suggested questions">
                {STARTERS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
          </div>

          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input
              ref={inputRef} value={text} maxLength={MAX_LEN} autoComplete="off" enterKeyHint="send"
              onChange={(e) => { setText(e.target.value); if (hint) setHint(''); }}
              placeholder={listening ? 'Listening…' : 'Type your problem…'} aria-label="Your message"
            />
            {SpeechRec && (
              <button type="button" className={`chat-mic${listening ? ' on' : ''}`} onClick={mic} aria-pressed={listening}
                aria-label={listening ? 'Stop listening' : 'Speak your problem'} title="Speak">🎤</button>
            )}
            <button type="submit" className="chat-send" disabled={busy} aria-label="Send message">➤</button>
          </form>
          <p className={`chat-note${hint ? ' warn' : ''}`} role={hint ? 'alert' : undefined}>
            {hint || (nearLimit ? `${text.length}/${MAX_LEN} characters` : 'AI assistant. For anything urgent or risky, switch the appliance off and call 112.')}
          </p>
        </section>
      )}

      <button ref={fabRef} type="button" className={`chat-fab${open ? ' open' : ''}`} onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-label={open ? 'Close assistant' : 'Chat with Saath assistant'}>
        {open ? <span aria-hidden="true">✕</span> : (
          <>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" fill="currentColor" /><circle cx="9" cy="9.5" r="1.2" fill="#0A0805" /><circle cx="12.5" cy="9.5" r="1.2" fill="#0A0805" /><circle cx="16" cy="9.5" r="1.2" fill="#0A0805" /></svg>
            <span className="chat-fab-label">Ask Saath</span>
          </>
        )}
      </button>
    </div>
  );
}
