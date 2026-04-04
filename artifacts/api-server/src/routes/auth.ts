import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  SignupBody,
  LoginBody,
  LoginResponse,
  GetMeResponse,
  LogoutResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/* POST /auth/signup — create a new user */
router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  // Check if email already taken
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({ email, passwordHash })
    .returning();

  // Set session
  (req.session as any).userId = user.id;

  const responseUser = {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
  };

  res.status(201).json({ user: responseUser, message: "Account created successfully" });
});

/* POST /auth/login */
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  (req.session as any).userId = user.id;

  const responseUser = {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
  };

  res.json(LoginResponse.parse({ user: responseUser, message: "Login successful" }));
});

/* POST /auth/logout */
router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.json(LogoutResponse.parse({ message: "Logged out" }));
  });
});

/* GET /auth/me */
router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = (req.session as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(
    GetMeResponse.parse({
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
    })
  );
});

export default router;
