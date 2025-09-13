import dotenv from "dotenv";
import bcrypt from "bcrypt";
import pool from "../db.js";

dotenv.config();

async function run() {
  const email = process.argv[2];
  const password = process.argv[3];
  const company = "Admin";
  if (!email || !password) {
    console.log("Usage: npm run create-admin -- admin@you.com StrongPassword123");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  const q = await pool.query(
    "insert into users (email, company_name, password_hash, role, verified) values ($1,$2,$3,$4,$5) returning id",
    [email.toLowerCase(), company, hash, "admin", true]
  );
  console.log("Created admin id:", q.rows[0].id);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
