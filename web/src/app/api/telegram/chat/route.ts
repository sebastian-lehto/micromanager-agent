import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { insertMessage } from "@/lib/conversations";
import { env } from "@/env";
import { getUserById } from "@/lib/user";
import { verifyTelegramServerToken } from "@/lib/telegram/auth";
import { runWorkflow } from "@/lib/agent/workflows/micromanager.workflow";

export async function POST(req: NextRequest) {
  try {
    // Verify JWT token
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Try verifying with TELEGRAM_SERVER_SECRET first (for server-to-server calls)
    // If that fails, fall back to JWT_SECRET (for client tokens)
    let isValid = false;
    try {
      isValid = await verifyTelegramServerToken(token);
      if (!isValid) {
        throw new Error('Invalid server token')
      }
    } catch {
      // Server token verification failed, try client token
      
      try {
        await jwtVerify(token, env.JWT_SECRET);
        isValid = true;
      } catch {
        console.error(
          "Token verification failed for both server and client secrets"
        );
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
    }

    if (!isValid) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { message, userId } = await req.json();

    if (!message || !userId) {
      return NextResponse.json(
        { error: "Message and userId are required" },
        { status: 400 }
      );
    }

    const user = await getUserById(userId);
    const userTier = user?.tier;

    // Store user message
    await insertMessage({
      userId,
      role: "user",
      content: message,
      type: "text",
      source: "telegram-user",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("[Telegram Chat] Running workflow for user", {
      userId,
      userTier,
    });

    // Run micromanager workflow with user's message
    const workflowResult = await runWorkflow({
      input_as_text: message,
      user_id: userId,
      source: "telegram",
      usageTaskType: "chat",
    });

    const response = workflowResult.output_text;
    const hasError = "error" in workflowResult && workflowResult.error === true;

    console.log("[Telegram Chat] Workflow completed", {
      userId,
      hasError,
      error: "error" in workflowResult && workflowResult.error,
      errorMessage:
        "errorMessage" in workflowResult && workflowResult.errorMessage,
      responsePreview:
        response.length > 100 ? response.slice(0, 100) + "..." : response,
    });

    // Store assistant response
    await insertMessage({
      userId,
      role: "assistant",
      content: response,
      type: "text",
      source: "micromanager",
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: hasError ? { error: true } : undefined,
    });

    return NextResponse.json({
      response,
      error: hasError,
    });
  } catch (error) {
    console.error("Telegram chat error:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}
