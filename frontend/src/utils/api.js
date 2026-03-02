const BASE_URLS = {
    identity: 'http://localhost:8001',
    stock: 'http://localhost:8002',
    order: 'http://localhost:8003',
    kitchen: 'http://localhost:8004',
    notification: 'http://localhost:8005',
};

/**
 * Makes a fetch request and throws on HTTP errors (4xx/5xx).
 * Returns parsed JSON.
 */
async function request(method, service, endpoint, data, token) {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data !== undefined) headers['Content-Type'] = 'application/json';

    const options = { method, headers };
    if (data !== undefined && method !== 'GET' && method !== 'DELETE') {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(`${BASE_URLS[service]}${endpoint}`, options);
    const json = await response.json();

    if (!response.ok) {
        // Attach the parsed JSON so callers can read error messages
        const err = new Error(json.error || json.detail || `HTTP ${response.status}`);
        err.status = response.status;
        err.data = json;
        throw err;
    }

    return json;
}

export const api = {
    get: (service, endpoint, token) => request('GET', service, endpoint, undefined, token),
    post: (service, endpoint, data, token) => request('POST', service, endpoint, data, token),
    patch: (service, endpoint, data, token) => request('PATCH', service, endpoint, data, token),
    delete: (service, endpoint, token) => request('DELETE', service, endpoint, undefined, token),
};
