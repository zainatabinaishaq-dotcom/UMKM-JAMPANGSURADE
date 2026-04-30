export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { origin, destination, weight, courier } = req.body;

  try {
    const response = await fetch("https://api.rajaongkir.com/starter/cost", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        key: process.env.RAJAONGKIR_API_KEY,
      },
      body: new URLSearchParams({
        origin,
        destination,
        weight,
        courier,
      }),
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ message: "Gagal mengambil ongkir" });
  }
}
