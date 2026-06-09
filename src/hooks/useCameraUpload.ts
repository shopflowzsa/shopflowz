import { useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { processPhotosForFirebaseSync, uploadMultiplePhotosWithThumbnails } from "@/lib/photoService";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Cross-platform photo picker with Firebase Storage integration.
 * - On Android/iOS (Capacitor native): uses the Camera plugin for proper
 *   permissions handling and native UI.
 * - On web/desktop: falls back to standard <input type="file"> approach.
 * - All photos are automatically uploaded to Firebase Storage for sync
 */
export function useCameraUpload(
  onPhotos: (urls: string[], thumbnailUrls?: string[]) => void,
  taskId?: string
) {
  const { workspaceId } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const isNative = Capacitor.isNativePlatform();

  /** Take a photo using the device camera. */
  const takePhoto = useCallback(async () => {
    if (!workspaceId || !taskId) {
      console.error('Cannot take photo: missing workspaceId or taskId');
      return;
    }
    
    if (isNative) {
      try {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          quality: 80,
          allowEditing: false,
          saveToGallery: false,
        });
        if (photo.dataUrl) {
          // Upload to Firebase Storage immediately
          try {
            const { urls: firebaseUrls, thumbnailUrls } = await uploadMultiplePhotosWithThumbnails(
              [photo.dataUrl], 
              workspaceId, 
              taskId
            );
            onPhotos(firebaseUrls, thumbnailUrls);
          } catch (error) {
            console.error('Failed to upload photo to Firebase:', error);
            // Fallback: use data URL (will be processed later)
            onPhotos([photo.dataUrl]);
          }
        }
      } catch (err) {
        // User cancelled or permission denied — silently ignore
        console.warn("Camera cancelled:", err);
      }
    } else {
      // Web fallback: file input with camera capture
      cameraInputRef.current?.click();
    }
  }, [isNative, workspaceId, taskId, onPhotos]);

  /** Pick one or more images from the gallery / file system. */
  const pickFromGallery = useCallback(async () => {
    if (!workspaceId || !taskId) {
      console.error('Cannot pick photos: missing workspaceId or taskId');
      return;
    }
    
    if (isNative) {
      try {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Photos,
          quality: 80,
          allowEditing: false,
        });
        if (photo.dataUrl) {
          // Upload to Firebase Storage immediately
          try {
            const { urls: firebaseUrls, thumbnailUrls } = await uploadMultiplePhotosWithThumbnails(
              [photo.dataUrl], 
              workspaceId, 
              taskId
            );
            onPhotos(firebaseUrls, thumbnailUrls);
          } catch (error) {
            console.error('Failed to upload photo to Firebase:', error);
            onPhotos([photo.dataUrl]);
          }
        }
      } catch (err) {
        console.warn("Gallery cancelled:", err);
      }
    } else {
      // Web fallback: standard file picker
      fileInputRef.current?.click();
    }
  }, [isNative, workspaceId, taskId, onPhotos]);

  /** Handler for the fallback <input type="file"> elements. */
  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !workspaceId || !taskId) return;

      const results: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`Failed to read: ${file.name}`));
          reader.readAsDataURL(file);
        }).catch(() => null);
        if (dataUrl) results.push(dataUrl);
      }

      if (results.length > 0) {
        // Upload to Firebase Storage immediately
        try {
          const { urls: firebaseUrls, thumbnailUrls } = await uploadMultiplePhotosWithThumbnails(
            results, 
            workspaceId, 
            taskId
          );
          onPhotos(firebaseUrls, thumbnailUrls);
        } catch (error) {
          console.error('Failed to upload photos to Firebase:', error);
          // Fallback: use data URLs (will be processed later)
          onPhotos(results);
        }
      }
      
      // Reset so the same file can be re-selected later
      if (e.target) e.target.value = "";
    },
    [onPhotos]
  );

  return { takePhoto, pickFromGallery, handleFileInputChange, fileInputRef, cameraInputRef, isNative };
}
