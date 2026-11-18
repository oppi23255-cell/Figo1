import { getApp, getApps, initializeApp } from 'firebase/app';
import { get, getDatabase, onValue, ref, set, type Unsubscribe } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyAlX1ASvDrf5BBtaB72AUYqSoW34YvP_y4',
  authDomain: 'mrwan-dd795.firebaseapp.com',
  databaseURL: 'https://mrwan-dd795-default-rtdb.firebaseio.com',
  projectId: 'mrwan-dd795',
  storageBucket: 'mrwan-dd795.firebasestorage.app',
  messagingSenderId: '12538399995',
  appId: '1:12538399995:web:4a7e6b40f611891fecb45e',
  measurementId: 'G-KBTHXXDYBL',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);

export type CrashPhase = 'waiting' | 'flight' | 'crashed';

export interface CrashCurrent {
  roundNumber: number;
  phase: CrashPhase;
  crashPoint: number;
  roundStartedAt: number;
  flightStartedAt: number;
  updatedAt: number;
  clientId?: string;
}

export interface ActivationCodeRecord {
  code?: string;
  is_active: boolean;
  type: 'airplane' | 'apple' | 'apple_promo';
  expires_at?: string;
  created_for?: string;
  used_attempts?: number;
  total_attempts?: number;
}

const DATABASE_URL = 'https://mrwan-dd795-default-rtdb.firebaseio.com';

function isPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as { message?: unknown }).message ?? '').toUpperCase();
  const code = String((err as { code?: unknown }).code ?? '').toUpperCase();
  return msg.includes('PERMISSION_DENIED') || code.includes('PERMISSION_DENIED');
}

export async function isCrashRootClosed(): Promise<boolean> {
  try {
    const res = await fetch(`${DATABASE_URL}/crash.json?shallow=true`, { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) return true;
    if (!res.ok) return false;
    const data = await res.json();
    return data === false;
  } catch {
    return false;
  }
}

export async function fetchCrashCurrentViaRest(): Promise<{
  closed: boolean;
  data: CrashCurrent | null;
}> {
  try {
    const [enabledRes, currentRes] = await Promise.all([
      fetch(`${DATABASE_URL}/crash/enabled.json`, { cache: 'no-store' }),
      fetch(`${DATABASE_URL}/crash/current.json`, { cache: 'no-store' }),
    ]);

    if (
      enabledRes.status === 401 ||
      enabledRes.status === 403 ||
      currentRes.status === 401 ||
      currentRes.status === 403
    ) {
      return { closed: true, data: null };
    }

    const enabledVal = enabledRes.ok ? await enabledRes.json() : null;
    if (enabledVal === false) {
      return { closed: true, data: null };
    }

    const val = currentRes.ok ? await currentRes.json() : null;
    if (val === false) {
      return { closed: true, data: null };
    }
    if (!val || typeof val !== 'object') {
      const rootClosed = await isCrashRootClosed();
      return { closed: rootClosed, data: null };
    }

    return {
      closed: false,
      data: {
        roundNumber: Number(val.roundNumber),
        phase: (val.phase as CrashPhase) || 'waiting',
        crashPoint: Number(val.crashPoint),
        roundStartedAt: Number(val.roundStartedAt ?? 0),
        flightStartedAt: Number(val.flightStartedAt ?? 0),
        updatedAt: Number(val.updatedAt ?? 0),
        clientId: typeof val.clientId === 'string' ? val.clientId : undefined,
      },
    };
  } catch {
    return { closed: false, data: null };
  }
}

export function subscribeConnectionState(cb: (connected: boolean) => void): Unsubscribe {
  const connectedRef = ref(db, '.info/connected');
  return onValue(connectedRef, (snap) => {
    cb(Boolean(snap.val()));
  });
}

export function subscribeCrashEnabled(
  cb: (enabled: boolean) => void,
  onClosed: () => void
): Unsubscribe {
  const enabledRef = ref(db, 'crash/enabled');
  return onValue(
    enabledRef,
    (snapshot) => {
      const val = snapshot.val();
      if (val === false) {
        cb(false);
        onClosed();
      } else {
        cb(true);
      }
    },
    (err) => {
      if (isPermissionDeniedError(err)) {
        cb(false);
        onClosed();
      }
    }
  );
}

export function subscribeCrashCurrent(
  cb: (data: CrashCurrent | null) => void,
  onClosed: () => void
): Unsubscribe {
  const currentRef = ref(db, 'crash/current');
  return onValue(
    currentRef,
    async (snapshot) => {
      const val = snapshot.val();
      if (val === false) {
        cb(null);
        onClosed();
        return;
      }
      if (!val || typeof val !== 'object') {
        const rootClosed = await isCrashRootClosed();
        if (rootClosed) {
          cb(null);
          onClosed();
          return;
        }
        cb(null);
        return;
      }
      cb({
        roundNumber: Number(val.roundNumber),
        phase: (val.phase as CrashPhase) || 'waiting',
        crashPoint: Number(val.crashPoint),
        roundStartedAt: Number(val.roundStartedAt ?? 0),
        flightStartedAt: Number(val.flightStartedAt ?? 0),
        updatedAt: Number(val.updatedAt ?? 0),
        clientId: typeof val.clientId === 'string' ? val.clientId : undefined,
      });
    },
    (err) => {
      if (isPermissionDeniedError(err)) {
        cb(null);
        onClosed();
      }
    }
  );
}

export async function writeCrashOverride(
  roundNumber: number,
  crashPoint: number,
  currentState: CrashCurrent | null
): Promise<void> {
  if (
    currentState &&
    currentState.phase !== 'waiting' &&
    roundNumber <= currentState.roundNumber
  ) {
    throw new Error('Cannot send override for a round already in flight or crashed.');
  }
  await set(ref(db, 'crash/override'), {
    roundNumber,
    crashPoint: Number(crashPoint.toFixed(2)),
    updatedAt: Date.now(),
  });
}

export async function fetchFirebaseActivationCode(
  activationCode: string
): Promise<{ path: string; data: ActivationCodeRecord } | null> {
  const candidatePaths = [
    `codes/airplane_codes/${activationCode}`,
    `codes/apple_codes/${activationCode}`,
  ];
  for (const path of candidatePaths) {
    try {
      const snap = await get(ref(db, path));
      if (snap.exists()) {
        return { path, data: snap.val() as ActivationCodeRecord };
      }
    } catch {
      // Fall back silently if rules restrict codes/ reads
    }
  }
  return null;
}

export async function saveFirebaseActivationCode(
  code: string,
  userId: string,
  expiresAtIso: string
): Promise<void> {
  try {
    await set(ref(db, `codes/airplane_codes/${code}`), {
      is_active: true,
      type: 'airplane',
      expires_at: expiresAtIso,
      created_for: userId,
      created_at: Date.now(),
    });
  } catch {
    // Graceful fallback handled by caller
  }
}
