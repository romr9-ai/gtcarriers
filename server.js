import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json({ limit: "100kb" }));

// CORS: use ALLOWED_ORIGINS (comma-separated) or "*" for testing
const allowed = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (allowed.length === 1 && allowed[0] === "*") {
  app.use(cors({ origin: true }));
} else {
  app.use(cors({ origin: allowed }));
}

app.get("/health", (_req, res) => res.json({ ok: true }));

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function listFromEnv(name) {
  return (process.env[name] || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

app.post("/api/contact", async (req, res) => {
  try {
    const data = req.body || {};
    if (data._gotcha) return res.json({ ok: true }); // honeypot

    const required = ["name", "email", "origin", "destination"];
    const missing = required.filter(k => !data[k] || String(data[k]).trim() === "");
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });

    const SENDER_EMAIL = process.env.FROM_EMAIL;
    const SENDER_NAME = process.env.SENDER_NAME || "GT Carriers Inc";
    const CC_EMAILS = listFromEnv("CC_EMAILS");
    const BCC_EMAILS = listFromEnv("BCC_EMAILS");

    if (!process.env.SMTP2GO_API_KEY || !SENDER_EMAIL) {
      return res.status(500).json({ error: "Server not configured" });
    }

    const subject = `Rate Request: ${data.origin} \u2192 ${data.destination}`;
    const html = `
      <h2>Thanks for your request / Gracias por su solicitud</h2>
      <p><b>Name:</b> ${esc(data.name)}</p>
      <p><b>Company:</b> ${esc(data.company || "-")}</p>
      <p><b>Email:</b> ${esc(data.email)}</p>
      <p><b>Origin:</b> ${esc(data.origin)}</p>
      <p><b>Destination:</b> ${esc(data.destination)}</p>
      <hr/><p>Our team will contact you shortly.</p>
    `;
    const text =
      `Name: ${data.name}\n` +
      `Company: ${data.company || "-"}\n` +
      `Email: ${data.email}\n` +
      `Origin: ${data.origin}\n` +
      `Destination: ${data.destination}\n\n` +
      `Our team will contact you shortly.`;

    const payload = {
      api_key: process.env.SMTP2GO_API_KEY,
      to: [`${esc(data.name)} <${esc(data.email)}>`],
      sender: `${SENDER_NAME} <${SENDER_EMAIL}>`,
      subject,
      html_body: html,
      text_body: text,
      reply_to: `${esc(data.name)} <${esc(data.email)}>`
    };
    if (CC_EMAILS.length) payload.cc = CC_EMAILS;
    if (BCC_EMAILS.length) payload.bcc = BCC_EMAILS;

    const r = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));

    if (r.ok && j?.data?.succeeded === 1) return res.json({ ok: true });

    console.error("[smtp2go] status:", r.status, "body:", j);
    return res.status(502).json({ error: "Mail provider error", detail: j?.data || j });
  } catch (err) {
    console.error("[/api/contact ERROR]", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Serve the static site
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).end();
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Web+API listening on :${PORT}`));
