import {
  router,
  trpcError,
  publicProcedure,
  protectedProcedure,
} from "../../trpc/core";
import { z } from "zod";
import { schema, db } from "../../db/client";
import { eq, and, gte } from "drizzle-orm";

export const plans = router({
  get: publicProcedure.query(async () => {
    try {
      const plans = await db.query.plans.findMany();
      return plans;
    } catch (error) {
      console.error("Error fetching plans", error);
      return [];
    }
  }),
  getUpgrade: protectedProcedure
    .input(
      z.object({
        teamId: z.number(),
        planId: z.number(),
      })
    )
    .query(async ({ ctx: { user }, input }) => {
      const { userId } = user;
      const { teamId, planId } = input;

      const team = await db.query.teams.findFirst({
        where: eq(schema.teams.id, teamId),
      });

      if (!team) {
        throw new trpcError({
          code: "BAD_REQUEST",
          message: "Invalid teamId",
        });
      }

      if (team.userId !== userId) {
        throw new trpcError({
          code: "FORBIDDEN",
          message: "You don't have access to the team",
        });
      }

      const subscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.teamId, teamId),
      });

      if (!subscription) {
        throw new trpcError({
          code: "NOT_FOUND",
          message: "The team doesn't have subscription",
        });
      }

      const subscriptionActivation =
        await db.query.subscriptionActivations.findFirst({
          where: and(
            eq(schema.subscriptionActivations.subscriptionId, subscription.id),
            gte(schema.subscriptionActivations.lastActiveDate, new Date())
          ),
        });

      if (!subscriptionActivation) {
        throw new trpcError({
          code: "BAD_REQUEST",
          message: "Subscription not active",
        });
      }

      const newPlan = await db.query.plans.findFirst({
        where: eq(schema.plans.id, planId),
      });

      const currentPlan = await db.query.plans.findFirst({
        where: eq(schema.plans.id, subscription.planId),
      });

      if (!newPlan || !currentPlan) {
        throw new trpcError({
          code: "BAD_REQUEST",
          message: "Invalid plan",
        });
      }

      if (newPlan.monthlyPrice < currentPlan.monthlyPrice) {
        throw new trpcError({
          code: "BAD_REQUEST",
          message: "Unable to calculate the price for downgrading plan",
        });
      }

      const daysRemaining = Math.round(
        (subscriptionActivation.lastActiveDate.valueOf() -
          new Date().valueOf()) /
          (24 * 60 * 60 * 1000)
      );
      const priceDifference = newPlan.monthlyPrice - currentPlan.monthlyPrice;
      const upgradingPrice = (priceDifference / 30) * daysRemaining;

      return {
        currentPlan,
        newPlan,
        daysRemaining,
        priceDifference,
        upgradingPrice,
      };
    }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        monthlyPrice: z.number().nonnegative(),
        yearlyPrice: z.number().nonnegative(),
      })
    )
    .mutation(async ({ ctx: { user }, input }) => {
      const { userId } = user;
      const { name, monthlyPrice, yearlyPrice } = input;

      const userInDb = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });
      if (!userInDb?.isAdmin) {
        throw new trpcError({
          code: "FORBIDDEN",
          message: "Only admin allowed to access",
        });
      }

      await db
        .insert(schema.plans)
        .values({
          createdAt: new Date(),
          name,
          monthlyPrice,
          yearlyPrice,
        })
        .returning();

      return {
        success: true,
      };
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string(),
        monthlyPrice: z.number().nonnegative(),
        yearlyPrice: z.number().nonnegative(),
      })
    )
    .mutation(async ({ ctx: { user }, input }) => {
      const { userId } = user;
      const { id, name, monthlyPrice, yearlyPrice } = input;

      const userInDb = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });
      if (!userInDb?.isAdmin) {
        throw new trpcError({
          code: "FORBIDDEN",
          message: "Only admin allowed to access",
        });
      }

      await db
        .update(schema.plans)
        .set({
          updatedAt: new Date(),
          name,
          monthlyPrice,
          yearlyPrice,
        })
        .where(eq(schema.plans.id, id));
      return {
        success: true,
      };
    }),
});
