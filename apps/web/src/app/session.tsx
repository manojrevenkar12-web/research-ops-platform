import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { api } from "../shared/lib/api";
import { authMode, choosePersona, currentPersona } from "../shared/lib/auth";

export interface Me {
  id: string;
  display_name: string;
  email: string;
  entity: string;
  team: string;
  roles: string[];
  apps: { key: string; title: string; owner: string }[];
}

interface Session {
  persona: string | null;
  setPersona(key: string | null): void;
  me: Me | undefined;
  loading: boolean;
  error: unknown;
  retry(): void;
  has(role: string): boolean;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [persona, setPersonaState] = useState<string | null>(() =>
    authMode === "entra" ? "entra" : currentPersona(),
  );
  const me = useQuery({ queryKey: ["me", persona], queryFn: () => api<Me>("/api/me"), enabled: !!persona });
  const value: Session = {
    persona,
    setPersona(key) {
      choosePersona(key);
      setPersonaState(key);
      client.clear();
    },
    me: me.data,
    loading: !!persona && me.isPending,
    error: me.error,
    retry: () => void me.refetch(),
    has: (role) => !!me.data?.roles.includes(role),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
