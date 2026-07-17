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
  if (!cachedDb) {
    throw new Error("Database is not connected. Check your MONGODB_URI and ensure MongoDB is running.")
  }
  return cachedDb
}

function getCarsCollection(): Collection {
  return getDb().collection("cars")
}

function getCartCollection(): Collection {
  return getDb().collection("cart")
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
  
  const token = authHeader.slice(7)
  
  // Quick fallback for better-auth / development without JWT signing
  if (token.startsWith("user_")) {
    ;(req as any).user = { sub: token.replace("user_", "") }
    return next()
  }

  verifyToken(token)
    .then((payload) => {
      ; (req as any).user = payload
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

interface ValidationResult<T = CarBody> {
  valid: boolean
  errors: string[]
  data?: T
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

interface CartBody {
  carId: string
  quantity: number
}

function validateCartBody(body: Record<string, unknown>): ValidationResult<CartBody> {
  const errors: string[] = []

  if (!body.carId || typeof body.carId !== "string" || body.carId.trim().length === 0) {
    errors.push("carId is required and must be a non-empty string")
  }
  if (body.quantity != null && (typeof body.quantity !== "number" || body.quantity < 1)) {
    errors.push("quantity must be a positive number")
  }

  if (errors.length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: [],
    data: {
      carId: (body.carId as string).trim(),
      quantity: (body.quantity as number) || 1,
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
// 7. Core Feature: Cars API (GET & POST)
// ──────────────────────────────────────────────

app.get("/api/cars", async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "8", category, maxPrice, search, sort = "newest" } = req.query

    const pageNum = Math.max(1, parseInt(page as string, 10))
    const limitNum = Math.max(1, parseInt(limit as string, 10))
    const skip = (pageNum - 1) * limitNum

    // Build Query
    const query: Record<string, any> = {}
    
    if (category && category !== "All Categories") {
      query.category = category
    }
    
    if (maxPrice) {
      query.price = { $lte: parseInt(maxPrice as string, 10) }
    }
    
    if (search) {
      query.title = { $regex: search as string, $options: "i" }
    }

    // Build Sort
    let sortQuery: Record<string, 1 | -1> = { createdAt: -1 } // newest by default
    if (sort === "price-asc") sortQuery = { price: 1 }
    else if (sort === "price-desc") sortQuery = { price: -1 }

    const collection = getCarsCollection()
    
    const [cars, totalCars] = await Promise.all([
      collection.find(query).sort(sortQuery).skip(skip).limit(limitNum).toArray(),
      collection.countDocuments(query)
    ])

    const totalPages = Math.ceil(totalCars / limitNum)

    sendSuccess(res, {
      cars,
      pagination: {
        totalCars,
        totalPages,
        currentPage: pageNum,
        limit: limitNum
      }
    })
  } catch (err) {
    console.error("[GET /api/cars] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

app.post("/api/cars", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const validation = validateCarBody(req.body)

    if (!validation.valid) {
      sendError(res, validation.errors.join("; "), 400)
      return
    }

    const doc = {
      ...validation.data!,
      userId: user.sub,
      createdAt: new Date(),
    }

    const result = await getCarsCollection().insertOne(doc)

    sendSuccess(res, { insertedId: result.insertedId, car: doc }, 201)
  } catch (err) {
    console.error("[POST /api/cars] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

app.get("/api/users/me/cars", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const cars = await getCarsCollection().find({ userId: user.sub }).sort({ createdAt: -1 }).toArray()
    sendSuccess(res, cars)
  } catch (err) {
    console.error("[GET /api/users/me/cars] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

app.get("/api/cars/trending", async (req: Request, res: Response) => {
  try {
    // Trending: For now, just newest cars limited to 8
    const cars = await getCarsCollection().find({}).sort({ createdAt: -1 }).limit(8).toArray()
    sendSuccess(res, cars)
  } catch (err) {
    console.error("[GET /api/cars/trending] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

app.post("/api/cart", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const validation = validateCartBody(req.body)

    if (!validation.valid) {
      sendError(res, validation.errors.join("; "), 400)
      return
    }

    const doc = {
      userId: user.sub,
      carId: validation.data!.carId,
      quantity: validation.data!.quantity,
      createdAt: new Date(),
    }

    const result = await getCartCollection().insertOne(doc)
    sendSuccess(res, { insertedId: result.insertedId, item: doc }, 201)
  } catch (err) {
    console.error("[POST /api/cart] Error:", err)
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
  app.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════════╗`)
    console.log(`║      MOTORA API Server is RUNNING           ║`)
    console.log(`║      Port: ${PORT}                          ║`)
    console.log(`║      URL : http://localhost:${PORT}                 ║`)
    console.log(`║      Health: http://localhost:${PORT}/api/health    ║`)
    console.log(`╚══════════════════════════════════════════════╝`)
  })

  try {
    await connectDatabase()
    console.log(`[DB] MongoDB connected successfully`)
  } catch (err) {
    console.warn(`[DB] Warning: MongoDB not available — server is running but DB features will fail`)
    console.warn(`[DB] Make sure MONGODB_URI is set correctly in .env`)
  }
}

start()

export { connectDatabase, getDb, getCarsCollection, authMiddleware, verifyToken, app }
