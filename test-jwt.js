const joseNext = require('jose');
const joseCJS = require('jose-cjs');

const JWT_SECRET = "your-super-secret-key-change-in-production";

async function test() {
  // 1. Sign (simulate Next.js)
  const secret = new TextEncoder().encode(JWT_SECRET);
  const token = await new joseNext.SignJWT({ sub: "test-user-id" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
    
  console.log("Token:", token);
  
  // 2. Verify (simulate Express)
  const verifySecret = new TextEncoder().encode(JWT_SECRET);
  
  try {
    const { payload } = await joseCJS.jwtVerify(token, verifySecret);
    console.log("Payload:", payload);
  } catch (err) {
    console.error("Verification error:", err);
  }
}
test();
