import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const session = {
  id: 'session-1',
  createdAt: Date.now(),
  users: [],
  events: [],
  chat: [],
};

const formatEvent = (type, user, description) => ({
  id: crypto.randomUUID(),
  type,
  user: { id: user.id, name: user.name, role: user.role },
  description,
  timestamp: Date.now(),
});

const broadcastSession = () => {
  io.emit('session-state', {
    id: session.id,
    createdAt: session.createdAt,
    users: session.users,
    events: session.events,
    chat: session.chat,
  });
};

const findUser = (socketId) => session.users.find((entry) => entry.id === socketId);
const findUserByToken = (token) => session.users.find((entry) => entry.token === token);

const createSummary = () => {
  const promptCount = session.events.filter((event) => event.type === 'prompt-sent').length;
  const responseCount = session.events.filter((event) => event.type === 'response-received').length;
  const activeUsers = session.users.map((user) => user.name).join(', ') || 'no active users';
  return `Session summary: ${session.users.length} active user(s) (${activeUsers}). ${promptCount} prompt(s) and ${responseCount} response(s) were recorded. There are ${session.chat.length} shared tether message(s).`;
};

const generateMockAiReply = (prompt) => `Mock AI reply: ${prompt.trim().slice(0, 120)}${prompt.trim().length > 120 ? '...' : ''}`;

const generateAiText = async (prompt) => {
  const apiKey = (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('No AI API key found (AI_API_KEY or OPENAI_API_KEY); using mock fallback response.');
    return generateMockAiReply(prompt);
  }

  const apiBase = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-3.5-turbo';

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful AI assistant providing a concise paragraph response.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 250,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
      console.warn('AI API returned unexpected response, falling back to mock.');
      return generateMockAiReply(prompt);
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('AI generation failed:', error);
    return generateMockAiReply(prompt);
  }
};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-session', ({ name, role, token } = {}) => {
    // Support a persistent token so clients can re-associate after refresh
    let user = null;
    if (token) user = findUserByToken(token);

    if (user) {
      const wasId = user.id;
      user.id = socket.id;
      user.name = name || user.name || 'Anonymous';
      user.role = role === 'agent' ? 'agent' : 'human';
      user.connectedAt = Date.now();
      session.users = session.users.filter((entry) => entry.token !== user.token).concat(user);
      session.events.push(formatEvent('user-reconnected', user, `${user.name} reconnected`));
    } else {
      user = {
        id: socket.id,
        token: token || crypto.randomUUID(),
        name: name || 'Anonymous',
        role: role === 'agent' ? 'agent' : 'human',
        connectedAt: Date.now(),
      };
      // remove any previous entries with this socket id and add
      session.users = session.users.filter((entry) => entry.id !== socket.id).concat(user);
      session.events.push(formatEvent('user-joined', user, `${user.name} joined the session`));
    }

    socket.emit('session-state', {
      id: session.id,
      createdAt: session.createdAt,
      users: session.users,
      events: session.events,
      chat: session.chat,
    });
    broadcastSession();
  });

  socket.on('personal-prompt', async ({ text }) => {
    const user = findUser(socket.id);
    if (!user || typeof text !== 'string' || !text.trim()) return;

    session.events.push(formatEvent('prompt-sent', user, `${user.name} sent a prompt`));
    broadcastSession();

    let aiText;
    try {
      aiText = await generateAiText(text);
    } catch (error) {
      console.error('Error generating AI text, falling back to mock response:', error);
      aiText = generateMockAiReply(text);
    }

    socket.emit('personal-response', {
      id: crypto.randomUUID(),
      userId: socket.id,
      userName: 'AI Assistant',
      role: 'assistant',
      text: aiText,
      timestamp: Date.now(),
    });

    session.events.push(formatEvent('response-received', user, `${user.name} received a response`));
    broadcastSession();
  });

  socket.on('shared-chat-message', ({ text }) => {
    const user = findUser(socket.id);
    if (!user || typeof text !== 'string' || !text.trim()) return;

    const chatMessage = {
      id: crypto.randomUUID(),
      userId: user.id,
      userName: user.name,
      role: user.role,
      text: text.trim(),
      timestamp: Date.now(),
    };

    console.log('Shared chat message received from', user.name, ':', chatMessage.text);

    session.chat.push(chatMessage);
    io.emit('shared-chat-message', chatMessage);
    broadcastSession();
  });

  socket.on('request-summary', () => {
    const user = findUser(socket.id);
    if (!user || user.role !== 'agent') return;

    const summary = createSummary();
    const message = {
      id: crypto.randomUUID(),
      userId: user.id,
      userName: user.name,
      role: 'agent',
      text: summary,
      timestamp: Date.now(),
    };

    session.chat.push(message);
    session.events.push(formatEvent('agent-summary', user, `${user.name} requested a session summary`));
    io.emit('shared-chat-message', message);
    broadcastSession();
  });

  socket.on('logout', () => {
    const user = findUser(socket.id);
    if (user) {
      session.users = session.users.filter((entry) => entry.id !== socket.id);
      session.events.push(formatEvent('user-left', user, `${user.name} logged out`));
      broadcastSession();
    }
  });

  socket.on('removeUser', ({ userId }) => {
    if (!userId) return;
    const targetSocket = io.sockets.sockets.get(userId);
    const user = findUser(userId);
    // If the socket is still connected, mark it so the disconnect handler knows
    // this was an admin removal and let the disconnect handler perform the cleanup
    if (targetSocket) {
      targetSocket.removedByAdmin = true;
      targetSocket.disconnect(true);
      return;
    }
    // If there's no active socket (already disconnected), remove the user and broadcast
    if (user) {
      session.users = session.users.filter((entry) => entry.id !== userId);
      session.events.push(formatEvent('user-removed', user, `${user.name} was removed from the session`));
      broadcastSession();
    }
  });

  socket.on('disconnect', () => {
    const user = findUser(socket.id);
    if (user) {
      session.users = session.users.filter((entry) => entry.id !== socket.id);
      if (socket.removedByAdmin) {
        session.events.push(formatEvent('user-removed', user, `${user.name} was removed from the session`));
      } else {
        session.events.push(formatEvent('user-left', user, `${user.name} left the session`));
      }
      broadcastSession();
    }
    console.log('Client disconnected:', socket.id);
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
