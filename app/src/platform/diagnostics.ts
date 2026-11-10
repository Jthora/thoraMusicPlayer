import {NativeModules} from 'react-native';

/**
 * JS side of ThoraDiagnostics (native): a persistent, size-capped event log on the phone
 * (Android/data/com.thoraplayer/files/diagnostics/events.jsonl) for errors that happen away
 * from a debugger. Logging never throws.
 */
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

type DiagnosticsModule = {
  log: (level: string, tag: string, message: string, details: Record<string, string> | null) => void;
  getRecentEvents: (limit: number) => Promise<string[]>;
  getLogPath: () => Promise<string | null>;
};

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler | undefined;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

type HermesLike = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

const nativeDiagnostics = NativeModules.ThoraDiagnostics as DiagnosticsModule | undefined;

export function logDiagnostic(
  level: DiagnosticLevel,
  tag: string,
  message: string,
  details?: Record<string, string>,
): void {
  try {
    nativeDiagnostics?.log(level, tag, message, details ?? null);
  } catch {
    // Diagnostics must never become a source of crashes.
  }
}

export function getRecentDiagnostics(limit: number): Promise<string[]> {
  return nativeDiagnostics ? nativeDiagnostics.getRecentEvents(limit) : Promise.resolve([]);
}

export function describeError(error: unknown): {message: string; stack: string} {
  if (error instanceof Error) {
    return {message: `${error.name}: ${error.message}`, stack: error.stack ?? ''};
  }
  if (typeof error === 'string') {
    return {message: error, stack: ''};
  }
  try {
    return {message: JSON.stringify(error) ?? String(error), stack: ''};
  } catch {
    return {message: String(error), stack: ''};
  }
}

/** Fatal errors closer together than this many in the window mean a broken loop: let the app restart. */
const FATAL_STORM_LIMIT = 3;
const FATAL_STORM_WINDOW_MS = 10_000;

let installed = false;
let appReady = false;
let recentFatalTimes: number[] = [];

/** Called once the root UI has mounted; from then on, isolated JS errors don't kill playback. */
export function markAppReady(): void {
  appReady = true;
}

/**
 * Logs every uncaught JS error. Playback runs in this same process, so in release builds an
 * isolated error thrown by an event handler or timer after startup is logged and survived
 * instead of killing the process (and the music). Errors before the UI mounts, and storms of
 * errors, still go to React Native's default handler, which crashes and restarts cleanly.
 */
export function installGlobalErrorLogging(options?: {
  errorUtils?: ErrorUtilsLike;
  hermes?: HermesLike;
  isDev?: boolean;
  now?: () => number;
}): void {
  if (installed) {
    return;
  }
  const errorUtils = options?.errorUtils ?? (globalThis as {ErrorUtils?: ErrorUtilsLike}).ErrorUtils;
  if (!errorUtils) {
    return;
  }
  installed = true;
  const isDev = options?.isDev ?? __DEV__;
  const now = options?.now ?? Date.now;
  const previous = errorUtils.getGlobalHandler();

  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const {message, stack} = describeError(error);
    logDiagnostic(isFatal ? 'fatal' : 'error', 'global', message, {stack, appReady: String(appReady)});

    if (isDev || !isFatal || !appReady) {
      previous?.(error, isFatal);
      return;
    }
    const at = now();
    recentFatalTimes = [...recentFatalTimes.filter(time => at - time < FATAL_STORM_WINDOW_MS), at];
    if (recentFatalTimes.length > FATAL_STORM_LIMIT) {
      logDiagnostic('fatal', 'global', 'Error storm; letting the app restart', {
        count: String(recentFatalTimes.length),
      });
      previous?.(error, isFatal);
    }
  });

  // React Native only tracks unhandled promise rejections in dev builds; log them in release too.
  const hermes = options?.hermes ?? (globalThis as {HermesInternal?: HermesLike}).HermesInternal;
  if (!isDev) {
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        const {message, stack} = describeError(rejection);
        logDiagnostic('warn', 'unhandled-rejection', message, {stack});
      },
      onHandled: () => {},
    });
  }
}

/** Test-only: forget installation state. */
export function resetDiagnosticsForTests(): void {
  installed = false;
  appReady = false;
  recentFatalTimes = [];
}
