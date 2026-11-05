# fx-api

Convenience HTTP client wrapper over FX core's built-in `@/api/` syntax. Provides a clean API for making HTTP requests while preserving FX's zero-async-contamination principle. All methods return FX node proxies (FutureProxy internally).

## Quick start

```ts
import fxApiPlugin from './plugins/fx-api';

const $api = fxApiPlugin(fx, {
  baseUrl: 'https://api.example.com',
  headers: { 'Authorization': 'Bearer token123' }
});

// Also available globally as $api
```

## HTTP methods

```ts
$api.get('/users');
$api.post('/users', { name: 'Alice', email: 'alice@example.com' });
$api.put('/users/1', { name: 'Alice Updated' });
$api.patch('/users/1', { email: 'newemail@example.com' });
$api.delete('/users/1');
$api.fetch('/data', { method: 'GET', headers: { Accept: 'text/csv' } });
```

All methods return an `FXNodeProxy`. Access the result synchronously -- FX handles the async internally via FutureProxy:

```ts
const users = $api.get('/users');
console.log(users.val()); // data available after resolution
```

## Endpoint builder

Create a reusable endpoint handle for a specific URL:

```ts
const usersEndpoint = $api.endpoint('/users');

usersEndpoint.get();
usersEndpoint.post({ name: 'Bob' });
usersEndpoint.put({ name: 'Bob Updated' });
usersEndpoint.delete();
```

## Base URL builder

Create a new API instance with a different base URL:

```ts
const admin = $api.base('https://admin.example.com');
admin.get('/dashboard');
```

## Configuration and defaults

```ts
const customApi = $api.defaults({
  baseUrl: 'https://api.example.com/v2',
  headers: { 'X-Custom': 'value' }
});
```

## Interceptors

### Request interceptors

Transform every outgoing request config before it is sent:

```ts
const authedApi = $api.addRequestInterceptor((config) => {
  config.headers = {
    ...config.headers,
    'Authorization': `Bearer ${getToken()}`
  };
  return config;
});
```

### Response interceptors

Transform responses after they arrive:

```ts
const loggingApi = $api.addResponseInterceptor((response, config) => {
  console.log(`${config.method} ${config.url} ->`, response);
  return response;
});
```

Interceptors are immutable -- each call returns a new API instance with the interceptor added.

## Direct FX access

Escape hatch to use FX's `@/api/` syntax directly:

```ts
const node = $api.fx('/users');
// equivalent to $$('@/users')
```

## Types

```ts
interface HttpArgs {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}

interface APIOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  interceptors?: {
    request?: RequestInterceptor[];
    response?: ResponseInterceptor[];
  };
}

interface EndpointBuilder {
  get(args?): FXNodeProxy;
  post(body?, args?): FXNodeProxy;
  put(body?, args?): FXNodeProxy;
  patch(body?, args?): FXNodeProxy;
  delete(args?): FXNodeProxy;
  fetch(args?): FXNodeProxy;
}
```
