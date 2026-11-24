# ChatApp

Real-time room chat built with Express, Socket.IO, MongoDB Atlas, JWT and a responsive HTML/CSS/JavaScript client.

## Features
- Account signup/signin with hashed passwords and JWT sessions
- Authenticated Socket.IO connections
- Room-based real-time messages and MongoDB history
- Editable profile: display name, bio, location and profile picture URL
- Logout and session-expiry handling

## Run locally
1. Install Node.js 18+ (20+ recommended).
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a long random `JWT_SECRET`. Keep `.env` private.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:8080/client.html`. Do not use VS Code Live Server for this app.

## Profile picture note
Profile pictures are currently stored as HTTPS image URLs, not uploaded files. For production image uploads, integrate a storage provider such as Cloudinary or S3 and validate uploaded content.

## Deployment
Deploy the Node.js app to a host that supports persistent HTTP/WebSocket connections (for example Render or Railway), configure `MONGODB_URI`, `JWT_SECRET`, and `PORT` as environment variables, and allow the deployment host in MongoDB Atlas network access. Never commit `.env`.

## Before public launch
Add rate limiting to authentication routes, email verification/password reset, stricter image-host validation, and production logging/monitoring.
