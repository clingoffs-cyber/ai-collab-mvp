import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const getSocketUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const origin = window.location.origin;
  const host = window.location.host;

  if (host.includes('-5173.app.github.dev')) {
    return origin.replace('-5173.app.github.dev', '-3000.app.github.dev');
  }

  // If running locally and no explicit API URL provided, assume the backend is on port 3000.
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && url.port && url.port !== '3000') {
      return `${url.protocol}//${hostname}:3000`;
    }
  } catch (e) {
    // ignore and fallback
  }

  return origin;
};

const SOCKET_URL = getSocketUrl();
const socket = io(SOCKET_URL, {
  autoConnect: false,
  path: '/socket.io',
});

const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function App() {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [loginRole, setLoginRole] = useState('human');
  const [user, setUser] = useState(null);
  const joinSessionRef = useRef(false);
  const [session, setSession] = useState({ id: '', createdAt: null, users: [], events: [], chat: [] });
  const [personalHistory, setPersonalHistory] = useState([]);
  const [personalInput, setPersonalInput] = useState('');
  const [tetherInput, setTetherInput] = useState('');
  const [popoutOpen, setPopoutOpen] = useState(false);
  const [autoOpenOnMessage, setAutoOpenOnMessage] = useState(false);
  const [dock, setDock] = useState('right');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedName = window.localStorage.getItem('ai-collab-user-name');
    const savedRole = window.localStorage.getItem('ai-collab-user-role');
    const savedToken = window.localStorage.getItem('ai-collab-user-token');
    const savedAutoOpen = window.localStorage.getItem('ai-collab-auto-open');
    const savedDock = window.localStorage.getItem('ai-collab-dock-side');

    if (savedAutoOpen !== null) {
      setAutoOpenOnMessage(savedAutoOpen === 'true');
    }
    if (savedDock === 'left' || savedDock === 'right') {
      setDock(savedDock);
    }

    if (savedName && savedRole) {
      setLoginName(savedName);
      setLoginRole(savedRole);
      setUser({ id: '', name: savedName, role: savedRole, token: savedToken || '' });
      setJoined(true);
      if (socket.connected) {
        socket.emit('join-session', { name: savedName, role: savedRole, token: savedToken });
      }
    }

    // Do not connect here; connection will be established after listeners are registered
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-collab-auto-open', autoOpenOnMessage ? 'true' : 'false');
  }, [autoOpenOnMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-collab-dock-side', dock);
  }, [dock]);

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      if (joined && user) {
        socket.emit('join-session', { name: user.name, role: user.role, token: user.token });
        joinSessionRef.current = true;
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('session-state', (payload) => setSession(payload));
    socket.on('shared-chat-message', (message) => {
      console.log('Received shared-chat-message:', message);
      setSession((current) => ({
        ...current,
        chat: [...current.chat, message],
      }));
      if (autoOpenOnMessage && !popoutOpen) {
        setPopoutOpen(true);
      }
    });
    socket.on('personal-response', (message) => {
      setPersonalHistory((current) => [
        ...current,
        { id: message.id, role: 'assistant', text: message.text, timestamp: message.timestamp },
      ]);
    });

    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('session-state');
      socket.off('shared-chat-message');
      socket.off('personal-response');
    };
  }, [autoOpenOnMessage, popoutOpen, joined, user]);

  useEffect(() => {
    if (!joined || !user) {
      joinSessionRef.current = false;
      return;
    }

    if (socket.connected && !joinSessionRef.current) {
      socket.emit('join-session', { name: user.name, role: user.role, token: user.token });
      joinSessionRef.current = true;
    }
  }, [joined, user, connected]);

  const activeUserCount = useMemo(() => session.users.length, [session.users]);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('ai-collab-user-name');
      window.localStorage.removeItem('ai-collab-user-role');
      window.localStorage.removeItem('ai-collab-user-token');
      window.localStorage.removeItem('ai-collab-auto-open');
      window.localStorage.removeItem('ai-collab-dock-side');
    }

    if (socket.connected) {
      socket.emit('logout');
    }

    setUser(null);
    setJoined(false);
    setLoginName('');
    setLoginRole('human');
    setSession({ id: '', createdAt: null, users: [], events: [], chat: [] });
    setPersonalHistory([]);
    setPersonalInput('');
    setTetherInput('');
    setPopoutOpen(false);
  };

  const handleRemoveUser = (userId) => {
    if (!userId || !socket.connected) return;
    socket.emit('removeUser', { userId });
  };

  const handleJoin = (event) => {
    event.preventDefault();
    if (!loginName.trim()) return;

    const trimmedName = loginName.trim();
    const userInfo = {
      id: '',
      name: trimmedName,
      role: loginRole,
    };

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ai-collab-user-name', trimmedName);
      window.localStorage.setItem('ai-collab-user-role', loginRole);
      let token = window.localStorage.getItem('ai-collab-user-token');
      if (!token && window.crypto && window.crypto.randomUUID) {
        token = window.crypto.randomUUID();
        window.localStorage.setItem('ai-collab-user-token', token);
      } else if (!token) {
        token = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        window.localStorage.setItem('ai-collab-user-token', token);
      }
      userInfo.token = token;
    }

    if (!socket.connected) {
      socket.connect();
    }

    setUser(userInfo);
    setJoined(true);
    // If already connected, emit immediately; otherwise the connect handler will emit once connected
    if (socket.connected) {
      socket.emit('join-session', { name: trimmedName, role: loginRole, token: userInfo.token });
    }
  };

  const handleSendPersonal = (event) => {
    event.preventDefault();
    const text = personalInput.trim();
    if (!text) return;

    setPersonalHistory((history) => [
      ...history,
      { id: `${Date.now()}-user`, role: 'user', text, timestamp: Date.now() },
    ]);
    socket.emit('personal-prompt', { text });
    setPersonalInput('');
  };

  const handleSendTether = (event) => {
    event.preventDefault();
    const text = tetherInput.trim();
    if (!text) return;

    socket.emit('shared-chat-message', { text });
    setTetherInput('');
  };

  const handleRequestSummary = () => {
    socket.emit('request-summary');
    if (!popoutOpen) setPopoutOpen(true);
  };

  const brandLabel = user?.role === 'agent' ? 'Agent console' : 'Personal AI window';

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-4 rounded-3xl border border-slate-700 bg-slate-900/90 p-6 shadow-xl shadow-slate-900/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-white">AI Collab MVP</h1>
              <p className="mt-2 text-sm text-slate-400">Independent AI windows with a shared session tether and pop-out presence panel.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-4 py-2 text-xs font-medium ${connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                {connected ? 'Connected' : 'Disconnected'}
              </span>
              <span className="rounded-full bg-slate-800/80 px-4 py-2 text-xs text-slate-300">Session users: {activeUserCount}</span>
              {joined && user && (
                <div className="flex items-center gap-2 rounded-3xl bg-slate-800/80 px-4 py-2 text-xs text-slate-300">
                  <span>{user.name} ({user.role === 'agent' ? 'Agent' : 'Human'})</span>
                  <button onClick={handleLogout} className="rounded-full bg-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-slate-600">
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {!joined && (
          <div className="mx-auto max-w-xl rounded-3xl border border-slate-700 bg-slate-900/90 p-6 shadow-lg shadow-slate-900/30">
            <h2 className="text-xl font-semibold text-white">Join the shared session</h2>
            <form onSubmit={handleJoin} className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-slate-300">Name</label>
              <input
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                className="w-full rounded-3xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="Your name"
              />
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-300">Login as</p>
                <div className="flex gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                    <input type="radio" name="loginRole" value="human" checked={loginRole === 'human'} onChange={() => setLoginRole('human')} />
                    Human
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                    <input type="radio" name="loginRole" value="agent" checked={loginRole === 'agent'} onChange={() => setLoginRole('agent')} />
                    AI Agent
                  </label>
                </div>
              </div>
              <button className="w-full rounded-3xl bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400" type="submit">
                Join session
              </button>
            </form>
          </div>
        )}

        {joined && (
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-3xl border border-slate-700 bg-slate-900/90 p-6 shadow-lg shadow-slate-900/20">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">{brandLabel}</h2>
                  <p className="text-sm text-slate-400">Separate chat history for this user only.</p>
                </div>
                <div className="rounded-3xl bg-slate-950/80 px-4 py-2 text-sm text-slate-300">Role: {user.role === 'agent' ? 'Agent' : 'Human'}</div>
              </div>

              <div className="flex h-[60vh] flex-col gap-4 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="flex-1 space-y-3 overflow-y-auto pr-2">
                  {personalHistory.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">Your private AI history appears here after you send a prompt.</div>
                  ) : (
                    personalHistory.map((entry) => (
                      <div key={entry.id} className={entry.role === 'user' ? 'rounded-3xl bg-slate-800/80 p-4 text-slate-100' : 'rounded-3xl bg-slate-700/80 p-4 text-slate-100'}>
                        <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-500">{entry.role === 'user' ? 'You' : 'AI'}</div>
                        <div className="text-sm leading-6">{entry.text}</div>
                        <div className="mt-2 text-[11px] text-slate-500">{formatTime(entry.timestamp)}</div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendPersonal} className="mt-2 flex gap-3">
                  <input
                    value={personalInput}
                    onChange={(event) => setPersonalInput(event.target.value)}
                    placeholder="Send a personal AI prompt"
                    className="flex-1 rounded-3xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                  />
                  <button className="rounded-3xl bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400" type="submit">
                    Send
                  </button>
                </form>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-700 bg-slate-900/90 p-6 shadow-lg shadow-slate-900/20">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Session tether</h2>
                  <p className="text-sm text-slate-400">Presence, shared chat, and activity feed.</p>
                </div>
                <div className="text-sm text-slate-400">ID: {session.id}</div>
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-200">Users in session</p>
                    {user.role === 'agent' && (
                      <button onClick={handleRequestSummary} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200 transition hover:bg-slate-700">
                        Generate summary
                      </button>
                    )}
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    {session.users.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-900/90 px-3 py-2">
                        <div>
                          <div>{entry.name}</div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{entry.role === 'agent' ? 'Agent' : 'Human'}</div>
                        </div>
                        <button
                          onClick={() => handleRemoveUser(entry.id)}
                          className="rounded-full bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {session.users.length === 0 && <li className="rounded-2xl bg-slate-900/90 px-3 py-2 text-slate-500">No users connected yet.</li>}
                  </ul>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                  <p className="mb-3 text-sm font-medium text-slate-200">Shared tether chat</p>
                  <div className="mb-3 max-h-52 space-y-3 overflow-y-auto pr-2 text-sm text-slate-100">
                    {session.chat.length === 0 ? (
                      <div className="rounded-2xl bg-slate-900/90 p-3 text-slate-500">Shared chat messages appear here.</div>
                    ) : (
                      session.chat.map((message) => (
                        <div key={message.id} className="rounded-2xl bg-slate-900/90 p-3">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{message.userName}</div>
                          <div className="mt-1 text-sm leading-6 text-slate-100">{message.text}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleSendTether} className="flex gap-3">
                    <input
                      value={tetherInput}
                      onChange={(event) => setTetherInput(event.target.value)}
                      placeholder="Send to shared tether"
                      className="flex-1 rounded-3xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                    />
                    <button className="rounded-3xl bg-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-600" type="submit">
                      Post
                    </button>
                  </form>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-200">Activity feed</p>
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-400">{session.events.length}</span>
                  </div>
                  <div className="space-y-2 text-sm text-slate-300">
                    {session.events.slice(-6).reverse().map((event) => (
                      <div key={event.id} className="rounded-2xl bg-slate-900/90 px-3 py-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{formatTime(event.timestamp)}</div>
                        <div>{event.description}</div>
                      </div>
                    ))}
                    {session.events.length === 0 && <div className="rounded-2xl bg-slate-900/90 px-3 py-3 text-slate-500">No session activity yet.</div>}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                  <p className="mb-3 text-sm font-medium text-slate-200">Pop-out settings</p>
                  <div className="space-y-4 text-sm text-slate-300">
                    <div className="flex items-center justify-between gap-3 rounded-3xl bg-slate-900/90 px-4 py-3">
                      <span>Auto-open on message</span>
                      <button
                        type="button"
                        onClick={() => setAutoOpenOnMessage((current) => !current)}
                        className={`rounded-full px-4 py-2 text-xs font-semibold ${autoOpenOnMessage ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
                      >
                        {autoOpenOnMessage ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="rounded-3xl bg-slate-900/90 px-4 py-3">
                      <div className="mb-2 text-sm text-slate-400">Dock side</div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setDock('left')}
                          className={`rounded-3xl px-4 py-2 text-xs font-semibold ${dock === 'left' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
                        >
                          Left
                        </button>
                        <button
                          type="button"
                          onClick={() => setDock('right')}
                          className={`rounded-3xl px-4 py-2 text-xs font-semibold ${dock === 'right' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
                        >
                          Right
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {joined && (
        <div className={`fixed top-24 z-50 ${dock === 'right' ? 'right-4' : 'left-4'}`}>
          <button
            onClick={() => setPopoutOpen((open) => !open)}
            className="rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-slate-900/40 transition hover:bg-sky-400"
          >
            {popoutOpen ? 'Hide tether' : 'Show tether'}
          </button>
          {popoutOpen && (
            <div className="mt-3 w-[320px] rounded-3xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl shadow-slate-950/60">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Session tether</div>
                  <div className="text-xs text-slate-400">Presence and activity</div>
                </div>
                <button onClick={() => setPopoutOpen(false)} className="text-slate-400 transition hover:text-slate-100">Close</button>
              </div>
              <div className="space-y-3 text-sm text-slate-300">
                <div className="rounded-3xl bg-slate-950/80 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Users</div>
                  <div className="mt-2 space-y-2">
                    {session.users.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between rounded-2xl bg-slate-900/90 px-3 py-2">
                        <span>{entry.name}</span>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{entry.role}</span>
                      </div>
                    ))}
                    {session.users.length === 0 && <div className="rounded-2xl bg-slate-900/90 px-3 py-2 text-slate-500">No users yet.</div>}
                  </div>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">Chat</div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {session.chat.length === 0 ? (
                      <div className="rounded-2xl bg-slate-900/90 px-3 py-2 text-slate-500">No shared messages.</div>
                    ) : (
                      session.chat.slice(-6).map((message) => (
                        <div key={message.id} className="rounded-2xl bg-slate-900/90 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{message.userName}</div>
                          <div className="mt-1 text-sm text-slate-100">{message.text}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">Activity</div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {session.events.length === 0 ? (
                      <div className="rounded-2xl bg-slate-900/90 px-3 py-2 text-slate-500">No activity yet.</div>
                    ) : (
                      session.events.slice(-4).reverse().map((event) => (
                        <div key={event.id} className="rounded-2xl bg-slate-900/90 px-3 py-2 text-slate-200">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{formatTime(event.timestamp)}</div>
                          <div>{event.description}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
