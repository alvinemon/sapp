# PhoneHand @ 2hotatl.com

Remote Android control — phone on SIM, browser on different Wi‑Fi. Relay hosted at **https://2hotatl.com**.

## Use it

1. Open **https://2hotatl.com** in your browser
2. Click **Get pairing code**
3. On Android: install PhoneHand app (relay URL is pre-set to `https://2hotatl.com`)
4. Enter the pairing code → enable touch control → start streaming
5. Phone can stay on **4G/5G** while your PC uses another Wi‑Fi

## Deploy to 2hotatl.com

On your server:

```bash
cd phone-hand
npm install
npm run build
PUBLIC_URL=https://2hotatl.com PORT=3847 npm start
```

Use **nginx** (or Caddy) to proxy your domain to the Node app:

```nginx
server {
    listen 443 ssl http2;
    server_name 2hotatl.com;

    # your SSL certs here

    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

WebSocket path `/ws` uses the same proxy — required for screen streaming.

### Process manager (pm2)

```bash
npm run build
pm2 start dist/server/index.js --name phonehand --env PUBLIC_URL=https://2hotatl.com
pm2 save
```

## Local development

```bash
npm run dev
```

Dev UI runs on `localhost:5173`. The **Android app still uses `https://2hotatl.com`** — deploy server changes there, or temporarily change the URL in the app for testing.

## Build Android APK

```bash
npm run build:apk
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## License

MIT
