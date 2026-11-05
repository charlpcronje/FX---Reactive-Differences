// /plugins/fx-safe.ts
/**
 * @fx-plugin fx-safe
 * @fx-global $safe
 * @fx-description Production resilience patterns with circuit breakers and retries
 * @fx-dependencies
 * @fx-provides $safe
 * @fx-version 1.0.0
 *
 * FX Safe Patterns - TypeScript Enhanced Safe Operation Patterns
 * Reactive error handling leveraging FX's node system for resilience
 */

import type { FXCore, FXNodeProxy } from '../fx.v4';

interface CircuitBreakerOptions {
  threshold: number;
  timeout: number;
  resetThreshold: number;
}

interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
  multiplier: number;
  jitter: boolean;
}

interface SafeResult<T = any> {
  success: boolean;
  value?: T;
  error?: string;
  fromCache?: boolean;
  predicted?: boolean;
  isolated?: boolean;
  strategy?: string;
  reason?: string;
  willRetry?: boolean;
  timedOut?: boolean;
  hadError?: boolean;
  usedFallback?: boolean;
}

interface HealerFunction {
  name: string;
  heal: (error: Error) => void;
}

interface AdaptiveStrategy {
  timeout: number;
  retries: number;
  fallback?: any | ((error: Error, context: any) => any);
}

interface AdaptiveStrategies {
  default: AdaptiveStrategy;
  lowResource?: AdaptiveStrategy;
  offline?: AdaptiveStrategy;
  premium?: AdaptiveStrategy;
  nightMode?: AdaptiveStrategy;
  [key: string]: AdaptiveStrategy | undefined;
}

class SafeLogger {
  static log(level: string, message: string, data: any = {}): void {
    console.log(`[FX-SAFE:${level.toUpperCase()}]`, message, data);
  }
  static error(message: string, error: any): void { this.log('error', message, { error }); }
  static warn(message: string, data?: any): void { this.log('warn', message, data); }
  static info(message: string, data?: any): void { this.log('info', message, data); }
}

class CircuitBreaker {
  private fx: FXCore;
  private circuitPath: string;
  private config: CircuitBreakerOptions;

  constructor(fx: FXCore, nodePath: string, options: Partial<CircuitBreakerOptions> = {}) {
    this.fx = fx;
    this.circuitPath = `safe.circuit.${nodePath.replace(/\./g, '_')}`;
    this.config = {
      threshold: 5,
      timeout: 30000,
      resetThreshold: 3,
      ...options
    };

    this.initialize();
  }

  private initialize(): void {
    const stateNode = this.fx.createNodeProxy(this.fx.setPath(`${this.circuitPath}.state`, 'closed', this.fx.root));
    const failuresNode = this.fx.createNodeProxy(this.fx.setPath(`${this.circuitPath}.failures`, 0, this.fx.root));
    const successesNode = this.fx.createNodeProxy(this.fx.setPath(`${this.circuitPath}.successes`, 0, this.fx.root));
    const lastFailureNode = this.fx.createNodeProxy(this.fx.setPath(`${this.circuitPath}.lastFailure`, null, this.fx.root));
  }

  execute<T>(operation: () => T): SafeResult<T> {
    const stateNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.state`, this.fx.root)!);
    const failuresNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.failures`, this.fx.root)!);
    const successesNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.successes`, this.fx.root)!);
    const lastFailureNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.lastFailure`, this.fx.root)!);
    const lastResultNode = this.fx.createNodeProxy(this.fx.setPath(`${this.circuitPath}.lastResult`, null, this.fx.root));

    const state = String(stateNode.val());

    if (state === 'open') {
      const lastFailure = Number(lastFailureNode.val() ?? 0);
      const timeoutPassed = Date.now() - lastFailure > this.config.timeout;

      if (timeoutPassed) {
        stateNode.set('half-open');
      } else {
        const cached = lastResultNode.val() as SafeResult<T> | null;
        return cached || { success: false, error: 'Circuit breaker is open' };
      }
    }

    try {
      const result = operation();

      // Success - reset failure count
      failuresNode.set(0);
      const successes = Number(successesNode.val() ?? 0) + 1;
      successesNode.set(successes);

      // Close circuit if enough successes in half-open state
      if (state === 'half-open' && successes >= this.config.resetThreshold) {
        stateNode.set('closed');
        successesNode.set(0);
      }

      const successResult = { success: true, value: result };
      lastResultNode.set(successResult);
      return successResult;

    } catch (error) {
      const failures = Number(failuresNode.val() ?? 0) + 1;
      failuresNode.set(failures);
      lastFailureNode.set(Date.now());

      // Open circuit if threshold reached
      if (failures >= this.config.threshold) {
        stateNode.set('open');
        successesNode.set(0);
      }

      const errorResult = { success: false, error: (error as Error).message || String(error) };
      lastResultNode.set(errorResult);
      return errorResult;
    }
  }

  isOpen(): boolean {
    const stateNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.state`, this.fx.root)!);
    return stateNode.val() === 'open';
  }

  getStats() {
    const stateNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.state`, this.fx.root)!);
    const failuresNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.failures`, this.fx.root)!);
    const successesNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.circuitPath}.successes`, this.fx.root)!);

    return {
      state: stateNode.val(),
      failures: failuresNode.val(),
      successes: successesNode.val()
    };
  }
}

class RetryHandler {
  private fx: FXCore;
  private retryPath: string;
  private config: RetryOptions;

  constructor(fx: FXCore, nodePath: string, options: Partial<RetryOptions> = {}) {
    this.fx = fx;
    this.retryPath = `safe.retry.${nodePath.replace(/\./g, '_')}`;
    this.config = {
      maxAttempts: 3,
      backoffMs: 1000,
      multiplier: 2,
      jitter: true,
      ...options
    };

    this.initialize();
  }

  private initialize(): void {
    this.fx.setPath(`${this.retryPath}.attempts`, 0, this.fx.root);
    this.fx.setPath(`${this.retryPath}.lastAttempt`, Date.now(), this.fx.root);
    this.fx.setPath(`${this.retryPath}.backoffMs`, this.config.backoffMs, this.fx.root);
    this.fx.setPath(`${this.retryPath}.status`, 'ready', this.fx.root);
  }

  async execute<T>(operation: () => T | Promise<T>): Promise<SafeResult<T>> {
    const attemptsNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.retryPath}.attempts`, this.fx.root)!);
    const statusNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.retryPath}.status`, this.fx.root)!);
    const backoffNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.retryPath}.backoffMs`, this.fx.root)!);
    const lastErrorNode = this.fx.createNodeProxy(this.fx.setPath(`${this.retryPath}.lastError`, null, this.fx.root));

    const attempts = Number(attemptsNode.val() ?? 0);

    if (attempts >= this.config.maxAttempts) {
      statusNode.set('exhausted');
      return { success: false, error: 'Max retry attempts exceeded' };
    }

    attemptsNode.set(attempts + 1);
    statusNode.set('attempting');

    try {
      const result = await operation();
      statusNode.set('success');
      return { success: true, value: result };

    } catch (error) {
      statusNode.set('failed');

      const currentBackoff = Number(backoffNode.val() ?? this.config.backoffMs);
      let nextBackoff = currentBackoff * this.config.multiplier;

      if (this.config.jitter) {
        nextBackoff = nextBackoff * (0.5 + Math.random() * 0.5);
      }

      backoffNode.set(nextBackoff);
      lastErrorNode.set((error as Error).message || String(error));

      const willRetry = attempts + 1 < this.config.maxAttempts;

      if (willRetry) {
        setTimeout(() => {
          this.execute(operation);
        }, currentBackoff);
      }

      return {
        success: false,
        error: (error as Error).message || String(error),
        willRetry
      };
    }
  }

  getStats() {
    const attemptsNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.retryPath}.attempts`, this.fx.root)!);
    const statusNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.retryPath}.status`, this.fx.root)!);
    const backoffNode = this.fx.createNodeProxy(this.fx.resolvePath(`${this.retryPath}.backoffMs`, this.fx.root)!);

    return {
      attempts: attemptsNode.val(),
      status: statusNode.val(),
      backoffMs: backoffNode.val()
    };
  }
}

export class FXSafePlugin {
  private fx: FXCore;

  public readonly name = 'safe';
  public readonly version = '2.0.0';
  public readonly description = 'FX-specific safe operation patterns with reactive error handling';

  constructor(fx: FXCore, options: any = {}) {
    this.fx = fx;
    this.setupPatterns();
    SafeLogger.info('Safe patterns plugin initialized');
  }

  private setupPatterns(): void {
    this.fx.setPath('safe.patterns', {}, this.fx.root);
    this.fx.setPath('safe.circuit', { open: false, failures: 0, lastFailure: null }, this.fx.root);
    this.fx.setPath('safe.retry', {}, this.fx.root);
    this.fx.setPath('safe.timeout', {}, this.fx.root);
    this.fx.setPath('safe.errors', {}, this.fx.root);
  }

  circuit(nodePath: string, options: Partial<CircuitBreakerOptions> = {}): CircuitBreaker {
    return new CircuitBreaker(this.fx, nodePath, options);
  }

  retry(nodePath: string, operation: () => any, options: Partial<RetryOptions> = {}): RetryHandler {
    const handler = new RetryHandler(this.fx, nodePath, options);
    return handler;
  }

  timeout<T>(nodePath: string, operation: () => T, timeoutMs = 5000): SafeResult<T> {
    const timeoutPath = `safe.timeout.${nodePath.replace(/\./g, '_')}`;

    const startTimeNode = this.fx.createNodeProxy(this.fx.setPath(`${timeoutPath}.startTime`, Date.now(), this.fx.root));
    const timeoutMsNode = this.fx.createNodeProxy(this.fx.setPath(`${timeoutPath}.timeoutMs`, timeoutMs, this.fx.root));
    const statusNode = this.fx.createNodeProxy(this.fx.setPath(`${timeoutPath}.status`, 'running', this.fx.root));
    const cachedNode = this.fx.createNodeProxy(this.fx.resolvePath(`${timeoutPath}.cached`, this.fx.root) || this.fx.setPath(`${timeoutPath}.cached`, null, this.fx.root));

    // Check for cached result
    const cached = cachedNode.val() as { timestamp: number; value: T } | null;
    if (cached && cached.timestamp > Date.now() - 60000) {
      return { success: true, value: cached.value, fromCache: true };
    }

    const startTime = Date.now();

    try {
      const result = operation();
      const duration = Date.now() - startTime;

      if (duration > timeoutMs) {
        statusNode.set('timeout');

        if (cached) {
          return { success: true, value: cached.value, fromCache: true, timedOut: true };
        }

        return { success: false, error: `Operation timed out after ${timeoutMs}ms` };
      }

      statusNode.set('success');
      this.fx.setPath(`${timeoutPath}.duration`, duration, this.fx.root);

      // Cache successful result
      cachedNode.set({
        value: result,
        timestamp: Date.now()
      });

      return { success: true, value: result };

    } catch (error) {
      statusNode.set('error');

      if (cached) {
        return { success: true, value: cached.value, fromCache: true, hadError: true };
      }

      return { success: false, error: (error as Error).message || String(error) };
    }
  }

  selfHeal<T>(nodePath: string, operation: () => T, healers: HealerFunction[] = []): SafeResult<T> {
    const healPath = `safe.heal.${nodePath.replace(/\./g, '_')}`;

    const attemptsNode = this.fx.createNodeProxy(this.fx.setPath(`${healPath}.attempts`, [], this.fx.root));
    const healersNode = this.fx.createNodeProxy(this.fx.setPath(`${healPath}.healers`, healers.map(h => h.name), this.fx.root));
    const lastHealNode = this.fx.createNodeProxy(this.fx.setPath(`${healPath}.lastHeal`, null, this.fx.root));

    const attemptWithHealing = (remainingHealers = [...healers]): SafeResult<T> => {
      const attempts = (attemptsNode.val() as any[]) ?? [];

      try {
        const result = operation();

        attempts.push({
          timestamp: Date.now(),
          success: true,
          healer: remainingHealers.length < healers.length ?
            healers[healers.length - remainingHealers.length - 1].name : 'none'
        });
        attemptsNode.set(attempts);

        return { success: true, value: result };

      } catch (error) {
        attempts.push({
          timestamp: Date.now(),
          success: false,
          error: (error as Error).message,
          healer: 'none'
        });
        attemptsNode.set(attempts);

        if (remainingHealers.length > 0) {
          const healer = remainingHealers.shift()!;

          try {
            healer.heal(error as Error);
            lastHealNode.set({
              healer: healer.name,
              error: (error as Error).message,
              timestamp: Date.now()
            });

            return attemptWithHealing(remainingHealers);

          } catch (healError) {
            return attemptWithHealing(remainingHealers);
          }
        }

        return { success: false, error: (error as Error).message || String(error) };
      }
    };

    return attemptWithHealing();
  }

  predict<T>(nodePath: string, operation: () => T, options: { historySize?: number; failureThreshold?: number } = {}): SafeResult<T> {
    const config = {
      historySize: 100,
      failureThreshold: 0.7,
      ...options
    };

    const predictPath = `safe.predict.${nodePath.replace(/\./g, '_')}`;

    const historyNode = this.fx.createNodeProxy(
      this.fx.resolvePath(`${predictPath}.history`, this.fx.root) ||
      this.fx.setPath(`${predictPath}.history`, [], this.fx.root)
    );
    const predictionsNode = this.fx.createNodeProxy(this.fx.setPath(`${predictPath}.predictions`, [], this.fx.root));

    const history = (historyNode.val() as any[]) ?? [];

    // Analyze recent failure patterns
    const recentFailures = history.slice(-20).filter((h: any) => !h.success).length;
    const failureRate = recentFailures / Math.min(20, history.length || 1);

    this.fx.setPath(`${predictPath}.failureRate`, failureRate, this.fx.root);

    const willFail = failureRate > config.failureThreshold;
    this.fx.setPath(`${predictPath}.willFail`, willFail, this.fx.root);

    if (willFail) {
      const lastSuccess = (history.slice() as any[]).reverse().find((h: any) => h.success);

      if (lastSuccess) {
        return {
          success: true,
          value: lastSuccess.result,
          predicted: true,
          reason: `Predicted failure (${(failureRate * 100).toFixed(1)}% recent failure rate)`
        };
      }
    }

    try {
      const result = operation();

      history.push({
        timestamp: Date.now(),
        success: true,
        result: result,
        predicted: willFail
      });

      if (history.length > config.historySize) {
        history.shift();
      }

      historyNode.set(history);

      return { success: true, value: result };

    } catch (error) {
      history.push({
        timestamp: Date.now(),
        success: false,
        error: (error as Error).message,
        predicted: willFail
      });

      if (history.length > config.historySize) {
        history.shift();
      }

      historyNode.set(history);

      return { success: false, error: (error as Error).message || String(error) };
    }
  }

  isolate<T>(nodePath: string, operation: () => T, dependencies: string[] = []): SafeResult<T> {
    const isolatePath = `safe.isolate.${nodePath.replace(/\./g, '_')}`;

    // Check health of dependencies
    const dependencyHealth = dependencies.map(dep => {
      const depErrorsNode = this.fx.createNodeProxy(
        this.fx.resolvePath(`safe.errors.${dep.replace(/\./g, '_')}`, this.fx.root) ||
        this.fx.setPath(`safe.errors.${dep.replace(/\./g, '_')}`, [], this.fx.root)
      );
      const depErrors = (depErrorsNode.val() as any[]) ?? [];
      const recentErrors = depErrors.filter((e: any) => Date.now() - e.timestamp < 60000);

      return {
        dependency: dep,
        healthy: recentErrors.length === 0,
        recentErrors: recentErrors.length
      };
    });

    this.fx.setPath(`${isolatePath}.dependencyHealth`, dependencyHealth, this.fx.root);

    const unhealthyDeps = dependencyHealth.filter(d => !d.healthy);
    if (unhealthyDeps.length > 0) {
      this.fx.setPath(`${isolatePath}.isolated`, true, this.fx.root);
      this.fx.setPath(`${isolatePath}.reason`, `Unhealthy dependencies: ${unhealthyDeps.map(d => d.dependency).join(', ')}`, this.fx.root);

      const cachedNode = this.fx.createNodeProxy(
        this.fx.resolvePath(`${isolatePath}.lastSuccessful`, this.fx.root) ||
        this.fx.setPath(`${isolatePath}.lastSuccessful`, null, this.fx.root)
      );
      const cached = cachedNode.val() as { value: T; timestamp: number } | null;
      if (cached) {
        return {
          success: true,
          value: cached.value,
          isolated: true,
          reason: 'Using cached result due to unhealthy dependencies'
        };
      }
    }

    this.fx.setPath(`${isolatePath}.isolated`, false, this.fx.root);

    try {
      const result = operation();

      this.fx.setPath(`${isolatePath}.lastSuccessful`, {
        value: result,
        timestamp: Date.now()
      }, this.fx.root);

      return { success: true, value: result };

    } catch (error) {
      const nodeErrorsNode = this.fx.createNodeProxy(
        this.fx.resolvePath(`safe.errors.${nodePath.replace(/\./g, '_')}`, this.fx.root) ||
        this.fx.setPath(`safe.errors.${nodePath.replace(/\./g, '_')}`, [], this.fx.root)
      );
      const nodeErrors = (nodeErrorsNode.val() as any[]) ?? [];
      nodeErrors.push({
        timestamp: Date.now(),
        error: (error as Error).message || String(error)
      });
      nodeErrorsNode.set(nodeErrors);

      return { success: false, error: (error as Error).message || String(error) };
    }
  }

  adaptive<T>(nodePath: string, operation: () => T, strategies: AdaptiveStrategies): SafeResult<T> {
    const adaptPath = `safe.adapt.${nodePath.replace(/\./g, '_')}`;

    // Context-aware strategy selection
    const context = {
      timeOfDay: new Date().getHours(),
      userLoad: this.fx.resolvePath('system.load.users', this.fx.root) ?
        Number(this.fx.createNodeProxy(this.fx.resolvePath('system.load.users', this.fx.root)!).val() ?? 0) : 0,
      systemLoad: this.fx.resolvePath('system.load.cpu', this.fx.root) ?
        Number(this.fx.createNodeProxy(this.fx.resolvePath('system.load.cpu', this.fx.root)!).val() ?? 0) : 0,
      networkQuality: this.fx.resolvePath('system.network.quality', this.fx.root) ?
        String(this.fx.createNodeProxy(this.fx.resolvePath('system.network.quality', this.fx.root)!).val() ?? 'good') : 'good',
      userType: this.fx.resolvePath('user.type', this.fx.root) ?
        String(this.fx.createNodeProxy(this.fx.resolvePath('user.type', this.fx.root)!).val() ?? 'regular') : 'regular'
    };

    this.fx.setPath(`${adaptPath}.context`, context, this.fx.root);

    let selectedStrategy = 'default';

    if (context.systemLoad > 80) {
      selectedStrategy = 'lowResource';
    } else if (context.networkQuality === 'poor') {
      selectedStrategy = 'offline';
    } else if (context.userType === 'premium') {
      selectedStrategy = 'premium';
    } else if (context.timeOfDay >= 22 || context.timeOfDay <= 6) {
      selectedStrategy = 'nightMode';
    }

    this.fx.setPath(`${adaptPath}.selectedStrategy`, selectedStrategy, this.fx.root);

    const strategy = strategies[selectedStrategy] || strategies.default;

    try {
      const result = operation();
      return { success: true, value: result, strategy: selectedStrategy };
      
    } catch (error) {
      if (strategy.fallback) {
        const fallbackResult = typeof strategy.fallback === 'function' 
          ? strategy.fallback(error as Error, context)
          : strategy.fallback;
          
        return { 
          success: true, 
          value: fallbackResult, 
          strategy: selectedStrategy,
          usedFallback: true
        };
      }
      
      return { success: false, error: (error as Error).message || String(error), strategy: selectedStrategy };
    }
  }
}

// Export plugin factory
export default function(fx: FXCore, options?: any): FXSafePlugin {
  return new FXSafePlugin(fx, options);
}