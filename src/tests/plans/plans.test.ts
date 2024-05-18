import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../../db/client";
import { createAuthenticatedCaller, createCaller } from "../helpers/utils";
import { trpcError } from "../../trpc/core";
import resetDb from "../helpers/resetDb";
import { eq } from "drizzle-orm";

type planType = {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
};

describe("plan routes", async () => {
  const user = {
    email: "admin@mail.com",
    password: "P@ssw0rd",
    name: "admin",
    timezone: "Asia/Riyadh",
    locale: "en",
  };

  beforeAll(async () => {
    await resetDb();

    await createCaller({}).auth.register(user);
  });

  const createUserAuthenticatedCaller = async () => {
    const userInDb = await db.query.users.findFirst({
      where: eq(schema.users.email, user.email),
    });

    return createAuthenticatedCaller({
      userId: userInDb!.id,
    });
  };

  const updateUser = async (newData: object) => {
    await db
      .update(schema.users)
      .set(newData)
      .where(eq(schema.users.email, user.email));
  };

  const starterPlan: planType = {
    name: "Starter",
    monthlyPrice: 19,
    yearlyPrice: 179,
  };

  const basicPlan: planType = {
    name: "Basic",
    monthlyPrice: 29,
    yearlyPrice: 279,
  };

  const plusPlan: planType = {
    name: "Plus",
    monthlyPrice: 59,
    yearlyPrice: 599,
  };

  const premiumPlan: planType = {
    name: "Premium",
    monthlyPrice: 199,
    yearlyPrice: 1999,
  };

  const getPlanInDb = (plan: planType) => {
    return db.query.plans.findFirst({
      where: eq(schema.plans.name, plan.name),
    });
  };

  describe("create starter plan", async () => {
    it("should throw error for non admin user", async () => {
      const authenticatedCaller = await createUserAuthenticatedCaller();

      const createPlanReq = authenticatedCaller.plans.create(starterPlan);

      await expect(createPlanReq).rejects.toThrowError(
        new trpcError({
          code: "FORBIDDEN",
          message: "Only admin allowed to access",
        })
      );
    });

    it("should create plan successfully", async () => {
      await updateUser({ isAdmin: true });

      const authenticatedCaller = await createUserAuthenticatedCaller();

      const addingPlanRes = await authenticatedCaller.plans.create(starterPlan);

      expect(addingPlanRes.success).toBe(true);

      const planInDb = await getPlanInDb(starterPlan);

      expect(planInDb).toBeDefined();
      expect(planInDb!.name).toBe(starterPlan.name);
      expect(planInDb!.monthlyPrice).toBe(starterPlan.monthlyPrice);
      expect(planInDb!.yearlyPrice).toBe(starterPlan.yearlyPrice);
    });
  });

  describe("update starter plan to basic plan", async () => {
    it("should throw error for non admin user", async () => {
      await updateUser({ isAdmin: false });

      const plan = await getPlanInDb(starterPlan);

      const authenticatedCaller = await createUserAuthenticatedCaller();

      const updatePlanReq = authenticatedCaller.plans.update({
        id: plan!.id,
        ...basicPlan,
      });

      await expect(updatePlanReq).rejects.toThrowError(
        new trpcError({
          code: "FORBIDDEN",
          message: "Only admin allowed to access",
        })
      );
    });

    it("plan should updated successfully", async () => {
      await updateUser({ isAdmin: true });

      const plan = await getPlanInDb(starterPlan);

      const authenticatedCaller = await createUserAuthenticatedCaller();

      const updatePlanRes = await authenticatedCaller.plans.update({
        id: plan!.id,
        ...basicPlan,
      });

      expect(updatePlanRes.success).toBe(true);

      const planInDb = await db.query.plans.findFirst({
        where: eq(schema.plans.id, plan!.id),
      });

      expect(planInDb!.name).toBe(basicPlan.name);
      expect(planInDb!.monthlyPrice).toBe(basicPlan.monthlyPrice);
      expect(planInDb!.yearlyPrice).toBe(basicPlan.yearlyPrice);
    });
  });

  describe("get plans", async () => {
    it("should return the plan list", async () => {
      const authenticatedCaller = await createUserAuthenticatedCaller();

      await authenticatedCaller.plans.create(plusPlan);
      await authenticatedCaller.plans.create(premiumPlan);

      const getPlansRes = await createCaller({}).plans.get();

      const plansInDb = await db.query.plans.findMany();

      expect(getPlansRes.length).toBe(plansInDb.length);

      for (const [key, value] of getPlansRes.entries()) {
        expect(value!.name).toBe(plansInDb[key]!.name);
        expect(value!.monthlyPrice).toBe(plansInDb[key]!.monthlyPrice);
        expect(value!.yearlyPrice).toBe(plansInDb[key]!.yearlyPrice);
      }
    });
  });

  describe("calculate upgrading price", async () => {
    const teamName = "SuperTeam";
    const daysRemaining = 14;

    const getTeam = () => {
      return db.query.teams.findFirst({
        where: eq(schema.teams.name, teamName),
      });
    };

    it("should throw error if teamId invalid", async () => {
      const authenticatedCaller = await createUserAuthenticatedCaller();

      const upgradingPriceReq = authenticatedCaller.plans.getUpgrade({
        teamId: 1,
        planId: 1,
      });

      await expect(upgradingPriceReq).rejects.toThrowError(
        new trpcError({
          code: "BAD_REQUEST",
          message: "Invalid teamId",
        })
      );
    });

    it("should throw error if user doesn't have subscription", async () => {
      const authenticatedCaller = await createUserAuthenticatedCaller();

      await authenticatedCaller.teams.create({ name: teamName });

      const team = await getTeam();

      const upgradingPriceReq = authenticatedCaller.plans.getUpgrade({
        teamId: team!.id,
        planId: 1,
      });

      await expect(upgradingPriceReq).rejects.toThrowError(
        new trpcError({
          code: "NOT_FOUND",
          message: "The team doesn't have subscription",
        })
      );
    });

    it("should throw error if subscription not active", async () => {
      const team = await getTeam();
      const plan = await getPlanInDb(plusPlan);

      await db.insert(schema.subscriptions).values({
        teamId: team!.id,
        planId: plan!.id,
        subscriptionType: "monthly",
        createdAt: new Date(),
      });

      const authenticatedCaller = await createUserAuthenticatedCaller();

      const upgradingPriceReq = authenticatedCaller.plans.getUpgrade({
        teamId: team!.id,
        planId: plan!.id,
      });

      await expect(upgradingPriceReq).rejects.toThrowError(
        new trpcError({
          code: "BAD_REQUEST",
          message: "Subscription not active",
        })
      );
    });

    it("should throw error if planId invalid", async () => {
      const team = await getTeam();

      const subscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.teamId, team!.id),
      });

      const activationDate = new Date();
      const lastActiveDate = new Date(activationDate);
      lastActiveDate.setDate(lastActiveDate.getDate() + daysRemaining);

      await db.insert(schema.subscriptionActivations).values({
        subscriptionId: subscription!.id,
        activationDate,
        lastActiveDate,
      });

      const authenticatedCaller = await createUserAuthenticatedCaller();

      const upgradingPriceReq = authenticatedCaller.plans.getUpgrade({
        teamId: team!.id,
        planId: 12,
      });

      await expect(upgradingPriceReq).rejects.toThrowError(
        new trpcError({
          code: "BAD_REQUEST",
          message: "Invalid plan",
        })
      );
    });

    it("should throw error if plan is downgrading", async () => {
      const team = await getTeam();
      const plan = await getPlanInDb(basicPlan);

      const authenticatedCaller = await createUserAuthenticatedCaller();

      const upgradingPriceReq = authenticatedCaller.plans.getUpgrade({
        teamId: team!.id,
        planId: plan!.id,
      });

      await expect(upgradingPriceReq).rejects.toThrowError(
        new trpcError({
          code: "BAD_REQUEST",
          message: "Unable to calculate the price for downgrading plan",
        })
      );
    });

    it("should return the upgrading price", async () => {
      const team = await getTeam();
      const plan = await getPlanInDb(premiumPlan);

      const authenticatedCaller = await createUserAuthenticatedCaller();

      const upgradingPriceRes = await authenticatedCaller.plans.getUpgrade({
        teamId: team!.id,
        planId: plan!.id,
      });

      expect(upgradingPriceRes).toBeDefined();
      expect(upgradingPriceRes.daysRemaining).toBe(daysRemaining);

      const priceDifference = premiumPlan.monthlyPrice - plusPlan.monthlyPrice;
      expect(upgradingPriceRes.priceDifference).toBe(priceDifference);
      expect(upgradingPriceRes.upgradingPrice).toBe(
        (priceDifference / 30) * daysRemaining
      );
    });
  });
});
