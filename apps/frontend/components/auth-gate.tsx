"use client";

import { useEffect, useReducer, type ReactNode, type FormEvent } from "react";
import { BookOpen, LogOut } from "lucide-react";
import { AuthContext } from "@/lib/auth-context";
import { get, post } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthState, AuthUser } from "@/interfaces/auth";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, update] = useReducer((previous: AuthState, patch: Partial<AuthState>) => ({ ...previous, ...patch }), {
    checking: true,
    user: null,
    register: false,
    busy: false,
    error: "",
  });

  useEffect(() => {
    let active = true;
    const expired = () => update({ user: null, checking: false });
    window.addEventListener("rag:unauthorized", expired);
    async function load() {
      try {
        const user = await get<AuthUser>("/auth/me");
        if (active) update({ user, checking: false });
      } catch {
        if (active) update({ checking: false });
      }
    }
    void load();
    return () => {
      active = false;
      window.removeEventListener("rag:unauthorized", expired);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update({ busy: true, error: "" });
    try {
      const result = await post<{ user: AuthUser }>(state.register ? "/auth/register" : "/auth/login", {
        email: form.get("email"),
        password: form.get("password"),
        ...(state.register ? { name: form.get("name") } : {}),
      });
      update({ user: result.user });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "登录失败，请重试" });
    } finally {
      update({ busy: false });
    }
  }

  async function logout() {
    try {
      await post("/auth/logout");
      update({ user: null });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "退出失败，请重试" });
    }
  }

  if (state.checking)
    return (
      <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status">
        正在验证登录状态…
      </main>
    );
  if (state.user)
    return (
      <>
        <AuthContext.Provider value={state.user}>{children}</AuthContext.Provider>
        <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border bg-background px-3 py-1 shadow-sm">
          <span className="max-w-40 truncate text-xs text-muted-foreground">{state.error || state.user.email}</span>
          <Button size="icon" variant="ghost" aria-label="退出登录" onClick={() => void logout()}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </>
    );

  return (
    <main className="grid min-h-dvh bg-muted/30 px-6 lg:grid-cols-2">
      <aside className="hidden flex-col justify-between border-r px-14 py-12 lg:flex">
        <div className="flex items-center gap-3 text-sm font-medium">
          <BookOpen className="size-5" /> 知识工作台
        </div>
        <div className="max-w-md">
          <p className="mb-6 font-mono text-xs tracking-widest text-muted-foreground">LANGCHAIN / KNOWLEDGE</p>
          <h1 className="text-5xl leading-tight font-semibold tracking-tight">
            让每一次回答，
            <br />
            都有据可循。
          </h1>
          <p className="mt-6 text-sm leading-7 text-muted-foreground">整理文档、查找知识，让团队经验成为随时可用的答案。</p>
        </div>
        <p className="text-xs text-muted-foreground">你的文档与会话，仅在你的账号中可见。</p>
      </aside>
      <section className="flex items-center justify-center py-16">
        <form onSubmit={(event) => void submit(event)} className="w-full max-w-sm space-y-6 rounded-2xl border bg-background p-8 shadow-sm">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{state.register ? "创建账号" : "欢迎回来"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">登录后访问你的知识库与会话。</p>
          </div>
          {state.register ? (
            <div className="space-y-2">
              <Label htmlFor="name">用户名</Label>
              <Input id="name" name="name" autoComplete="name" required maxLength={100} />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input id="password" name="password" type="password" autoComplete={state.register ? "new-password" : "current-password"} required minLength={8} maxLength={128} />
          </div>
          {state.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={state.busy}>
            {state.busy ? "请稍候…" : state.register ? "注册并登录" : "登录"}
          </Button>
          <Button type="button" variant="link" className="w-full" disabled={state.busy} onClick={() => update({ register: !state.register, error: "" })}>
            {state.register ? "已有账号？去登录" : "还没有账号？创建账号"}
          </Button>
        </form>
      </section>
    </main>
  );
}
