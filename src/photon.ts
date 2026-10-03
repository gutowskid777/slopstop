// Photon's management API: the part of "text it" that happens before the first text.
// On a shared line, the agent can only talk to numbers registered to the project, so joining = one API call.
const BASE = "https://spectrum.photon.codes";

const creds = () => {
  const id = process.env.SPECTRUM_PROJECT_ID;
  const secret = process.env.SPECTRUM_PROJECT_SECRET;
  if (!id || !secret) throw new Error("SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET missing in .env");
  return { id, auth: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") };
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { id, auth } = creds();
  const res = await fetch(`${BASE}/projects/${id}${path}`, {
    ...init,
    headers: { authorization: auth, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json().catch(() => ({}))) as { succeed?: boolean; data?: T; message?: string };
  if (!res.ok || body.succeed === false) throw new Error(body.message || `Photon ${res.status}`);
  return body.data as T;
}

export type PhotonUser = { id: string; phoneNumber: string; assignedPhoneNumber: string; firstName: string | null };

export const online = () => Boolean(process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET);

/** Loose input ("607 555 0134", "(607) 555-0134", "+44...") to E.164. US numbers by default. */
export function e164(raw: string): string | undefined {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

/** Register a number (idempotent: the same number returns the same user) and get the line they should text. */
export const addUser = (phoneNumber: string, firstName?: string) =>
  api<PhotonUser>("/users/", { method: "POST", body: JSON.stringify({ type: "shared", phoneNumber, ...(firstName ? { firstName } : {}) }) });

export const listUsers = async () => (await api<{ users: PhotonUser[]; total: number }>("/users/")).users;

/** A public link that opens Messages on their phone, addressed to their line, with the first text started. */
export const textLink = (userId: string, msg: string) => `${BASE}/users/${userId}/redirect?msg=${encodeURIComponent(msg)}`;

export const getProfile = () => api<{ firstName: string; lastName: string; avatarUrl: string | null }>("/profile");

/** The agent's name as it shows in Messages. */
export const setProfile = (p: { firstName?: string; lastName?: string }) => api("/profile", { method: "PATCH", body: JSON.stringify(p) });

export const syncProfile = () => api("/profile/sync", { method: "POST" });
