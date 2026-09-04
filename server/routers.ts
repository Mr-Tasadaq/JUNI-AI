import { GoogleGenAI, Modality } from "@google/genai";
import { LIVE_MODEL, safeLiveToolDeclarations } from "@shared/juni";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const amountSchema = z.number().finite().min(100).max(100_000);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  live: router({
    createEphemeralToken: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ENV.geminiApiKey) {
        throw new Error(
          "Gemini Live is not configured. Add GEMINI_API_KEY on the server."
        );
      }

      const now = Date.now();
      const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
      const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
      const ai = new GoogleGenAI({ apiKey: ENV.geminiApiKey });
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              sessionResumption: {},
              tools: [
                { functionDeclarations: [...safeLiveToolDeclarations] as any },
              ],
            },
          },
        },
      });

      if (!token.name)
        throw new Error("Gemini did not return an ephemeral token.");
      console.info("[Live] Ephemeral token issued", {
        userId: ctx.user.id,
        expiresAt: expireTime,
      });
      return { token: token.name, expiresAt: expireTime, model: LIVE_MODEL };
    }),
    getRechargeInfo: protectedProcedure.query(({ ctx }) => ({
      userId: ctx.user.id,
      currency: "PKR",
      status: "not_connected" as const,
      balance: null,
      message:
        "No billing provider is connected yet. This read-only preview will not expose or invent account data.",
    })),
    startRecharge: protectedProcedure
      .input(z.object({ amount: amountSchema }))
      .mutation(({ input, ctx }) => ({
        status: "awaiting_provider" as const,
        amount: input.amount,
        currency: "PKR" as const,
        userId: ctx.user.id,
        checkoutUrl: null,
        message:
          "Recharge intent recorded in the safe preview layer. A verified payment provider must be connected before checkout can begin.",
      })),
  }),
});

export type AppRouter = typeof appRouter;
