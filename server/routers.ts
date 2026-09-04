import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createConversation,
  createMessage,
  getConversationForUser,
  listConversations,
  listMessages,
  touchConversation,
} from "./db";
import { orchestrateConversation } from "./orchestration";
import { uploadUserFile } from "./upload";

const conversationIdInput = z.object({
  conversationId: z.number().int().positive(),
});

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
  conversations: router({
    list: protectedProcedure.query(({ ctx }) => listConversations(ctx.user.id)),
    create: protectedProcedure
      .input(
        z
          .object({ title: z.string().trim().min(1).max(160).optional() })
          .optional()
      )
      .mutation(({ ctx, input }) =>
        createConversation(ctx.user.id, input?.title ?? "New conversation")
      ),
    messages: protectedProcedure
      .input(conversationIdInput)
      .query(async ({ ctx, input }) => {
        const conversation = await getConversationForUser(
          input.conversationId,
          ctx.user.id
        );
        if (!conversation)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found",
          });
        return listMessages(input.conversationId, ctx.user.id);
      }),
    send: protectedProcedure
      .input(
        z.object({
          conversationId: z.number().int().positive(),
          content: z.string().trim().min(1).max(12000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const conversation = await getConversationForUser(
          input.conversationId,
          ctx.user.id
        );
        if (!conversation)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found",
          });

        const userMessage = await createMessage({
          conversationId: input.conversationId,
          userId: ctx.user.id,
          role: "user",
          content: input.content,
          status: "complete",
        });
        await touchConversation(input.conversationId, ctx.user.id);

        try {
          const history = await listMessages(input.conversationId, ctx.user.id);
          const result = await orchestrateConversation({
            systemInstructions:
              "You are JUNI, a trustworthy personal AI workspace. Answer clearly, distinguish facts from uncertainty, and ask a focused follow-up question when the request is underspecified.",
            userInput: input.content,
            history: history.slice(-12).map(message => ({
              role: message.role === "assistant" ? "assistant" : "user",
              content: message.content,
            })),
          });
          const assistantMessage = await createMessage({
            conversationId: input.conversationId,
            userId: ctx.user.id,
            role: "assistant",
            content: result.content,
            status: "complete",
          });
          await touchConversation(input.conversationId, ctx.user.id);
          return {
            userMessage,
            assistantMessage,
            capability: result.capability,
          };
        } catch (error) {
          await createMessage({
            conversationId: input.conversationId,
            userId: ctx.user.id,
            role: "assistant",
            content:
              "JUNI could not complete this response. Your message is saved; please try again.",
            status: "error",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "JUNI response generation failed",
          });
        }
      }),
  }),
  files: router({
    upload: protectedProcedure
      .input(
        z.object({
          originalName: z.string().trim().min(1).max(255),
          mimeType: z.string().trim().min(1).max(255),
          contentBase64: z.string().min(4).max(36_000_000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await uploadUserFile({ ...input, userId: ctx.user.id });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "Upload failed",
          });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
