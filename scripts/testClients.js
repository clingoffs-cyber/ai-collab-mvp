import { io } from 'socket.io-client';

const SERVER = 'http://localhost:3000';

const c1 = io(SERVER, { autoConnect: true });
const c2 = io(SERVER, { autoConnect: true });

c1.on('connect', () => {
  console.log('c1 connected', c1.id);
  c1.emit('join-session', { name: 'Alice', role: 'human' });
});

c2.on('connect', () => {
  console.log('c2 connected', c2.id);
  c2.emit('join-session', { name: 'Bob', role: 'human' });
});

c1.on('session-state', (s) => {
  console.log('c1 session-state users:', s.users.map(u => ({id: u.id, name: u.name}))); 
});

c2.on('session-state', (s) => {
  console.log('c2 session-state users:', s.users.map(u => ({id: u.id, name: u.name}))); 
});

c1.on('disconnect', (reason) => console.log('c1 disconnected', reason));
c2.on('disconnect', (reason) => console.log('c2 disconnected', reason));

// After both connected, wait a moment then c1 removes c2
setTimeout(() => {
  if (c2.id) {
    console.log('c1 will remove c2', c2.id);
    c1.emit('removeUser', { userId: c2.id });
  } else {
    console.log('c2 id unknown, cannot remove');
  }
}, 2000);

// Exit after some time
setTimeout(() => {
  c1.close();
  c2.close();
  console.log('test finished');
  process.exit(0);
}, 6000);
