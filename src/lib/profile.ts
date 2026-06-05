// Profile editing: update the favorite role, and crop/resize + upload a
// profile photo to Supabase Storage.

import { supabase } from "./supabase";

const AVATAR_SIZE = 256; // square avatars, in px

// Update the current user's profile fields (only the ones provided).
export async function updateProfile(fields: {
  favorite_role?: string | null;
  avatar_url?: string | null;
  featured_badges?: string[];
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("profiles")
    .update(fields)
    .eq("id", user.id);
  if (error) throw error;
}

// Center-crop an image File to a square and scale it down to AVATAR_SIZE.
// Returns a PNG Blob. Runs entirely in the browser (canvas) — no server
// processing needed.
export async function cropToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not process the image.")),
      "image/png"
    );
  });
}

// Crop/resize, upload to the user's avatar folder, save the public URL on
// their profile, and return that URL. A ?v=<time> cache-buster forces the
// browser to fetch the new image even though the storage path is fixed.
export async function uploadAvatar(file: File): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const blob = await cropToSquare(file);
  const path = `${user.id}/avatar.png`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { upsert: true, contentType: "image/png" });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);
  const url = `${publicUrl}?v=${Date.now()}`;

  await updateProfile({ avatar_url: url });
  return url;
}
