import express, { Request, Response, NextFunction } from "express"
import cors from "cors"
import dotenv from "dotenv"
import { MongoClient, Db, Collection, ObjectId } from "mongodb"
import * as jose from "jose-cjs"
import Stripe from "stripe"

dotenv.config()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_mock", {
  apiVersion: "2025-02-24.acacia" as any,
})

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

function getPaymentsCollection(): Collection {
  return getDb().collection("payments")
}

function getUsersCollection(): Collection {
  return getDb().collection("users")
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

import { aiRoutes } from "./routes/aiRoutes"

// Health check
app.get("/api/health", (_req: Request, res: Response) => {
  sendSuccess(res, { status: "ok", timestamp: new Date().toISOString() })
})

// AI Routes
app.use("/api/ai", aiRoutes)

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

app.get("/api/cars/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      sendError(res, "Invalid car ID format", 400)
      return
    }

    const collection = getCarsCollection()
    const car = await collection.findOne({ _id: new ObjectId(id) })

    if (!car) {
      sendError(res, "Car not found", 404)
      return
    }

    sendSuccess(res, car)
  } catch (err) {
    console.error("[GET /api/cars/:id] Error:", err)
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
    const { page = "1", limit = "8" } = req.query
    
    const pageNum = Math.max(1, parseInt(page as string, 10))
    const limitNum = Math.max(1, parseInt(limit as string, 10))
    const skip = (pageNum - 1) * limitNum

    const collection = getCarsCollection()
    
    const [cars, totalCars] = await Promise.all([
      collection.find({ userId: user.sub }).sort({ createdAt: -1 }).skip(skip).limit(limitNum).toArray(),
      collection.countDocuments({ userId: user.sub })
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
// Stripe Payments & User Stats Routes
// ──────────────────────────────────────────────

app.post("/api/create-checkout-session", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const { carId } = req.body

    if (!ObjectId.isValid(carId)) {
      sendError(res, "Invalid car ID", 400)
      return
    }

    const car = await getCarsCollection().findOne({ _id: new ObjectId(carId) })
    if (!car) {
      sendError(res, "Car not found", 404)
      return
    }

    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000"

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: car.title,
              description: car.shortDescription,
              images: car.images && car.images.length > 0 ? [car.images[0]] : [],
            },
            unit_amount: Math.round(car.price * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancel`,
      metadata: {
        userId: user.sub,
        carId: car._id.toString(),
      }
    })

    sendSuccess(res, { url: session.url })
  } catch (err) {
    console.error("[POST /api/create-checkout-session] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

app.get("/api/payments/verify", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const { session_id } = req.query

    if (!session_id || typeof session_id !== "string") {
      sendError(res, "Missing session_id", 400)
      return
    }

    const session = await stripe.checkout.sessions.retrieve(session_id)
    
    if (session.payment_status === "paid") {
      const paymentsCollection = getPaymentsCollection()
      const carId = session.metadata?.carId

      // Check if payment already exists to prevent duplicate entries on reload
      const existingPayment = await paymentsCollection.findOne({ stripeSessionId: session.id })
      if (!existingPayment) {
        await paymentsCollection.insertOne({
          userId: user.sub,
          stripeSessionId: session.id,
          amount: (session.amount_total || 0) / 100, // convert back from cents
          currency: session.currency,
          carId: carId,
          status: session.payment_status,
          createdAt: new Date()
        })
      }
      sendSuccess(res, { message: "Payment verified successfully" })
    } else {
      sendError(res, "Payment not completed", 400)
    }
  } catch (err) {
    console.error("[GET /api/payments/verify] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

app.get("/api/users/me/payments", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const payments = await getPaymentsCollection().find({ userId: user.sub }).sort({ createdAt: -1 }).toArray()
    sendSuccess(res, payments)
  } catch (err) {
    console.error("[GET /api/users/me/payments] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

app.get("/api/users/me/stats", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    
    const [carsCount, payments] = await Promise.all([
      getCarsCollection().countDocuments({ userId: user.sub }),
      getPaymentsCollection().find({ userId: user.sub }).toArray()
    ])

    const totalSpent = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0)

    sendSuccess(res, {
      totalCarsListed: carsCount,
      totalPaymentsMade: payments.length,
      totalSpent: totalSpent
    })
  } catch (err) {
    console.error("[GET /api/users/me/stats] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

// ──────────────────────────────────────────────
// Profile, Car Edit & Delete Routes
// ──────────────────────────────────────────────

// GET user profile
app.get("/api/users/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const profile = await getUsersCollection().findOne({ id: user.sub })
    sendSuccess(res, profile || {})
  } catch (err) {
    console.error("[GET /api/users/me] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

// PATCH user profile
app.patch("/api/users/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const { name, phone, location, gender, avatar } = req.body

    const updateFields: Record<string, any> = {}
    if (name !== undefined) updateFields.name = name
    if (phone !== undefined) updateFields.phone = phone
    if (location !== undefined) updateFields.location = location
    if (gender !== undefined) updateFields.gender = gender
    if (avatar !== undefined) updateFields.avatar = avatar
    updateFields.updatedAt = new Date()

    const result = await getUsersCollection().findOneAndUpdate(
      { id: user.sub },
      { $set: updateFields },
      { upsert: true, returnDocument: "after" }
    )

    sendSuccess(res, result)
  } catch (err) {
    console.error("[PATCH /api/users/me] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

// PUT car (edit)
app.put("/api/cars/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      sendError(res, "Invalid car ID", 400)
      return
    }

    // Ensure the car belongs to this user
    const existing = await getCarsCollection().findOne({ _id: new ObjectId(id), userId: user.sub })
    if (!existing) {
      sendError(res, "Car not found or unauthorized", 404)
      return
    }

    const { title, price, category, year, mileage, fuel, shortDescription, description, images } = req.body

    const updateFields: Record<string, any> = {}
    if (title !== undefined) updateFields.title = title
    if (price !== undefined) updateFields.price = Number(price)
    if (category !== undefined) updateFields.category = category
    if (year !== undefined) updateFields.year = Number(year)
    if (mileage !== undefined) updateFields.mileage = mileage
    if (fuel !== undefined) updateFields.fuel = fuel
    if (shortDescription !== undefined) updateFields.shortDescription = shortDescription
    if (description !== undefined) updateFields.description = description
    if (images !== undefined) updateFields.images = images
    updateFields.updatedAt = new Date()

    const result = await getCarsCollection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateFields },
      { returnDocument: "after" }
    )

    sendSuccess(res, result)
  } catch (err) {
    console.error("[PUT /api/cars/:id] Error:", err)
    sendError(res, err instanceof Error ? err.message : "Internal server error")
  }
})

// DELETE car
app.delete("/api/cars/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user
    const { id } = req.params

    if (!ObjectId.isValid(id)) {
      sendError(res, "Invalid car ID", 400)
      return
    }

    const result = await getCarsCollection().deleteOne({ _id: new ObjectId(id), userId: user.sub })

    if (result.deletedCount === 0) {
      sendError(res, "Car not found or unauthorized", 404)
      return
    }

    sendSuccess(res, { message: "Car deleted successfully" })
  } catch (err) {
    console.error("[DELETE /api/cars/:id] Error:", err)
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
