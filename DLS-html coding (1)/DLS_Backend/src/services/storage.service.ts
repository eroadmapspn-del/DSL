import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ENV } from '../config/env.js';
import { memoryStore } from '../db/index.js';

export class StorageService {
  static ensureUploadDir() {
    if (!fs.existsSync(ENV.UPLOAD_DIR)) {
      fs.mkdirSync(ENV.UPLOAD_DIR, { recursive: true });
    }
  }

  static async uploadBase64(bucket: string, filePath: string, base64Data: string, contentType?: string) {
    this.ensureUploadDir();

    const sanitizedPath = filePath.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const localFileName = `${Date.now()}_${sanitizedPath}`;
    const fullPath = path.join(ENV.UPLOAD_DIR, localFileName);

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(fullPath, buffer);

    const photoUrl = `/uploads/${localFileName}`;

    // Record in bill_photos table
    const photoRecord = {
      id: uuidv4(),
      bill_number: filePath.split('/')[0] || 'GENERAL',
      bill_type: bucket,
      photo_url: photoUrl,
      photo_name: sanitizedPath,
      storage_path: fullPath,
      file_size: buffer.length,
      file_type: contentType || 'image/jpeg',
      uploaded_at: new Date().toISOString(),
      is_active: true
    };

    memoryStore.tables['bill_photos'] = memoryStore.tables['bill_photos'] || [];
    memoryStore.tables['bill_photos'].push(photoRecord);

    return {
      Key: `${bucket}/${filePath}`,
      url: photoUrl,
      publicUrl: photoUrl
    };
  }
}
