export async function uploadImageToCloudinary(file) {
  if (!file) throw new Error("File belum dipilih");

  const allowed = ["image/jpeg", "image/png", "image/webp"];

  if (!allowed.includes(file.type)) {
    throw new Error("Format gambar harus JPG, PNG, atau WEBP");
  }

  if (file.size > 1024 * 1024) {
    throw new Error("Ukuran gambar maksimal 1MB");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      body: formData
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Upload gambar gagal");
  }

  return data.secure_url;
}
