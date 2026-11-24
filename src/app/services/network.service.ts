import {
  Injectable,
  NgZone,
  inject
} from '@angular/core';

import {
  Network,
  type ConnectionStatus
} from '@capacitor/network';

import { Capacitor } from '@capacitor/core';

import {
  BehaviorSubject,
  distinctUntilChanged,
  map
} from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NetworkService {

  private readonly ngZone = inject(NgZone);

  // =========================================
  // NETWORK STATE
  // =========================================

  private readonly networkSubject =
    new BehaviorSubject<ConnectionStatus>({
      connected: false,
      connectionType: 'unknown'
    });

  readonly status$ =
    this.networkSubject.asObservable();

  readonly online$ = this.status$.pipe(
    map(status => status.connected),
    distinctUntilChanged()
  );

  private initialized = false;

  private readonly initializationPromise:
    Promise<void>;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor() {

    this.initializationPromise =
      this.initializeNetwork();
  }

  // =========================================
  // INITIALIZE NETWORK
  // =========================================

  private async initializeNetwork(): Promise<void> {

    try {

      // Listen for native and browser network changes.
      await Network.addListener(
        'networkStatusChange',
        (status: ConnectionStatus) => {

          this.updateStatus(status);
        }
      );

      // Retrieve the initial connection status.
      const status = await Network.getStatus();

      this.updateStatus(status);

    } catch (error) {

      console.warn(
        'Network initialization failed:',
        error
      );

      // Browser fallback only.
      if (!Capacitor.isNativePlatform()) {

        this.initializeBrowserFallback();

      } else {

        // Avoid assuming that Android is online
        // when native connectivity cannot be checked.
        this.updateStatus({
          connected: false,
          connectionType: 'unknown'
        });
      }

    } finally {

      this.initialized = true;
    }
  }

  // =========================================
  // BROWSER FALLBACK
  // =========================================

  private initializeBrowserFallback(): void {

    const updateBrowserStatus = () => {

      this.updateStatus({
        connected: navigator.onLine,
        connectionType: navigator.onLine
          ? 'unknown'
          : 'none'
      });
    };

    window.addEventListener(
      'online',
      updateBrowserStatus
    );

    window.addEventListener(
      'offline',
      updateBrowserStatus
    );

    updateBrowserStatus();
  }

  // =========================================
  // UPDATE CONNECTION STATE
  // =========================================

  private updateStatus(
    status: ConnectionStatus
  ): void {

    this.ngZone.run(() => {

      const previous =
        this.networkSubject.value;

      if (
        previous.connected === status.connected &&
        previous.connectionType === status.connectionType
      ) {
        return;
      }

      this.networkSubject.next(status);
    });
  }

  // =========================================
  // WAIT FOR INITIALIZATION
  // =========================================

  async waitForInitialization(): Promise<void> {

    await this.initializationPromise;
  }

  isInitialized(): boolean {

    return this.initialized;
  }

  // =========================================
  // CONNECTION STATUS
  // =========================================

  isOnline(): boolean {

    return this.networkSubject.value.connected;
  }

  isOffline(): boolean {

    return !this.isOnline();
  }

  getStatus(): ConnectionStatus {

    return {
      ...this.networkSubject.value
    };
  }

  getConnectionType():
    ConnectionStatus['connectionType'] {

    return this.networkSubject.value.connectionType;
  }

  // =========================================
  // MANUAL CONNECTION CHECK
  // =========================================

  async refreshStatus(): Promise<ConnectionStatus> {

    await this.waitForInitialization();

    try {

      const status = await Network.getStatus();

      this.updateStatus(status);

    } catch (error) {

      console.warn(
        'Unable to refresh network status:',
        error
      );

      if (!Capacitor.isNativePlatform()) {

        this.updateStatus({
          connected: navigator.onLine,
          connectionType: navigator.onLine
            ? 'unknown'
            : 'none'
        });
      }
    }

    return this.getStatus();
  }
}