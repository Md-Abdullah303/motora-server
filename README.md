# MOTORA Server

This is the backend server for the MOTORA Premium Car Marketplace.

## 🚀 Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js (TypeScript)
- **Database:** MongoDB with Mongoose
- **Authentication:** better-auth custom JWT validation
- **AI Integrations:** Google Gemini AI API
- **Payments:** Stripe Node.js SDK
- **Image Hosting:** ImgBB API

## 🔑 Environment Variables
You need an `.env` file with the following variables:
- `PORT`
- `MONGO_URI`
- `GEMINI_API_KEY`
- `STRIPE_SECRET_KEY`
- `BETTER_AUTH_SECRET`
- `FRONTEND_URL`
- `IMGBB_API_KEY`

## 📦 Scripts
- `npm run dev`: Starts the development server using nodemon/ts-node.
- `npm run build`: Compiles TypeScript code.
- `npm start`: Runs the compiled build in production.

## 📡 Core API Features
- **Auth/User:** JWT validation, profile fetching, user's cars and payments.
- **Cars:** CRUD operations for cars, pagination, filtering, trending cars.
- **AI Endpoints:** AI Car Chatbot context and AI Auto-Classification for generating car descriptions.
- **Payments:** Create Stripe checkout sessions and webhook processing.
