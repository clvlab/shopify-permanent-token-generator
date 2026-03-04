import http from 'http';
import url from 'url';
import crypto from 'crypto';

const SHOP_DOMAIN = process.env.SHOP || 'your-store-name';
const SCOPES = 'read_products,write_orders'; // Adjust scopes as needed
const REDIRECT_URL = 'http://localhost:3000/callback';

// --- Configuration ---
const config = {
    shop: SHOP_DOMAIN,
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    scopes: SCOPES,
    redirectUri: REDIRECT_URL,
    state: crypto.randomBytes(16).toString('hex'),
};

/**
 * Verifies the HMAC signature sent by Shopify to ensure
 * the request is authentic and hasn't been tampered with.
 */
function verifyHmac(getQuery, secret) {
    const { hmac, ...params } = getQuery;
    // Sort parameters alphabetically and build query string
    const message = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const generatedHash = crypto
        .createHmac('sha256', secret)
        .update(message)
        .digest('hex');

    return generatedHash === hmac;
}

const authUrl = `https://${config.shop}.myshopify.com/admin/oauth/authorize?client_id=${config.clientId}&scope=${config.scopes}&redirect_uri=${config.redirectUri}&state=${config.state}`;

console.log('--- STEP 1: AUTHORIZATION ---');
console.log('Paste this URL into your browser:\n');
console.log(authUrl);
console.log('\nWaiting for Shopify callback...');

http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/callback') {
        const query = parsedUrl.query;

        // 1. Verify State (CSRF Protection)
        if (query.state !== config.state) {
            res.end('Security Error: State mismatch.');
            return;
        }

        // 2. Verify HMAC (Authenticity Check)
        if (!verifyHmac(query, config.clientSecret)) {
            res.end('Security Error: HMAC verification failed.');
            console.error('HMAC mismatch! This request may not be from Shopify.');
            return;
        }

        console.log('--- STEP 2: HMAC VERIFIED ---');

        try {
            // 3. Exchange temporary code for Permanent Token
            const tokenResponse = await fetch(`https://${config.shop}.myshopify.com/admin/oauth/access_token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                    code: query.code
                })
            });

            if (!tokenResponse.ok) {
                const errData = await tokenResponse.json().catch(() => ({}));
                throw Object.assign(new Error('Token exchange failed'), { response: { data: errData } });
            }

            const { access_token, scope } = await tokenResponse.json();

            console.log('\n✅ SUCCESS!');
            console.log('PERMANENT TOKEN:', access_token);
            console.log('AUTHORIZED SCOPES:', scope);

            res.end('Token received! You can close this tab and check your terminal.');
            process.exit(0);
        } catch (error) {
            console.error('Exchange Error:', error.response?.data || error.message);
            res.end('Failed to exchange code for token.');
        }
    }
}).listen(3000);
