import express, { Request, Response, NextFunction } from "express"
import cors from "cors"
import dotenv from "dotenv"
import { MongoClient, Db, Collection } from "mongodb"
import * as jose from "jose-cjs"

dotenv.config()

// ──────────────────────────────────────────────
// 1. Configuration & Constants
// ──────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "4000", 10)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/motora"
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret"

// ──────────────────────────────────────────────
// 2. Singleton MongoDB Connection
// ──────────────────────────────────────────────

let cachedDb: Db | null = null

async function connectDatabase(): Promise<Db> {
  if (cachedDb) return cachedDb
  const client = await new MongoClient(MONGODB_URI).connect()
  cachedDb = client.db()
  console.log(`[DB] Connected to MongoDB — database: "${cachedDb.databaseName}"`)
  return cachedDb
}

function getDb(): Db {
  if (!cachedDb) throw new Error("Database not initialized. Call connectDatabase() first.")
  return cachedDb
}

function getCarsCollection(): Collection {
  return getDb().collection("cars")
}

// ──────────────────────────────────────────────
// 3. Jose-CJS JWT Middleware (future-ready)
// ──────────────────────────────────────────────

const jwks = jose.createLocalJWKSet({
  keys: [
    {
      kty: "oct",
      k: jose.base64url.encode(Buffer.from(JWT_SECRET)),
    },
  ],
})

async function verifyToken(token: string): Promise<jose.JWTPayload> {
  const { payload } = await jose.jwtVerify(token, jwks)
  return payload
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed authorization header" })
    return
  }
  verifyToken(authHeader.slice(7))
    .then((payload) => {
      ;(req as any).user = payload
      next()
    })
    .catch(() => {
      res.status(401).json({ error: "Invalid or expired token" })
    })
}

// ──────────────────────────────────────────────
// 4. Reusable Validation Utility
// ──────────────────────────────────────────────

interface CarBody {
  title: string
  shortDescription: string
  fullDescription: string
  price: number
  category: string
  images: string[]
  aiTags: string[]
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  data?: CarBody
}

function validateCarBody(body: Record<string, unknown>): ValidationResult {
  const errors: string[] = []

  if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
    errors.push("title is required and must be a non-empty string")
  }
  if (!body.shortDescription || typeof body.shortDescription !== "string") {
    errors.push("shortDescription is required and must be a string")
  }
  if (!body.fullDescription || typeof body.fullDescription !== "string") {
    errors.push("fullDescription is required and must be a string")
  }
  if (body.price == null || typeof body.price !== "number" || body.price <= 0) {
    errors.push("price is required and must be a positive number")
  }
  if (!body.category || typeof body.category !== "string" || body.category.trim().length === 0) {
    errors.push("category is required and must be a non-empty string")
  }
  if (!Array.isArray(body.images)) {
    errors.push("images is required and must be an array of strings")
  }
  if (!Array.isArray(body.aiTags)) {
    errors.push("aiTags is required and must be an array of strings")
  }

  if (errors.length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: [],
    data: {
      title: (body.title as string).trim(),
      shortDescription: body.shortDescription as string,
      fullDescription: body.fullDescription as string,
      price: body.price as number,
      category: body.category as string,
      images: body.images as string[],
      aiTags: body.aiTags as string[],
    },
  }
}

// ──────────────────────────────────────────────
// 5. Reusable Response Helpers
// ──────────────────────────────────────────────

function sendSuccess(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data })
}

function sendError(res: Response, message: string, status = 500): void {
  res.status(status).json({ success: false, error: message })
}

// ──────────────────────────────────────────────
// 6. Express App Setup
// ──────────────────────────────────────────────

const app = express()

app.use(cors())
app.use(express.json({ limit: "10mb" }))

// Health check
app.get("/api/health", (_req: Request, res: Response) => {
  sendSuccess(res, { status: "ok", timestamp: new Date().toISOString() })
})

// ──────────────────────────────────────────────
// 7. Core Feature: POST /api/cars
// ──────────────────────────────────────────────

app.post("/api/cars", async (req: Request, res: Response) => {
  try {
    const validation = validateCarBody(req.body)

    if (!validation.valid) {
      sendError(res, validation.errors.join("; "), 400)
      return
    }

    const doc = {
      ...validation.data!,
      createdAt: new Date(),
    }

    const result = await getCarsCollection().insertOne(doc)

    sendSuccess(res, { insertedId: result.insertedId, car: doc }, 201)
  } catch (err) {
    console.error("[POST /api/cars] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

// ──────────────────────────────────────────────
// 8. Global Error Handler
// ──────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Unhandled Error]", err)
  sendError(res, "Internal server error", 500)
})

// ──────────────────────────────────────────────
// 9. Start Server
// ──────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    await connectDatabase()
    app.listen(PORT, () => {
      console.log(`[Server] MOTORA API running → http://localhost:${PORT}`)
      console.log(`[Server] Health check → http://localhost:${PORT}/api/health`)
    })
  } catch (err) {
    console.error("[Server] Failed to start:", err)
    process.exit(1)
  }
}

start()

export { connectDatabase, getDb, getCarsCollection, authMiddleware, verifyToken, app }
