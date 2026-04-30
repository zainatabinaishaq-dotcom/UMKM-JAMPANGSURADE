export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.rajaongkir.com/starter/city", {
      headers: {
        key: process.env.RAJAONGKIR_API_KEY,
      },
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ message: "Gagal mengambil data kota" });
  }
}
