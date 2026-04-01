import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "./server";

let appPromise: ReturnType<typeof createApp> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = createApp();
  }
  return appPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error("[vercel handler]", error);
    return res.status(500).json({ error: message });
  }
}
