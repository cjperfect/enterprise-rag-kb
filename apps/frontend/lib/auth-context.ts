"use client";
import { createContext, useContext } from "react";
import type { AuthUser } from "@/interfaces/auth";

export const AuthContext = createContext<AuthUser | null>(null);
export function useAuthUser(): AuthUser {
  const user = useContext(AuthContext);
  if (!user) throw new Error("请先登录");
  return user;
}
