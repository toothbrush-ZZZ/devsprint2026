const BASE_URLS = {
    identity: 'http://localhost:8001',
    stock: 'http://localhost:8002',
    order: 'http://localhost:8003',
    notification: 'http://localhost:8005',
};

export const api = {
    async post(service, endpoint, data, token) {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(`${BASE_URLS[service]}${endpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data),
        });
        return response.json();
    },

    async get(service, endpoint, token) {
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(`${BASE_URLS[service]}${endpoint}`, {
            headers,
        });
        return response.json();
    },

    async patch(service, endpoint, data, token) {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(`${BASE_URLS[service]}${endpoint}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(data),
        });
        return response.json();
    }
};
