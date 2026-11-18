/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import figoLogo from './assets/images/figo_captain_logo_1794959780132.jpg';
import playerIdIcon from './assets/images/player_id_icon_1794853671505.jpg';
import {
  fetchCrashCurrentViaRest,
  fetchFirebaseActivationCode,
  saveFirebaseActivationCode,
  subscribeConnectionState,
  subscribeCrashCurrent,
  subscribeCrashEnabled,
  writeCrashOverride,
  type CrashCurrent,
} from './firebase';

type Screen = 'splash' | 'login' | 'getCode' | 'main';

const FORECAST_GIF_URL = 'https://i.postimg.cc/8zvcY1Mt/m.gif';
const FORECAST_GIF_FALLBACK = '/m.gif';

interface StoredCode {
  code: string;
  is_active: boolean;
  type: 'airplane' | 'apple' | 'apple_promo';
  expires_at: string;
  created_for: string;
  used_attempts?: number;
  total_attempts?: number;
}

interface CustomAlertState {
  open: boolean;
  type: 'success' | 'error';
  title: string;
  message: string;
  codeHighlight?: string;
  reminder?: string;
  buttonText: string;
  onConfirm?: () => void;
}

const LOGO_URL = figoLogo;
const PLAYER_ID_ICON_URL = playerIdIcon;
const PROMO_CODE = 'B99';
const STORAGE_KEY = 'figo_activation_codes';
const SPLASH_DURATION_MS = 3500;

const PLATFORMS = [
  { id: 'Bizbet', label: 'Bizbet', colorClass: 'text-[#ff4500]' },
];

function generateActivationCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [5, 5, 5, 5];
  return segments
    .map((len) => {
      let segment = '';
      for (let i = 0; i < len; i++) {
        segment += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return segment;
    })
    .join('-');
}

function loadStoredCodes(): Record<string, StoredCode> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredCode(entry: StoredCode): void {
  try {
    const existing = loadStoredCodes();
    existing[entry.code] = entry;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // Ignore storage quota errors
  }
}

async function copyTextSafely(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function generateVariedCrashPoint(previousPoint: number | null): number {
  let value: number;
  let attempts = 0;
  do {
    const roll = Math.random();
    if (roll < 0.42) {
      value = 1.15 + Math.random() * 1.34;
    } else if (roll < 0.78) {
      value = 2.5 + Math.random() * 2.49;
    } else if (roll < 0.94) {
      value = 5.0 + Math.random() * 6.99;
    } else {
      value = 12.0 + Math.random() * 16.0;
    }
    value = Math.round(value * 100) / 100;
    attempts++;
  } while (previousPoint !== null && Math.abs(value - previousPoint) < 0.15 && attempts < 6);

  return Math.max(1.1, value);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [splashProgress, setSplashProgress] = useState(0);
  const [logoImgFailed, setLogoImgFailed] = useState(false);
  const [idIconFailed, setIdIconFailed] = useState(false);

  // Firebase RTDB connection state
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);

  // Strict Crash state driven solely by crash/current and crash/enabled via onValue
  const lastShownRoundRef = useRef<number | null>(null);
  const lastClientIdRef = useRef<string | undefined>(undefined);
  const lastOverriddenRoundRef = useRef<number | null>(null);
  const lastOverrideValueRef = useRef<number | null>(null);
  const [crashCurrent, setCrashCurrent] = useState<CrashCurrent | null>(null);
  const [shownRoundNumber, setShownRoundNumber] = useState<number | null>(null);
  const [shownPrediction, setShownPrediction] = useState<string>('0.00');
  const [isDbClosed, setIsDbClosed] = useState<boolean>(false);

  // Login state
  const [selectedPlatform, setSelectedPlatform] = useState('Bizbet');
  const [playerId, setPlayerId] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Connection toast
  const [connectionMessage, setConnectionMessage] = useState('');
  const [showConnectionToast, setShowConnectionToast] = useState(false);
  const toastTimer1Ref = useRef<number | null>(null);
  const toastTimer2Ref = useRef<number | null>(null);

  // Modals
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [customAlert, setCustomAlert] = useState<CustomAlertState>({
    open: false,
    type: 'success',
    title: '',
    message: '',
    buttonText: 'حسنًا',
  });

  // Code Generator state
  const [genPlayerId, setGenPlayerId] = useState('');
  const [preview1, setPreview1] = useState<string | null>(null);
  const [preview2, setPreview2] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [gifSrc, setGifSrc] = useState(FORECAST_GIF_URL);

  // Splash loading bar & transition
  useEffect(() => {
    if (screen !== 'splash') return;

    const progressTick = window.setTimeout(() => {
      setSplashProgress(100);
    }, 60);

    const finishTimer = window.setTimeout(() => {
      setScreen('login');
    }, SPLASH_DURATION_MS);

    return () => {
      window.clearTimeout(progressTick);
      window.clearTimeout(finishTimer);
    };
  }, [screen]);

  // Subscribe to Firebase RTDB connection state globally
  useEffect(() => {
    const unsub = subscribeConnectionState(setIsFirebaseConnected);
    return () => unsub();
  }, []);

  // Strict real-time onValue listeners on crash/enabled and crash/current ONLY
  useEffect(() => {
    if (screen !== 'main') return;

    lastShownRoundRef.current = null;
    lastClientIdRef.current = undefined;
    lastOverriddenRoundRef.current = null;
    lastOverrideValueRef.current = null;
    setShownRoundNumber(null);
    setShownPrediction('0.00');
    setIsDbClosed(false);

    let active = true;
    let enabledFlag = true;
    let currentBlockedFlag = false;
    let lastRealtimePushAt = 0;

    const syncClosedState = () => {
      if (!active) return;
      const closed = !enabledFlag || currentBlockedFlag;
      setIsDbClosed(closed);
      if (closed) {
        lastShownRoundRef.current = null;
        lastClientIdRef.current = undefined;
        lastOverriddenRoundRef.current = null;
        lastOverrideValueRef.current = null;
        setShownRoundNumber(null);
        setShownPrediction('0.00');
        setCrashCurrent(null);
      }
    };

    const handleCrashCurrentData = (data: CrashCurrent | null) => {
      if (!active) return;
      currentBlockedFlag = false;
      syncClosedState();

      if (!enabledFlag || !data) {
        setCrashCurrent(null);
        return;
      }

      setCrashCurrent(data);

      // If a new platform session took over while in waiting, allow refreshing the round
      if (
        data.phase === 'waiting' &&
        data.clientId &&
        lastClientIdRef.current &&
        data.clientId !== lastClientIdRef.current
      ) {
        lastShownRoundRef.current = null;
      }

      // Strict Round-Locking Rule:
      // Update prediction ONLY when phase === "waiting", roundNumber !== lastShownRound,
      // and crashPoint >= 1. Lock all updates during "flight" and "crashed".
      if (
        data.phase === 'waiting' &&
        Number.isInteger(data.roundNumber) &&
        data.roundNumber !== lastShownRoundRef.current &&
        !Number.isNaN(data.crashPoint) &&
        data.crashPoint >= 1
      ) {
        lastShownRoundRef.current = data.roundNumber;
        lastClientIdRef.current = data.clientId;
        setShownRoundNumber(data.roundNumber);
        setShownPrediction(data.crashPoint.toFixed(2));
      }

      // When the current round finishes (crashed), schedule a varied normal/high
      // crashPoint in crash/override for the upcoming unstarted round (roundNumber + 1)
      // so the platform moves away from static/incremental fallback values.
      if (data.phase === 'crashed' && Number.isInteger(data.roundNumber)) {
        const nextRound = data.roundNumber + 1;
        if (lastOverriddenRoundRef.current !== nextRound) {
          lastOverriddenRoundRef.current = nextRound;
          const nextCrashPoint = generateVariedCrashPoint(
            lastOverrideValueRef.current ?? data.crashPoint
          );
          lastOverrideValueRef.current = nextCrashPoint;
          void writeCrashOverride(nextRound, nextCrashPoint, data).catch(() => {
            // Ignore write rejection gracefully if rules disallow overrides
          });
        }
      }
    };

    const unsubEnabled = subscribeCrashEnabled(
      (enabled) => {
        enabledFlag = enabled;
        syncClosedState();
      },
      () => {
        enabledFlag = false;
        syncClosedState();
      }
    );

    const unsubCurrent = subscribeCrashCurrent(
      (data) => {
        lastRealtimePushAt = Date.now();
        handleCrashCurrentData(data);
      },
      () => {
        currentBlockedFlag = true;
        syncClosedState();
      }
    );

    // 300ms REST backup polling only if WebSocket onValue hasn't pushed recently
    let isRestPolling = false;
    const restFallbackTimer = window.setInterval(async () => {
      if (!active || isRestPolling) return;
      if (Date.now() - lastRealtimePushAt < 1500) return;

      isRestPolling = true;
      try {
        const res = await fetchCrashCurrentViaRest();
        if (!active) return;

        if (res.closed) {
          currentBlockedFlag = true;
          syncClosedState();
          return;
        }

        if (res.data) {
          handleCrashCurrentData(res.data);
        }
      } finally {
        isRestPolling = false;
      }
    }, 300);

    return () => {
      active = false;
      window.clearInterval(restFallbackTimer);
      unsubEnabled();
      unsubCurrent();
    };
  }, [screen]);

  // Cleanup connection toast timers
  useEffect(() => {
    return () => {
      if (toastTimer1Ref.current) window.clearTimeout(toastTimer1Ref.current);
      if (toastTimer2Ref.current) window.clearTimeout(toastTimer2Ref.current);
    };
  }, []);

  const handlePlatformSelect = (platformId: string) => {
    setSelectedPlatform(platformId);

    if (toastTimer1Ref.current) window.clearTimeout(toastTimer1Ref.current);
    if (toastTimer2Ref.current) window.clearTimeout(toastTimer2Ref.current);

    setConnectionMessage(`جاري الاتصال بسيرفر ${platformId}...`);
    setShowConnectionToast(true);

    toastTimer1Ref.current = window.setTimeout(() => {
      setConnectionMessage(`تم الاتصال بسيرفر ${platformId}`);
      toastTimer2Ref.current = window.setTimeout(() => {
        setShowConnectionToast(false);
      }, 2000);
    }, 2000);
  };

  const handleCopyPromo = async () => {
    const copied = await copyTextSafely(PROMO_CODE);
    if (copied) {
      setShowCopyModal(true);
    } else {
      setCustomAlert({
        open: true,
        type: 'error',
        title: 'Error',
        message: 'فشل نسخ الكود، يرجى نسخه يدويًا.',
        buttonText: 'حسنًا',
      });
    }
  };

  const handleActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    const trimmedId = playerId.trim();
    const trimmedCode = activationCode.trim();

    if (!trimmedId || !trimmedCode) {
      setCustomAlert({
        open: true,
        type: 'error',
        title: 'Error',
        message: 'يرجى كتابة الـ ID وكود التفعيل',
        buttonText: 'حسنًا',
      });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Activation code is being verified');

    const firebaseMatch = await fetchFirebaseActivationCode(trimmedCode);
    const localCodes = loadStoredCodes();
    const codeData = firebaseMatch?.data ?? localCodes[trimmedCode];

    if (!codeData) {
      setStatusMessage(null);
      setLoginError('كود التفعيل غير صحيح');
      setIsSubmitting(false);
      return;
    }

    if (!codeData.is_active) {
      setStatusMessage(null);
      setLoginError('هذا الكود غير نشط');
      setIsSubmitting(false);
      return;
    }

    if (codeData.type === 'airplane' && codeData.expires_at) {
      const now = Date.now();
      const expiry = new Date(codeData.expires_at).getTime();
      if (now >= expiry) {
        setStatusMessage(null);
        setLoginError('كود التفعيل منتهي الصلاحية');
        setIsSubmitting(false);
        return;
      }
    }

    setStatusMessage(`I am contacting my server...\nPlayer ID: ${trimmedId}`);
    await new Promise((resolve) => window.setTimeout(resolve, 1000));

    setStatusMessage(null);
    setIsSubmitting(false);
    setScreen('main');
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<string | null>>
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      setter(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        setter(ev.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateCode = async () => {
    const trimmedId = genPlayerId.trim();
    if (!trimmedId || !preview1 || !preview2) {
      setCustomAlert({
        open: true,
        type: 'error',
        title: 'Error',
        message: 'يرجى إدخال ID حسابك واختيار الصورتين معًا.',
        buttonText: 'حسنًا',
      });
      return;
    }

    setIsGenerating(true);

    const newCode = generateActivationCode();
    const expiryTime = Date.now() + 10 * 60 * 1000;
    const expiryIso = new Date(expiryTime).toISOString();

    const entry: StoredCode = {
      code: newCode,
      is_active: true,
      type: 'airplane',
      expires_at: expiryIso,
      created_for: trimmedId,
    };

    saveStoredCode(entry);
    await saveFirebaseActivationCode(newCode, trimmedId, expiryIso);

    setIsGenerating(false);
    setCustomAlert({
      open: true,
      type: 'success',
      title: 'KEY',
      message: 'تم إنشاء كود التفعيل الخاص بك وهو:',
      codeHighlight: newCode,
      reminder: 'وتذكر أنه لن يتم تفعيل سيرفر الاسكريبت إلا إذا قمت ببقية الخطوات المطلوبة.',
      buttonText: 'حسنًا',
      onConfirm: async () => {
        await copyTextSafely(newCode);
        setPlayerId(trimmedId);
        setActivationCode(newCode);
        setLoginError('');
        setScreen('login');
      },
    });
  };

  const displayRoundNumber = shownRoundNumber ?? crashCurrent?.roundNumber ?? null;
  const isLogoShrunk = isInputFocused || playerId.length > 0 || activationCode.length > 0;

  return (
    <div className="relative w-full h-full bg-black text-white select-none">
      {/* Status Verification Modal */}
      {statusMessage && (
        <div className="status-modal" role="dialog" aria-modal="true">
          <div className="status-box">
            <div className="spinner" aria-hidden="true" />
            <span className="text-base font-bold whitespace-pre-line text-center">{statusMessage}</span>
          </div>
        </div>
      )}

      {/* Splash Screen */}
      {screen === 'splash' && (
        <div
          className="splash-screen"
          onClick={() => setScreen('login')}
          title="اضغط للمتابعة"
        >
          {!logoImgFailed ? (
            <img
              src={LOGO_URL}
              alt="FIGO Logo"
              className="splash-logo"
              referrerPolicy="no-referrer"
              onError={() => setLogoImgFailed(true)}
            />
          ) : (
            <div className="splash-logo flex items-center justify-center border-4 border-[#ff4500] bg-neutral-950 text-[#ff4500] font-orbitron text-2xl font-bold">
              FIGO
            </div>
          )}
          <h1 className="splash-text font-orbitron tracking-wider">FIGO</h1>
          <div className="loading-bar-container">
            <div
              className="loading-bar-progress"
              style={{
                width: `${splashProgress}%`,
                transition: `width ${SPLASH_DURATION_MS / 1000}s linear`,
              }}
            />
          </div>
        </div>
      )}

      {/* Top Server Status on Login Screen */}
      {screen === 'login' && (
        <div className="top-info-container">
          <div className="top-info-box" dir="ltr">
            SERVER: <span>{isFirebaseConnected ? 'LIVE' : 'CONNECTING'}</span>
          </div>
        </div>
      )}

      {/* Login Screen */}
      {screen === 'login' && (
        <div className="login-screen">
          {!logoImgFailed ? (
            <img
              src={LOGO_URL}
              alt="FIGO Logo"
              className={`page-logo ${isLogoShrunk ? 'shrunk' : ''}`}
              referrerPolicy="no-referrer"
              onError={() => setLogoImgFailed(true)}
            />
          ) : (
            <div
              className={`page-logo flex items-center justify-center bg-neutral-950 text-[#ff4500] font-orbitron font-bold ${
                isLogoShrunk ? 'shrunk text-sm' : 'text-xl'
              }`}
            >
              FIGO
            </div>
          )}

          {/* Promo Code Bar */}
          <div className="promo-code-bar">
            <span dir="ltr">
              Work On Bizbet With Promocode: <b>{PROMO_CODE}</b>
            </span>
            <button
              type="button"
              onClick={handleCopyPromo}
              className="copy-icon-btn"
              aria-label="Copy promocode"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>

          {/* Platforms Selector */}
          <div className="platforms-wrapper">
            <div className="platforms-container">
              <div className="platform-row-box">
                {PLATFORMS.map((platform) => (
                  <label key={platform.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      name="bet_option"
                      checked={selectedPlatform === platform.id}
                      onChange={() => handlePlatformSelect(platform.id)}
                    />
                    <span className={platform.colorClass}>{platform.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Login Form Container */}
          <form onSubmit={handleActivateSubmit} className="login-container">
            <div className="input-wrapper">
              <input
                type="text"
                className="code-input"
                placeholder="Player ID"
                maxLength={10}
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                required
              />
              <div className="input-icon">
                {!idIconFailed ? (
                  <img
                    src={PLAYER_ID_ICON_URL}
                    alt="ID"
                    className="w-6 h-6 object-cover rounded-sm"
                    referrerPolicy="no-referrer"
                    onError={() => setIdIconFailed(true)}
                  />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00ff00" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <circle cx="9" cy="10" r="2" />
                    <path d="M6 16c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5" />
                    <line x1="14" y1="9" x2="18" y2="9" />
                    <line x1="14" y1="13" x2="18" y2="13" />
                  </svg>
                )}
              </div>
            </div>

            <div className="input-wrapper">
              <input
                type="password"
                className="code-input"
                placeholder="Activation Code"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                required
              />
              <div className="input-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M16.5 8.25V6C16.5 3.51472 14.4853 1.5 12 1.5C9.51472 1.5 7.5 3.51472 7.5 6V8.25"
                    stroke="#00ff00"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M19.5 12.75H4.5C3.67157 12.75 3 13.4216 3 14.25V21C3 21.8284 3.67157 22.5 4.5 22.5H19.5C20.3284 22.5 21 21.8284 21 21V14.25C21 13.4216 20.3284 12.75 19.5 12.75Z"
                    stroke="#00ff00"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 17.25V18"
                    stroke="#00ff00"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            {loginError && (
              <div className="text-[#ff4d4d] text-sm font-semibold -mt-1">
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="activate-submit-btn"
            >
              Activate
            </button>
          </form>

          {/* Get Code via Steps Button with CSS Animated Robot */}
          <button
            type="button"
            onClick={() => {
              setLoginError('');
              setScreen('getCode');
            }}
            className="get-code-btn"
          >
            <div className="robot-realistic" aria-hidden="true">
              <div className="head">
                <div className="eye left-eye" />
                <div className="eye right-eye" />
              </div>
              <div className="body" />
              <div className="arm left-arm" />
              <div className="arm right-arm" />
            </div>
            <span>أخذ كود عن طريق خطوات</span>
          </button>
        </div>
      )}

      {/* Code Generator Screen */}
      {screen === 'getCode' && (
        <div className="getcode-screen">
          <div className="futuristic-form-v2">
            <h2 className="form-title-v2">CODE GENERATOR</h2>

            <div className="input-wrapper mb-[30px]">
              <input
                type="text"
                className="code-input"
                placeholder="Player ID"
                maxLength={10}
                value={genPlayerId}
                onChange={(e) => setGenPlayerId(e.target.value)}
                required
              />
              <div className="input-icon">
                {!idIconFailed ? (
                  <img
                    src={PLAYER_ID_ICON_URL}
                    alt="ID"
                    className="w-6 h-6 object-cover rounded-sm"
                    referrerPolicy="no-referrer"
                    onError={() => setIdIconFailed(true)}
                  />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00ff00" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <circle cx="9" cy="10" r="2" />
                    <path d="M6 16c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5" />
                  </svg>
                )}
              </div>
            </div>

            <p className="upload-prompt-v2 font-orbitron">UPLOAD PROOF OF REGISTRATION</p>

            <div className="image-upload-grid-v2">
              <label htmlFor="image-upload-1" className="upload-slot-v2">
                <input
                  id="image-upload-1"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(e, setPreview1)}
                />
                {preview1 && (
                  <div
                    className="upload-preview-v2"
                    style={{ backgroundImage: `url('${preview1}')` }}
                  />
                )}
                <svg
                  className="upload-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </label>

              <label htmlFor="image-upload-2" className="upload-slot-v2">
                <input
                  id="image-upload-2"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(e, setPreview2)}
                />
                {preview2 && (
                  <div
                    className="upload-preview-v2"
                    style={{ backgroundImage: `url('${preview2}')` }}
                  />
                )}
                <svg
                  className="upload-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </label>
            </div>

            <button
              type="button"
              disabled={isGenerating}
              onClick={handleGenerateCode}
              className="generate-button-v2 font-orbitron"
            >
              <span>{isGenerating ? 'GENERATING...' : 'GET MY CODE'}</span>
            </button>

            <button
              type="button"
              onClick={() => setScreen('login')}
              className="mt-4 w-full text-center text-sm text-neutral-400 hover:text-white transition-colors py-2 cursor-pointer"
            >
              العودة إلى تسجيل الدخول
            </button>
          </div>
        </div>
      )}

      {/* Main App Screen — Strict crash/current Round-Locking via Firebase onValue */}
      {screen === 'main' && (
        <div className="main-app-screen">
          <div className="flex justify-center gap-4 w-full mb-4">
            <div className="custom-box border-green">
              <span>ID:</span>
              <span>{playerId}</span>
            </div>
            <div className="custom-box border-blue" dir="ltr">
              <span>Round:</span>
              <span>
                {isDbClosed
                  ? 'CLOSED'
                  : displayRoundNumber !== null
                    ? `#${displayRoundNumber}`
                    : isFirebaseConnected
                      ? 'WAIT'
                      : '...'}
              </span>
            </div>
          </div>

          <div className="flex-grow min-h-0 flex items-center justify-center w-full my-3">
            {isDbClosed ? (
              <div className="px-6 py-5 rounded-2xl border-2 border-[#ff4d4d] bg-red-950/30 text-center max-w-sm">
                <p className="text-[#ff4d4d] font-bold text-lg">
                  قاعدة البيانات مغلقة حالياً، تم إيقاف عرض التوقعات.
                </p>
              </div>
            ) : (
              <div className="relative flex items-center justify-center w-full h-full max-w-[560px]">
                <img
                  src={gifSrc || 'https://i.postimg.cc/8zvcY1Mt/m.gif'}
                  alt="Predictor Animation"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (gifSrc !== FORECAST_GIF_FALLBACK) {
                      setGifSrc(FORECAST_GIF_FALLBACK);
                    }
                  }}
                  className="w-full h-full object-contain block"
                />
                <span
                  className="absolute inset-0 flex items-center justify-center font-orbitron text-4xl sm:text-5xl font-bold text-white tabular-nums drop-shadow-[0_0_12px_rgba(0,0,0,0.95)] pointer-events-none"
                  dir="ltr"
                >
                  {shownPrediction}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-4 w-full">
            <button
              type="button"
              onClick={handleCopyPromo}
              className="main-promo-box cursor-pointer hover:bg-[#ff4500]/20 transition-colors"
              dir="ltr"
            >
              Promocode :- <span className="promo-code-highlight">{PROMO_CODE}</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Server Connection Toast */}
      {connectionMessage && (
        <div
          className="connection-status-toast"
          style={{ opacity: showConnectionToast ? 1 : 0, pointerEvents: 'none' }}
        >
          {connectionMessage}
        </div>
      )}

      {/* Copy Promo Modal */}
      {showCopyModal && (
        <div className="copy-modal-overlay" role="dialog" aria-modal="true">
          <div className="copy-modal-content">
            <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
              <circle className="checkmark__circle" cx="26" cy="26" r="25" fill="none" />
              <path className="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
            </svg>
            <h3 className="modal-title">تم نسخ البروموكود بنجاح!</h3>
            <p className="modal-text">
              لكي يعمل معك الاسكريبت بشكل صحيح، يجب عليك انشاء حساب <b>جديد</b> بالبروموكود الخاص بنا وهو{' '}
              <span className="promo-highlight">{PROMO_CODE}</span>.
            </p>
            <div className="modal-buttons">
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="modal-button primary"
              >
                عملت كدا بالفعل
              </button>
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="modal-button secondary"
              >
                سوف أعمل الآن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal (Error / Generated Key) */}
      {customAlert.open && (
        <div className="custom-alert-overlay" role="dialog" aria-modal="true">
          <div className="alert-modal-content">
            <div className={`alert-modal-header ${customAlert.type}`}>{customAlert.title}</div>
            <div className="alert-modal-body">
              <p>{customAlert.message}</p>
              {customAlert.codeHighlight && (
                <div className="code-highlight">{customAlert.codeHighlight}</div>
              )}
              {customAlert.reminder && (
                <div className="reminder">{customAlert.reminder}</div>
              )}
            </div>
            <div className="alert-modal-footer">
              <button
                type="button"
                onClick={() => {
                  const cb = customAlert.onConfirm;
                  setCustomAlert((prev) => ({ ...prev, open: false }));
                  if (cb) cb();
                }}
                className={`alert-modal-button ${customAlert.type}`}
              >
                {customAlert.buttonText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
