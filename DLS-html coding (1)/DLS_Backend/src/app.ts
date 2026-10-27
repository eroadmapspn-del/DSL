import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { ENV } from './config/env.js';
import apiRouter from './routes/index.js';
import { errorHandler } from './middlewares/error.middleware.js';

export const app = express();

// Ensure uploads folder exists
if (!fs.existsSync(ENV.UPLOAD_DIR)) {
  fs.mkdirSync(ENV.UPLOAD_DIR, { recursive: true });
}

// 1. CORS Configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'apikey', 'X-Client-Info']
}));

// 2. Request Logging
if (ENV.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// 3. Body Parsers (Support large payloads, json, text/plain from browser shims)
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: ['text/*', 'application/json'], limit: '50mb' }));
app.use((req, _res, next) => {
  if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {
      // not json string
    }
  }
  next();
});
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 4. Static Files (Uploaded photos)
app.use('/uploads', express.static(ENV.UPLOAD_DIR));

// 5. API Routes
app.use('/api', apiRouter);

// 6. Direct compatibility routes for legacy frontend shims
// If frontend requests directly without /api prefix
app.use('/', apiRouter);

// 7. Error Handling
app.use(errorHandler);

export default app;
