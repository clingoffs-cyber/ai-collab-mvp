import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export default function App() {
  const [hideTether, setHideTether] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [tetherInput, setTetherInput] = useState("");
  const [autoOpenOnMessage, setAutoOpenOnMessage] = useState(false);
  const [dockSide, setDockSide] = useState('Right');

  const [tetherMessages, setTetherMessages] = useState([
    { sender: 'AI Agent', text: 'Hey there, Jeff! 👋 Shared session tether connected.' }
  ]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeView, setActiveView] = useState('workspace');
  const [newUserName, setNewUserName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [usersInSession, setUsersInSession] = useState([
    { name: 'Jeff', role: 'Human' }
  ]);

  const [currentUserName, setCurrentUserName] = useState('Jeff');

  // Restore per-tab active user from sessionStorage and shared roster from localStorage
  useEffect(() => {
    try {
      const savedCurrent = sessionStorage.getItem('currentUserName');
      if (savedCurrent) {
        setCurrentUserName(savedCurrent);
      }

      const storedRoster = localStorage.getItem('usersInSession');
      if (storedRoster) {
        setUsersInSession(JSON.parse(storedRoster));
      } else {
        // initialize localStorage roster so other tabs can pick it up
        localStorage.setItem('usersInSession', JSON.stringify(usersInSession));
      }
    } catch (e) {
      console.warn('Storage restore failed', e);
    }

    const onStorage = (ev) => {
      if (ev.key === 'usersInSession') {
        try {
          const parsed = JSON.parse(ev.newValue || '[]');
          setUsersInSession(parsed);
        } catch (e) {
          console.warn('Failed parsing usersInSession from storage event', e);
        }
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Socket connection for real-time session sync and shared tether chat
  const socketRef = useRef(null);
  const pendingTimersRef = useRef([]);
  useEffect(() => {
    // Connect to server (dev server on port 3000)
    const SOCKET_URL = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000` : 'http://localhost:3000';
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      try {
        socket.emit('join-session', { name: currentUserName, role: 'human' });
      } catch (e) {
        console.warn('Failed to emit join-session on connect', e);
      }
    });

    socket.on('shared-chat-message', (msg) => {
      setTetherMessages((prev) => [...prev, msg]);
    });

    socket.on('personal-response', (payload) => {
      // Replace the first loading placeholder with the AI response
      setMessages(prev => {
        const idx = prev.findIndex(m => m.loading);
        if (idx !== -1) {
          const copy = [...prev];
          copy[idx] = { sender: 'ai', text: payload.text };
          return copy;
        }
        return [...prev, { sender: 'ai', text: payload.text }];
      });

      // Clear one pending timeout corresponding to this response
      const t = pendingTimersRef.current.shift();
      if (t) clearTimeout(t);
    });

    socket.on('session-state', (data) => {
      if (data?.users) setUsersInSession(data.users);
      if (data?.chat) setTetherMessages(data.chat || []);
    });

    return () => {
      try { socket.disconnect(); } catch (e) {}
      socketRef.current = null;
    };
  }, []);

  // When currentUserName changes, tell the server this tab wants to be that user
  useEffect(() => {
    try {
      sessionStorage.setItem('currentUserName', currentUserName);
    } catch (e) {
      console.warn('Failed saving currentUserName', e);
    }
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('join-session', { name: currentUserName, role: 'human' });
    }
  }, [currentUserName]);

  const handleCreateUser = () => {
    const name = newUserName.trim();
    if (!name) return;

    const newUser = { name, role: 'Human' };
    setUsersInSession(prev => {
      const next = [...prev, newUser];
      try { localStorage.setItem('usersInSession', JSON.stringify(next)); } catch (e) { console.warn('Failed saving usersInSession', e); }
      return next;
    });

    // Optionally add a presence message to the tether chat for visibility in the UI
    setTetherMessages(prev => [...prev, { sender: newUser.name, text: 'joined the session.' }]);

    // Make this tab operate as the newly created user (local active identity)
    setCurrentUserName(name);
    try { sessionStorage.setItem('currentUserName', name); } catch (e) { console.warn('Failed saving currentUserName', e); }

    // Clear the input only after successful addition
    setNewUserName('');
  };

  const handleSendMessage = () => {
    const text = inputValue.trim();
    if (!text) return;

    // Append the user's prompt locally
    setMessages(prev => [...prev, { sender: 'human', text }]);

    // If socket connected, emit to server; otherwise show error
    if (socketRef.current && socketRef.current.connected) {
      // Add a loading placeholder AI message which will be replaced by server response
      setMessages(prev => [...prev, { sender: 'ai', text: 'Waiting for AI...', loading: true }]);

      // Start a timeout to show an error if response doesn't arrive
      const to = setTimeout(() => {
        setMessages(prev => {
          const idx = prev.findIndex(m => m.loading);
          if (idx === -1) return prev;
          const copy = [...prev];
          copy[idx] = { sender: 'ai', text: 'AI request timed out. Please try again.', error: true };
          return copy;
        });
      }, 15000);
      pendingTimersRef.current.push(to);

      socketRef.current.emit('personal-prompt', { text });

      // Clear the input since request was submitted
      setInputValue('');
    } else {
      // Not connected: show an error message and keep the input intact
      setMessages(prev => [...prev, { sender: 'ai', text: 'AI service unavailable (offline).', error: true }]);
    }
  };

  const handleSendTetherMessage = () => {
    if (!tetherInput.trim()) return;
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('shared-chat-message', { text: tetherInput });
    } else {
      setTetherMessages(prev => [...prev, { sender: currentUserName, text: tetherInput }]);
    }
    setTetherInput("");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col w-full h-screen overflow-hidden select-none">
      
      {/* Top Banner Control Panel Bar */}
      <div className="flex justify-between items-center bg-slate-900/40 border-b border-slate-900/80 px-6 py-4">
        <div>
          <h1 className="text-base font-bold text-slate-100 tracking-tight">AI Collab MVP</h1>
          <p className="text-[11px] text-slate-300 mt-0.5">Independent AI windows with a shared session tether and pop-out presence panel.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView(activeView === 'workspace' ? 'newUser' : 'workspace')}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-1.5 rounded-lg transition"
          >
            {activeView === 'workspace' ? 'Add New User' : 'Back to Workspace'}
          </button>
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-900 text-[10px] px-2.5 py-0.5 rounded-full font-bold mr-2">Connected</span>
          <span className="text-xs text-slate-300 font-medium bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">{currentUserName} (Human)</span>
          <button className="bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 text-xs px-3 py-1.5 rounded-lg transition">Logout</button>
        </div>
      </div>

      {/* Primary Sub-Heading Block Header (labels removed to reclaim vertical space) */}
      <div className="px-6 pt-5 pb-1 flex justify-between items-center">
        <div />
        <div className="flex gap-2">
          <button 
            onClick={() => setHideTether(!hideTether)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg transition border border-slate-700"
          >
            {hideTether ? "Show tether" : "Hide tether"}
          </button>
        </div>
      </div>

      {/* Main Layout Split */}
      <div className={`flex flex-1 p-6 gap-6 min-h-0 w-full ${dockSide === 'Left' ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* Main Workspace / Add New User Panel */}
        <div className="flex-1 bg-slate-900/20 border border-slate-900 rounded-xl p-5 flex flex-col justify-between relative">
          {activeView === 'workspace' ? (
            <>
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-900">
                  <div />
                  <div className="bg-slate-950 border border-slate-800 px-3 py-1 rounded-md">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Human Role</span>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                  {messages.length > 0 && messages.map((msg, idx) => (
                      <div 
                        key={idx} 
                        className={`flex flex-col max-w-[75%] rounded-xl p-3 text-sm border ${
                          msg.sender === 'human' 
                            ? 'bg-sky-950/40 border-sky-800 text-slate-100 self-end ml-auto' 
                            : 'bg-slate-900/60 border-slate-800 text-slate-100 self-start'
                        }`}
                      >
                        <span className="text-[9px] font-mono uppercase tracking-wider text-sky-400 mb-1 font-bold">
                          {msg.sender === 'human' ? 'You' : 'Personal AI'}
                        </span>
                        <p className="leading-relaxed whitespace-pre-wrap font-medium">{msg.text}</p>
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex gap-3 mt-4 pt-4 border-t border-slate-900">
                <input 
                  type="text" 
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Send a personal AI prompt" 
                  className="flex-1 bg-slate-950/60 border border-sky-600 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder-slate-300 font-medium focus:outline-none focus:border-sky-500"
                />
                <button 
                  onClick={handleSendMessage}
                  className="bg-sky-600 hover:bg-sky-500 text-slate-950 text-xs font-bold px-6 py-3 rounded-xl transition shadow"
                >
                  Send
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-100">Create New User / Join Session</h2>
                    <p className="text-sm text-slate-400 mt-1">Keep your current session active while onboarding another user.</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <section className="bg-slate-950/40 border border-slate-900 rounded-3xl p-5 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-100">Create new user</h3>
                      <p className="text-xs text-slate-500 mt-1">Add another human collaborator without interrupting the active session.</p>
                    </div>
                    <label className="block text-[11px] text-slate-400 uppercase tracking-[0.18em] font-semibold">New user name</label>
                    <input
                      type="text"
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      placeholder="Enter user name"
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={handleCreateUser}
                      className="w-full bg-sky-600 hover:bg-sky-500 text-slate-950 text-xs font-bold uppercase tracking-wide py-3 rounded-2xl transition"
                    >
                      Create user
                    </button>
                  </section>

                  <section className="bg-slate-950/40 border border-slate-900 rounded-3xl p-5 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-100">Join existing session</h3>
                      <p className="text-xs text-slate-500 mt-1">Invite a new user into the current session using a link or code.</p>
                    </div>
                    <label className="block text-[11px] text-slate-400 uppercase tracking-[0.18em] font-semibold">Session code</label>
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="Enter invite code"
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={() => {} }
                      className="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-bold uppercase tracking-wide py-3 rounded-2xl transition"
                    >
                      Join session
                    </button>
                  </section>
                </div>
              </div>

              <div className="mt-auto rounded-3xl border border-slate-800 bg-slate-950/30 p-4 text-sm text-slate-300">
                <p className="font-medium text-slate-100">Session state preserved</p>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-400">Your current AI workspace, tether connection, and shared session state remain active while you switch to the onboarding interface. Return to the workspace instantly with the button in the header.</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Session Tether */}
        {!hideTether && (
          <div className="w-[320px] flex-shrink-0 bg-slate-900/20 border border-slate-900 rounded-xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-200 text-sm">Session tether</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Presence, shared chat, and activity feed.</p>
              </div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`text-[11px] px-2 py-1 rounded-md font-medium transition ${showHistory ? 'bg-slate-800 text-sky-400' : 'bg-slate-950/30 text-slate-300'}`}
              >
                AI History
              </button>
            </div>

            {/* Active Users */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 flex flex-col min-h-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Users in session</span>
              <div className="space-y-2 overflow-y-auto pr-1 flex-1 max-h-[140px]">
                {usersInSession.map((u, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-900">
                    <div>
                      <div className={`text-xs font-bold ${u.name === currentUserName ? 'text-sky-400' : 'text-slate-200'}`}>{u.name}</div>
                      <div className="text-[9px] text-slate-400 uppercase tracking-tight mt-0.5 font-medium">{u.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {showHistory && (
              <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 flex flex-col min-h-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Private AI history</span>
                <div className="space-y-2 overflow-y-auto pr-1 flex-1 max-h-[180px]">
                  {messages.length === 0 ? (
                    <div className="text-xs text-slate-500 italic">No private history yet.</div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div key={idx} className="bg-slate-900/40 border border-slate-900 p-2.5 rounded-xl text-xs">
                        <span className="text-[9px] font-mono text-sky-400 font-bold block mb-1">{msg.sender === 'human' ? 'You' : 'Personal AI'}</span>
                        <p className="text-slate-200 font-medium leading-relaxed">{msg.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Shared Chat Feed */}
            <div className="flex-1 flex flex-col min-h-0 bg-slate-950/40 border border-slate-900 rounded-xl p-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Shared tether chat</span>
              
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 mb-2">
                {tetherMessages.map((msg, idx) => (
                  <div key={idx} className="bg-slate-900/40 border border-slate-900 p-2.5 rounded-xl text-xs">
                    <span className="text-[9px] font-mono text-sky-400 font-bold block mb-1">{msg.userName || msg.sender || msg.userName}</span>
                    <p className="text-slate-200 font-medium leading-relaxed">{msg.text}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-1.5 mt-auto">
                <input 
                  type="text" 
                  value={tetherInput}
                  onChange={(e) => setTetherInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendTetherMessage()}
                  placeholder="Send to shared tether" 
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                />
                <button 
                  onClick={handleSendTetherMessage}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs px-3 py-2 rounded-lg text-slate-200 font-bold transition"
                >
                  Post
                </button>
              </div>
            </div>

            {/* Interaction Settings Preference Panel */}
            <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">Auto-open on message</span>
                <button 
                  onClick={() => setAutoOpenOnMessage(!autoOpenOnMessage)}
                  className={`border text-[9px] font-bold px-2.5 py-1 rounded transition uppercase ${
                    autoOpenOnMessage 
                      ? 'bg-emerald-950 text-emerald-400 border-emerald-800' 
                      : 'bg-slate-900 text-slate-500 border-slate-800'
                  }`}
                >
                  {autoOpenOnMessage ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="pt-2 border-t border-slate-900/80 flex items-center justify-between">
                <span className="text-slate-400 font-medium">Dock side</span>
                <div className="flex gap-1 bg-slate-950 p-0.5 border border-slate-800 rounded-md">
                  <button 
                    onClick={() => setDockSide('Left')}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase transition ${
                      dockSide === 'Left' ? 'bg-sky-600 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Left
                  </button>
                  <button 
                    onClick={() => setDockSide('Right')}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase transition ${
                      dockSide === 'Right' ? 'bg-sky-600 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Right
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}