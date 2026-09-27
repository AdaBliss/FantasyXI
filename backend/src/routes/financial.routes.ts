import { Router } from "express";
import {
  getPaymentRequirement,
  submitPayment,
  verifyPayment,
  getSettlementPlan,
  reconcileLeague,
  getAffiliateDashboard,
} from "../controllers/financial.controller.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { Permission } from "../types/index.js";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";
import { UserRole } from "../types/index.js";
import { authenticatedRateLimiter, mutationRateLimiter } from "../middleware/rateLimiter.js";

const router = Router({ mergeParams: true });

// All financial actions require valid JWT authentication
router.use(requireAuth, authenticatedRateLimiter);

router.get("/requirement", requirePermission(Permission.PAYMENT_MANAGE_OWN), getPaymentRequirement);
router.post("/submit", requirePermission(Permission.PAYMENT_MANAGE_OWN), submitPayment);
router.post("/verify", requirePermission(Permission.PAYMENT_MANAGE_OWN), verifyPayment);
router.get("/settlement-plan", requirePermission(Permission.SETTLEMENT_READ), getSettlementPlan);
router.get("/affiliate-dashboard", requirePermission(Permission.AFFILIATE_READ_OWN), getAffiliateDashboard);
router.get("/requirement", getPaymentRequirement);
router.post("/submit", mutationRateLimiter, submitPayment);
router.post("/verify", mutationRateLimiter, verifyPayment);
router.get("/settlement-plan", getSettlementPlan);
router.get("/affiliate-dashboard", getAffiliateDashboard);

// Reconciliation exposes sensitive league financial reports and requires the
// financial:reconcile permission (ADMIN, MODERATOR and SERVICE roles).
router.get("/reconcile", requirePermission(Permission.FINANCIAL_RECONCILE), reconcileLeague);

export default router;

