# AI Collaboration MVP

A minimal full-stack JavaScript app using Vite, React, Tailwind CSS, Express, and Socket.io for real-time multi-user syncing.

Features:

- Independent personal AI chat windows per user
- Shared session tether with user presence, chat, and activity feed
- Pop-out tether panel with docking and auto-open settings
- AI agent login with ability to request session summaries

## Available scripts

- `npm run dev` - start the frontend dev server and backend server together
- `npm run dev:client` - start the Vite frontend only
- `npm run dev:server` - start the Express + Socket.io backend only
- `npm run build` - build the frontend for production
- `npm run preview` - preview the production build locally
- `npm start` - start the backend server in production mode

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the example env file and update values as needed:
   ```bash
   cp .env.example .env
   ```
3. Start the app:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:5173` in the browser.

## Environment variables

- `PORT` controls the Express backend port.
- `VITE_API_URL` controls the frontend Socket.io backend URL for deployment.

## Project structure

- `src/` - React frontend code
- `server/` - Express + Socket.io backend
- `vite.config.js` - Vite configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `postcss.config.js` - PostCSS configuration
