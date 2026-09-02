import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { ApiKeyService } from "../../services/api-key.service";
import {
  createKey,
  listKeys,
  revokeKey,
  rotateKeyHandler,
} from "../controllers/api-keys.controller";

export function createApiKeysRouter(apiKeyService: ApiKeyService): Router {
  const router = Router();
  router.post("/", authMiddleware, createKey(apiKeyService));
  router.post("/rotate", authMiddleware, rotateKeyHandler(apiKeyService));
  router.get("/", authMiddleware, listKeys(apiKeyService));
  router.delete("/:id", authMiddleware, revokeKey(apiKeyService));
  return router;
}

