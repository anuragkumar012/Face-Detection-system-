const http = require("http");
const next = require("next");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const publicUrl = (process.env.NEXT_PUBLIC_FRONTEND_URL || "").trim().replace(/\/$/, "");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error("Request error:", err);
      res.statusCode = 500;
      res.end("Internal server error");
    }
  }).listen(port, hostname, () => {
    console.log(`> Local server ready on http://localhost:${port}`);
    if (publicUrl) {
      console.log(`> Public frontend URL ${publicUrl}`);
    }
  });
});
