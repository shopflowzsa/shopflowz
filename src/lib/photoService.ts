import { uploadTaskPhotoToCloudinary, getOptimizedImageUrl, getThumbnailUrl } from "@/lib/cloudinaryService";
import type { Task } from "@/types/crm";

/**
 * Firebase Storage service for uploading and managing photos
 * Ensures all photos are stored in cloud and synced across devices
 */

export interface PhotoUploadResult {
  url: string;
  path: string;
}

// ── Best format detection (runs once, cached) ────────────────────────────────
interface ImageFormat { mimeType: string; ext: string; quality: number }
let _bestFormat: ImageFormat | null = null;

function getBestFormat(): ImageFormat {
  if (_bestFormat) return _bestFormat;
  const canvas = document.createElement("canvas");
  canvas.width = 1; canvas.height = 1;
  // Try formats best → worst; fall back if the browser returns a JPEG/PNG instead
  const candidates: ImageFormat[] = [
    { mimeType: "image/avif",  ext: "avif", quality: 0.70 },
    { mimeType: "image/webp",  ext: "webp", quality: 0.78 },
    { mimeType: "image/jpeg",  ext: "jpg",  quality: 0.75 },
  ];
  for (const fmt of candidates) {
    const result = canvas.toDataURL(fmt.mimeType);
    if (result.startsWith(`data:${fmt.mimeType}`)) {
      _bestFormat = fmt;
      return fmt;
    }
  }
  _bestFormat = candidates[2];
  return _bestFormat;
}

/**
 * Compress a data URL using an HTML Canvas.
 * Resizes to at most maxWidth × maxHeight (maintaining aspect ratio) and
 * re-encodes using the best format the browser supports: AVIF → WebP → JPEG.
 * Returns both the compressed data URL and the chosen file extension.
 */
async function compressImage(
  dataUrl: string,
  maxWidth = 1200,
  maxHeight = 1600,
  overrideQuality?: number
): Promise<{ dataUrl: string; ext: string; mimeType: string }> {
  const fmt = getBestFormat();
  const quality = overrideQuality ?? fmt.quality;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ dataUrl, ext: "jpg", mimeType: "image/jpeg" });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL(fmt.mimeType, quality), ext: fmt.ext, mimeType: fmt.mimeType });
    };
    img.onerror = () => resolve({ dataUrl, ext: "jpg", mimeType: "image/jpeg" });
    img.src = dataUrl;
  });
}

/**
 * Upload a photo to Firebase Storage
 * @param dataUrl - Base64 data URL from camera/file picker
 * @param workspaceId - Current workspace ID
 * @param taskId - Task ID to associate with photo
 * @returns Firebase Storage download URL and storage path
 */
export async function uploadPhotoToFirebase(
  dataUrl: string,
  workspaceId: string,
  taskId: string
): Promise<PhotoUploadResult> {
  try {
    const { dataUrl: compressed } = await compressImage(dataUrl);
    const url = await uploadTaskPhotoToCloudinary(compressed, taskId);
    return { url, path: '' }; // path not needed for Cloudinary
  } catch (error) {
    console.error('Failed to upload photo:', error);
    throw new Error(`Photo upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload multiple photos to Firebase Storage
 * @param dataUrls - Array of base64 data URLs
 * @param workspaceId - Current workspace ID  
 * @param taskId - Task ID to associate with photos
 * @returns Array of Firebase Storage download URLs
 */
export async function uploadMultiplePhotosToFirebase(
  dataUrls: string[],
  workspaceId: string,
  taskId: string
): Promise<string[]> {
  try {
    const uploadPromises = dataUrls.map(dataUrl => 
      uploadPhotoToFirebase(dataUrl, workspaceId, taskId)
    );
    
    const results = await Promise.all(uploadPromises);
    const urls = results.map(result => result.url);
    
    return urls;
  } catch (error) {
    console.error('Failed to upload multiple photos:', error);
    throw error;
  }
}

/**
 * Upload a photo AND a tiny thumbnail (400×280, JPEG 35%) in parallel.
 * The thumbnail is stored in a /thumbs/ subfolder and used for board card previews.
 */
export async function uploadPhotoWithThumbnail(
  dataUrl: string,
  workspaceId: string,
  taskId: string
): Promise<{ url: string; thumbnailUrl: string }> {
  const { dataUrl: compressed } = await compressImage(dataUrl);
  const url = await uploadTaskPhotoToCloudinary(compressed, taskId);
  // Cloudinary generates thumbnails on-the-fly via URL transforms — no second upload needed
  const thumbnailUrl = getThumbnailUrl(url);
  return { url, thumbnailUrl };
}

/**
 * Upload multiple photos with thumbnails.
 * Returns separate arrays of full URLs and thumbnail URLs (same ordering).
 */
export async function uploadMultiplePhotosWithThumbnails(
  dataUrls: string[],
  workspaceId: string,
  taskId: string
): Promise<{ urls: string[]; thumbnailUrls: string[] }> {
  const results = await Promise.all(
    dataUrls.map(d => uploadPhotoWithThumbnail(d, workspaceId, taskId))
  );
  return {
    urls: results.map(r => r.url),
    thumbnailUrls: results.map(r => r.thumbnailUrl),
  };
}

/**
 * Delete a photo (no-op for Cloudinary URLs; Firebase Storage is no longer used)
 */
export async function deletePhotoFromFirebase(photoUrl: string): Promise<void> {
  // Cloudinary deletions are handled server-side; client cannot delete directly.
  // Firebase Storage is decommissioned — nothing to delete.
  console.log('deletePhotoFromFirebase: skipped (using Cloudinary)', photoUrl);
}

/**
 * Process data URLs and upload to Firebase Storage
 * This replaces local data URLs with Firebase Storage URLs for sync
 * @param dataUrls - Array of data URLs (base64 or existing Firebase URLs)  
 * @param workspaceId - Current workspace ID
 * @param taskId - Task ID to associate with photos
 * @returns Array of Firebase Storage URLs (existing URLs passed through, data URLs uploaded)
 */
export async function processPhotosForFirebaseSync(
  dataUrls: string[],
  workspaceId: string,
  taskId: string
): Promise<string[]> {
  if (!dataUrls || dataUrls.length === 0) return [];
  
  const processedUrls: string[] = [];
  
  for (const url of dataUrls) {
    if (url.startsWith('data:')) {
      // This is a base64 data URL - needs to be uploaded
      try {
        const result = await uploadPhotoToFirebase(url, workspaceId, taskId);
        processedUrls.push(result.url);
      } catch (error) {
        console.error('Failed to upload photo, keeping original:', error);
        processedUrls.push(url); // Keep original on failure
      }
    } else if (url.startsWith('http') && (url.includes('firebasestorage') || url.includes('cloudinary.com'))) {
      // Already a stored URL — keep as is
      processedUrls.push(url);
    } else {
      // Unknown URL format - keep as is but log warning
      console.warn('Unknown photo URL format:', url);
      processedUrls.push(url);
    }
  }
  
  return processedUrls;
}

/**
 * @deprecated Firebase Storage is decommissioned. This function is a no-op.
 */
async function recompressFirebasePhoto(
  _url: string,
  _workspaceId: string,
  _taskId: string
): Promise<{ url: string; savedBytes: number }> {
  throw new Error('Firebase Storage is no longer available. Photo migration is complete.');
}

export interface RecompressProgress {
  current: number;
  total: number;
  taskTitle: string;
  savedBytes: number; // cumulative bytes saved so far
}

/**
 * Re-download, compress, and re-upload all existing Firebase Storage photos across all tasks.
 * Calls onProgress after each photo is processed.
 * Returns the full updated task array (only tasks with photos are mutated).
 */
export async function recompressAllWorkspacePhotos(
  _workspaceId: string,
  tasks: Task[],
  _onProgress: (p: RecompressProgress) => void
): Promise<{ tasks: Task[]; totalSavedBytes: number }> {
  // Firebase Storage is decommissioned — all photos are now on Cloudinary.
  // Return tasks unchanged.
  console.log('[recompress] Firebase Storage decommissioned — skipping migration.');
  return { tasks, totalSavedBytes: 0 };
}