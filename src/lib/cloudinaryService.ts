/**
 * Cloudinary Image Upload Service
 * Handles image uploads to Cloudinary for inventory products
 */

// Cloudinary Configuration — set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in .env
const CLOUDINARY_CLOUD_NAME =
  (import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string) || 'dwf64gbea';
const CLOUDINARY_UPLOAD_PRESET =
  (import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string) || 'shopflowz_uploads';

/**
 * Compress a File using canvas before uploading.
 * Resizes to at most 1200×1200 and encodes as WebP (or JPEG fallback).
 * This cuts upload size and Cloudinary storage quota significantly.
 */
async function compressFileForUpload(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const MAX = 1200;
      const scale = Math.min(1, MAX / img.width, MAX / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);

      // Try WebP first, fall back to JPEG
      const mimeType = canvas.toDataURL('image/webp').startsWith('data:image/webp')
        ? 'image/webp' : 'image/jpeg';
      const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${ext}`, { type: mimeType });
          resolve(compressed);
        },
        mimeType,
        0.80
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}

/**
 * Upload a task photo from a data URL to Cloudinary.
 * Compresses first, then uploads to the tasks/{taskId} folder.
 * Returns a Cloudinary secure_url (CDN-served, no auth token needed).
 */
export async function uploadTaskPhotoToCloudinary(
  dataUrl: string,
  taskId: string
): Promise<string> {
  // Convert data URL → Blob → File
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/avif' ? 'avif' : 'jpg';
  const file = new File([blob], `photo_${Date.now()}.${ext}`, { type: blob.type });
  return uploadImageToCloudinary(file, `tasks/${taskId}`);
}

/**
 * Upload image to Cloudinary
 * @param file - The image file to upload
 * @param folder - Optional folder path in Cloudinary
 * @returns Promise with the secure URL of uploaded image
 */
export async function uploadImageToCloudinary(
  file: File,
  folder: string = 'inventory'
): Promise<string> {
  // Compress before uploading to save Cloudinary storage & bandwidth
  const compressed = await compressFileForUpload(file);

  const formData = new FormData();
  formData.append('file', compressed);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', folder);

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to upload image to Cloudinary');
    }

    const data = await response.json();
    return data.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Image upload failed. Please try again.');
  }
}

/**
 * Delete image from Cloudinary
 * @param publicId - The public ID of the image to delete
 * Note: This requires server-side implementation or signed deletion
 */
export async function deleteImageFromCloudinary(imageUrl: string): Promise<void> {
  // Extract public_id from URL
  // Note: Deletion from browser is not recommended for security
  // This should be done server-side
  console.warn('Image deletion should be handled server-side for security');
}

/**
 * Get optimized image URL with transformations
 * @param url - Original Cloudinary URL
 * @param width - Target width
 * @param height - Target height
 * @returns Transformed URL
 */
export function getOptimizedImageUrl(
  url: string,
  width: number = 400,
  height: number = 400
): string {
  if (!url || !url.includes('cloudinary.com')) {
    return url;
  }

  // Insert transformation parameters into URL
  const parts = url.split('/upload/');
  if (parts.length === 2) {
    return `${parts[0]}/upload/w_${width},h_${height},c_fill,q_auto,f_auto/${parts[1]}`;
  }

  return url;
}

/**
 * Get thumbnail URL
 * @param url - Original Cloudinary URL
 * @returns Thumbnail URL (150x150)
 */
export function getThumbnailUrl(url: string): string {
  return getOptimizedImageUrl(url, 150, 150);
}
