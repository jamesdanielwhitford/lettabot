/**
 * Lightweight multipart/form-data parser for file uploads
 * Stream-based to avoid memory issues with large files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { IncomingMessage } from 'http';

export interface MultipartFile {
  fieldName: string;
  filename: string;
  mimeType: string;
  tempPath: string;
}

export interface MultipartFields {
  [key: string]: string;
}

export interface MultipartResult {
  fields: MultipartFields;
  files: MultipartFile[];
}

/**
 * Parse multipart/form-data from HTTP request
 * @param req - Incoming HTTP request
 * @param maxFileSize - Maximum file size in bytes (default 50MB)
 * @returns Parsed fields and files
 */
export async function parseMultipart(
  req: IncomingMessage,
  maxFileSize: number = 50 * 1024 * 1024
): Promise<MultipartResult> {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    throw new Error('Content-Type must be multipart/form-data');
  }

  // Extract boundary from content-type header
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) {
    throw new Error('Missing boundary in multipart/form-data');
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBoundaryBuffer = Buffer.from(`--${boundary}--`);

  const fields: MultipartFields = {};
  const files: MultipartFile[] = [];

  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let currentPart: {
      headers: Record<string, string>;
      fieldName?: string;
      filename?: string;
      mimeType?: string;
      fileStream?: fs.WriteStream;
      tempPath?: string;
      fileSize: number;
      isFile: boolean;
      data: Buffer;
    } | null = null;

    const cleanup = () => {
      if (currentPart?.fileStream) {
        currentPart.fileStream.close();
      }
      // Clean up any partial files
      files.forEach(file => {
        try {
          if (fs.existsSync(file.tempPath)) {
            fs.unlinkSync(file.tempPath);
          }
        } catch {}
      });
    };

    req.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Process buffer for parts
      let boundaryIndex: number;
      while ((boundaryIndex = buffer.indexOf(boundaryBuffer)) !== -1) {
        // Check if this is the end boundary
        const isEndBoundary = buffer.indexOf(endBoundaryBuffer) === boundaryIndex;

        if (currentPart) {
          // Save current part data (everything before boundary)
          const partData = buffer.slice(0, boundaryIndex - 2); // -2 for \r\n before boundary

          if (currentPart.isFile && currentPart.fileStream) {
            // Write to file
            currentPart.fileStream.write(partData);
            currentPart.fileSize += partData.length;

            if (currentPart.fileSize > maxFileSize) {
              cleanup();
              reject(new Error(`File too large (max ${maxFileSize} bytes)`));
              return;
            }

            // Close file stream
            currentPart.fileStream.end();

            if (currentPart.fieldName && currentPart.filename && currentPart.tempPath) {
              files.push({
                fieldName: currentPart.fieldName,
                filename: currentPart.filename,
                mimeType: currentPart.mimeType || 'application/octet-stream',
                tempPath: currentPart.tempPath,
              });
            }
          } else {
            // Store as field
            currentPart.data = Buffer.concat([currentPart.data, partData]);
            if (currentPart.fieldName) {
              fields[currentPart.fieldName] = currentPart.data.toString('utf-8');
            }
          }

          currentPart = null;
        }

        // Move buffer past boundary
        if (isEndBoundary) {
          // Finished parsing
          resolve({ fields, files });
          return;
        }

        buffer = buffer.slice(boundaryIndex + boundaryBuffer.length);

        // Parse headers for next part
        const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) {
          // Need more data
          break;
        }

        const headerSection = buffer.slice(0, headerEnd).toString('utf-8');
        const headers: Record<string, string> = {};

        headerSection.split('\r\n').forEach(line => {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim().toLowerCase();
            const value = line.slice(colonIndex + 1).trim();
            headers[key] = value;
          }
        });

        // Parse Content-Disposition header
        const disposition = headers['content-disposition'];
        if (!disposition) {
          reject(new Error('Missing Content-Disposition header'));
          return;
        }

        const nameMatch = disposition.match(/name="([^"]+)"/);
        const filenameMatch = disposition.match(/filename="([^"]+)"/);
        const fieldName = nameMatch ? nameMatch[1] : undefined;
        const filename = filenameMatch ? sanitizeFilename(filenameMatch[1]) : undefined;
        const mimeType = headers['content-type'] || 'application/octet-stream';

        currentPart = {
          headers,
          fieldName,
          filename,
          mimeType,
          fileSize: 0,
          isFile: !!filename,
          data: Buffer.alloc(0),
        };

        // If this is a file, create temp file stream
        if (currentPart.isFile && currentPart.filename) {
          const tempPath = path.join(
            os.tmpdir(),
            `lettabot-upload-${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${currentPart.filename}`
          );
          currentPart.tempPath = tempPath;
          currentPart.fileStream = fs.createWriteStream(tempPath);

          currentPart.fileStream.on('error', (err) => {
            cleanup();
            reject(err);
          });
        }

        // Move buffer past headers
        buffer = buffer.slice(headerEnd + 4); // +4 for \r\n\r\n
      }
    });

    req.on('end', () => {
      // If we have remaining data in current part, save it
      if (currentPart) {
        if (currentPart.isFile && currentPart.fileStream) {
          currentPart.fileStream.write(buffer);
          currentPart.fileStream.end();

          if (currentPart.fieldName && currentPart.filename && currentPart.tempPath) {
            files.push({
              fieldName: currentPart.fieldName,
              filename: currentPart.filename,
              mimeType: currentPart.mimeType || 'application/octet-stream',
              tempPath: currentPart.tempPath,
            });
          }
        } else {
          currentPart.data = Buffer.concat([currentPart.data, buffer]);
          if (currentPart.fieldName) {
            fields[currentPart.fieldName] = currentPart.data.toString('utf-8');
          }
        }
      }

      resolve({ fields, files });
    });

    req.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * Sanitize filename to prevent path traversal and remove special characters
 */
function sanitizeFilename(filename: string): string {
  // Remove path components
  const basename = path.basename(filename);

  // Remove or replace special characters
  return basename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 255); // Limit length
}
