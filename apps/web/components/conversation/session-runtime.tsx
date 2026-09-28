"use client";

import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import type { ReactNode } from "react";
import type { SessionProjectedMessage } from "./session-message-parts";

export function SessionRuntime({ children, messages, running }: {
  children: ReactNode;
  messages: readonly SessionProjectedMessage[];
  running: boolean;
}) {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: running,
    isSendDisabled: true,
    onNew: async () => { throw new Error("The Session composer owns sending."); },
    convertMessage: (message): ThreadMessageLike => message as ThreadMessageLike,
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
