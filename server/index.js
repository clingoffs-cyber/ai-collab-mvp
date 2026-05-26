import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

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

const AGENT_USER = { id: 'ai-agent', name: 'AI Agent', role: 'agent' };

const markUserActive = (user) => {
  if (!user) return;
  user.lastActiveAt = Date.now();
  user.inactivityNotifiedAt = undefined;
};

const createAgentChatMessage = (text, description) => {
  const message = {
    id: crypto.randomUUID(),
    userId: AGENT_USER.id,
    userName: AGENT_USER.name,
    role: AGENT_USER.role,
    text,
    timestamp: Date.now(),
  };

  session.chat.push(message);
  session.events.push(formatEvent('agent-message', AGENT_USER, description || 'AI Agent posted a shared tether message'));
  io.emit('shared-chat-message', message);
  broadcastSession();
};

const buildAgentPrompt = ({ eventType, user, text }) => {
  switch (eventType) {
    case 'user-joined':
      return `A new user named "${user.name}" just joined the shared session tether. Respond as a friendly, personality-driven AI Agent greeting them, inviting them to participate in the tether chat. Keep the message upbeat, concise, and helpful.`;
    case 'shared-chat-message':
      return `A user named "${user.name}" just posted to the shared tether: "${text}". As the session AI Agent, add a short, helpful insight or friendly follow-up comment that keeps the conversation productive and inclusive.`;
    case 'inactivity-warning':
      return `These users appear inactive in the shared session tether: ${text}. As the session AI Agent, send a gentle, friendly nudge encouraging them to rejoin the conversation without being pushy.`;
    default:
      return `The shared session tether is active. As the AI Agent, provide a short, helpful comment or insight.`;
  }
};

const scheduleAgentResponse = async (context) => {
  try {
    const prompt = buildAgentPrompt(context);
    const aiText = await generateAiText(prompt);
    createAgentChatMessage(aiText, `AI Agent responded to ${context.eventType}`);
  } catch (error) {
    console.error('[AGENT_RESPONSE_ERROR]', error);
  }
};

const startInactivityWatcher = () => {
  setInterval(async () => {
    const now = Date.now();
    const inactiveUsers = session.users.filter((user) => {
      const lastActive = user.lastActiveAt || user.connectedAt || 0;
      if (now - lastActive < 60_000) return false;
      if (user.inactivityNotifiedAt && now - user.inactivityNotifiedAt < 300_000) return false;
      return true;
    });

    if (inactiveUsers.length === 0) return;

    const names = inactiveUsers.map((user) => user.name).join(', ');
    inactiveUsers.forEach((user) => {
      user.inactivityNotifiedAt = now;
    });

    session.events.push(formatEvent('agent-inactivity', AGENT_USER, `AI Agent noticed inactive users: ${names}`));
    broadcastSession();
    await scheduleAgentResponse({ eventType: 'inactivity-warning', text: names });
  }, 30_000);
};

startInactivityWatcher();

const findUser = (socketId) => session.users.find((entry) => entry.id === socketId);
const findUserByToken = (token) => session.users.find((entry) => entry.token === token);

const createSummary = () => {
  const promptCount = session.events.filter((event) => event.type === 'prompt-sent').length;
  const responseCount = session.events.filter((event) => event.type === 'response-received').length;
  const activeUsers = session.users.map((user) => user.name).join(', ') || 'no active users';
  return `Session summary: ${session.users.length} active user(s) (${activeUsers}). ${promptCount} prompt(s) and ${responseCount} response(s) were recorded. There are ${session.chat.length} shared tether message(s).`;
};

const generateMockAiReply = (prompt) => `Mock AI reply: ${prompt.trim().slice(0, 120)}${prompt.trim().length > 120 ? '...' : ''}`;

const generateGeminiText = async (prompt, apiKey) => {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.8,
        },
      }),
    });

    const data = await response.json();
    console.log(`[GEMINI_DEBUG] Status: ${response.status}, candidates exists: ${!!data?.candidates}`);
    
    if (!response.ok) {
      console.warn('Gemini API request failed', response.status, response.statusText, data?.error?.message || JSON.stringify(data));
      return generateMockAiReply(prompt);
    }
    if (data?.error) {
      console.warn('Gemini API returned error', data.error.message || JSON.stringify(data.error));
      return generateMockAiReply(prompt);
    }
    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.warn('Gemini API returned unexpected response, falling back to mock.', response.status, response.statusText, JSON.stringify(data));
      return generateMockAiReply(prompt);
    }

    const fullText = data.candidates[0].content.parts[0].text.trim();
    console.log(`[GEMINI_RESPONSE_LENGTH] ${fullText.length} chars`);
    return fullText;
  } catch (error) {
    console.error('Gemini AI generation failed:', error);
    return generateMockAiReply(prompt);
  }
};

const generateOpenAiText = async (prompt, apiKey) => {
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
        max_tokens: 1000,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.warn('OpenAI API request failed', response.status, response.statusText, data?.error?.message || JSON.stringify(data));
      return generateMockAiReply(prompt);
    }
    if (data?.error) {
      console.warn('OpenAI API returned error', data.error.message || JSON.stringify(data.error));
      return generateMockAiReply(prompt);
    }
    if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
      console.warn('AI API returned unexpected response, falling back to mock.', response.status, response.statusText, JSON.stringify(data));
      return generateMockAiReply(prompt);
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI AI generation failed:', error);
    return generateMockAiReply(prompt);
  }
};

const generateAiText = async (prompt) => {
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const openaiKey = (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  if (!geminiKey && !openaiKey) {
    console.warn('No AI API key found (GEMINI_API_KEY or AI_API_KEY); using mock fallback response.');
    return generateMockAiReply(prompt);
  }

  // Prefer Gemini if key is available
  if (geminiKey) {
    return generateGeminiText(prompt, geminiKey);
  }

  // Fall back to OpenAI
  return generateOpenAiText(prompt, openaiKey);
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
      markUserActive(user);
      broadcastSession();
      if (user.role !== 'agent') {
        scheduleAgentResponse({ eventType: 'user-joined', user });
      }
    }

    socket.emit('session-state', {
      id: session.id,
      createdAt: session.createdAt,
      users: session.users,
      events: session.events,
      chat: session.chat,
    });
  });

  socket.on('personal-prompt', async ({ text }) => {
    const user = findUser(socket.id);
    if (!user || typeof text !== 'string' || !text.trim()) return;

    markUserActive(user);
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
    console.log(`[SOCKET_EMIT_LENGTH] ${aiText.length} chars`);

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

    markUserActive(user);
    if (user.role !== 'agent') {
      scheduleAgentResponse({ eventType: 'shared-chat-message', user, text: chatMessage.text });
    }
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
