import { io } from 'socket.io-client';

const SERVER = 'http://localhost:3000';

(async () => {
  // First connect and join with a token
  const c1 = io(SERVER, { autoConnect: true });
  c1.on('connect', () => console.log('first connect', c1.id));
  c1.on('session-state', (s) => console.log('first session users:', s.users.map(u => ({id: u.id, token: u.token, name: u.name}))));

  await new Promise((r) => setTimeout(r, 500));
  c1.emit('join-session', { name: 'ReconnectUser', role: 'human' });

  // Wait for join
  await new Promise((r) => setTimeout(r, 1000));

  // Capture token from session-state by requesting via server? No direct API; instead, fetch server session via shared broadcast.
  // We'll simulate by reading session-state from c1 event above. For simplicity, assume token present in session-state logs.

  // Disconnect c1 and reconnect as a new socket with same token by extracting token from previous session-state
  c1.close();
  await new Promise((r) => setTimeout(r, 500));

  // Simulate a new client rejoining with same name/token; generate a token (in real client it would be persisted)
  const token = 'manual-test-token-' + Date.now();
  // First, inform server by creating a fake previous user with that token via join
  const temp = io(SERVER, { autoConnect: true });
  temp.on('connect', () => {
    console.log('temp connected', temp.id);
    temp.emit('join-session', { name: 'ReconnectUser', role: 'human', token });
  });
  temp.on('session-state', (s) => console.log('temp session users:', s.users.map(u => ({id: u.id, token: u.token, name: u.name}))));

  await new Promise((r) => setTimeout(r, 1000));

  // Now close temp and reconnect new socket using same token
  temp.close();
  await new Promise((r) => setTimeout(r, 500));

  const c2 = io(SERVER, { autoConnect: true });
  c2.on('connect', () => {
    console.log('reconnect socket', c2.id);
    c2.emit('join-session', { name: 'ReconnectUser', role: 'human', token });
  });
  c2.on('session-state', (s) => console.log('reconnect session users:', s.users.map(u => ({id: u.id, token: u.token, name: u.name}))));

  await new Promise((r) => setTimeout(r, 1500));
  c2.close();
  console.log('reconnect test finished');
  process.exit(0);
})();
