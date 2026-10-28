import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Find .env file in current directory or backend root
const backendEnvPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else {
  dotenv.config();
}

export const ENV = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  JWT_SECRET: process.env.JWT_SECRET || 'dls_beautybasket_secret_key_change_in_production_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  USE_DATABASE: process.env.USE_DATABASE === 'true',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/dls_beautybasket',
  UPLOAD_DIR: path.resolve(__dirname, '../../uploads'),
};
