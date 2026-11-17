"use client";

import { createContext, useContext } from "react";
import type { OwnerSession } from "@/lib/access";

export const OwnerContext = createContext<{ owner: OwnerSession; active: boolean } | null>(null);

export function useOwner() {
  const value = useContext(OwnerContext);
  if (!value) throw new Error("Open the workspace through owner sign-in.");
  return value;
}
