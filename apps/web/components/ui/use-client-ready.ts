"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** A server-painted action becomes available after its own client initialization. */
export function useClientReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
