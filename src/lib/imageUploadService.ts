/**
 * Image Upload Service — routes inventory images to Cloudinary
 */

import { uploadImageToCloudinary, deleteImageFromCloudinary } from './cloudinaryService';

export async function uploadInventoryImage(
  workspaceId: string,
  itemId: string,
  file: File
): Promise<string> {
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.');
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error('File size exceeds 5MB limit.');
  }

  return uploadImageToCloudinary(file, `inventory/${workspaceId}/${itemId}`);
}

export async function deleteInventoryImage(imageUrl: string): Promise<void> {
  await deleteImageFromCloudinary(imageUrl);
}

export async function uploadMultipleImages(
  workspaceId: string,
  itemId: string,
  files: FileList | File[]
): Promise<string[]> {
  const uploads = Array.from(files).map(file =>
    uploadInventoryImage(workspaceId, itemId, file)
  );
  return Promise.all(uploads);
}
