// Sign-in. In production the console signs people in with Microsoft Entra ID (MSAL, redirect flow) and calls
// the API with their access token. Locally and in end-to-end tests it asks the API's dev issuer for a token of
// one of the fixture personas, which the API only offers when it runs with AUTH_MODE=dev.
import { PublicClientApplication } from "@azure/msal-browser";

const MODE = (import.meta.env.VITE_AUTH_MODE as string | undefined) ?? "dev";
const PERSONA_KEY = "rop.persona";

export interface Persona {
  key: string;
  name: string;
  team: string;
  entity: string;
  roles: string[];
}

let msal: PublicClientApplication | undefined;
let devToken: { persona: string; token: string } | undefined;

export const authMode = MODE === "entra" ? "entra" : "dev";

export function currentPersona(): string | null {
  try {
    return localStorage.getItem(PERSONA_KEY);
  } catch {
    return null;
  }
}

export function choosePersona(key: string | null): void {
  devToken = undefined;
  try {
    if (key) localStorage.setItem(PERSONA_KEY, key);
    else localStorage.removeItem(PERSONA_KEY);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

async function entraToken(): Promise<string> {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: {
        clientId: import.meta.env.VITE_ENTRA_CLIENT_ID as string,
        authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID as string}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    await msal.initialize();
    await msal.handleRedirectPromise();
  }
  const scopes = [`${import.meta.env.VITE_ENTRA_API_SCOPE as string}`];
  const account = msal.getAllAccounts()[0];
  if (!account) {
    await msal.loginRedirect({ scopes });
    throw new Error("redirecting to sign-in");
  }
  const r = await msal.acquireTokenSilent({ scopes, account });
  return r.accessToken;
}

export async function accessToken(): Promise<string | null> {
  if (authMode === "entra") return entraToken();
  const persona = currentPersona();
  if (!persona) return null;
  if (devToken?.persona === persona) return devToken.token;
  const r = await fetch(`/dev/token?persona=${encodeURIComponent(persona)}`);
  if (!r.ok) throw new Error("The dev sign-in is not available. Start the API with AUTH_MODE=dev.");
  devToken = { persona, token: ((await r.json()) as { token: string }).token };
  return devToken.token;
}

export async function personas(): Promise<Persona[]> {
  const r = await fetch("/dev/personas");
  if (!r.ok) throw new Error("The dev sign-in is not available. Start the API with AUTH_MODE=dev.");
  return r.json();
}
