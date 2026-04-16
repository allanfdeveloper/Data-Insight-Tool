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
import { logger } from "../lib/logger";

const router: IRouter = Router();

/* POST /auth/signup — create a new user */
router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  try {
    // Check if email already taken
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()));

    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db
      .insert(usersTable)
      .values({ email: email.toLowerCase().trim(), passwordHash })
      .returning();

    // Save session before responding — critical for cookie to be set correctly
    (req.session as any).userId = user.id;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          logger.error({ err }, "Session save failed after signup");
          reject(err);
        } else {
          resolve();
        }
      });
    });

    req.log.info({ userId: user.id }, "User signed up successfully");
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
      },
      message: "Account created successfully",
    });
  } catch (err) {
    logger.error({ err }, "Signup failed");
    res.status(500).json({ error: "Signup failed. Please try again." });
  }
});

/* POST /auth/login */
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()));

    if (!user) {
      // Consistent timing to prevent user enumeration
      await bcrypt.compare(password, "$2b$12$invalidhashpadding000000000000000000000000000000000000");
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Regenerate session ID to prevent fixation attacks
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          logger.error({ err }, "Session regenerate failed");
          reject(err);
        } else {
          resolve();
        }
      });
    });

    (req.session as any).userId = user.id;

    // Save the session explicitly before responding
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          logger.error({ err }, "Session save failed after login");
          reject(err);
        } else {
          resolve();
        }
      });
    });

    req.log.info({ userId: user.id }, "User logged in successfully");
    res.json(
      LoginResponse.parse({
        user: {
          id: user.id,
          email: user.email,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt,
        },
        message: "Login successful",
      })
    );
  } catch (err) {
    logger.error({ err }, "Login failed");
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

/* POST /auth/logout */
router.post("/auth/logout", (req, res): void => {
  const userId = (req.session as any).userId;
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err, userId }, "Session destroy failed on logout");
    }
    // Clear the cookie on the client side too
    res.clearCookie("connect.sid");
    res.json(LogoutResponse.parse({ message: "Logged out" }));
  });
});

/* GET /auth/me — verify session and return current user */
router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = (req.session as any).userId;

  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      // Session references a deleted user — clean it up
      req.session.destroy(() => {});
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
  } catch (err) {
    logger.error({ err }, "Failed to fetch current user");
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
