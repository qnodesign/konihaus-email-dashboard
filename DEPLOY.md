# Konihaus dashboard on your Synology (behind Tailscale)

The dashboard needs its small Node server (it keeps the AWS keys server-side and reads S3), so a static web
folder won't work. Run it with Node on the NAS and reach it over Tailscale only.

> **Do not put these files in a web-served folder** (the Web Station / `web` share). `server.js` and `.env` would
> become downloadable. Use a normal folder such as `/volume1/docker/konihaus-dashboard/`.

## 1. Read-only AWS user for the dashboard

Create a separate IAM user (not the one your Vercel app uses) with this policy. Replace `YOUR-BUCKET`.
`ListBucket` is needed so a not-yet-created `code-usages.json` shows as "empty" instead of "access denied".

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET/emails.json",
        "arn:aws:s3:::YOUR-BUCKET/blog-emails.json",
        "arn:aws:s3:::YOUR-BUCKET/code-usages.json"
      ] },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::YOUR-BUCKET" }
  ]
}
```

## 2. Copy the app to the NAS

Put `server.js` and `package.json` into `/volume1/docker/konihaus-dashboard/`, then over SSH:

```bash
cd /volume1/docker/konihaus-dashboard
npm install --omit=dev
```

Node 20 or newer is recommended (check with `node -v`).

## 3. Create `.env` in the same folder

```
S3_BUCKET_NAME=YOUR-BUCKET
AWS_REGION=your-region
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
DASHBOARD_PASSWORD=pick-a-long-password
```

Then `chmod 600 .env`. With `DASHBOARD_PASSWORD` set, the browser asks for a login (user `konihaus`, or set `DASHBOARD_USER`).

## 4. Start it at boot

DSM → Control Panel → Task Scheduler → Create → Triggered Task → User-defined script.
Event: Boot-up. Script (find your node path with `which node` over SSH):

```bash
cd /volume1/docker/konihaus-dashboard && /usr/local/bin/node server.js >> dashboard.log 2>&1
```

Select the task and click Run to start it now without rebooting.

## 5. Reach it over Tailscale

**Option A (recommended): `tailscale serve`.** The server keeps listening on `127.0.0.1:3000` and Tailscale
publishes it, with HTTPS, to your tailnet only:

```bash
sudo tailscale serve --bg 3000
```

Open `https://<nas-name>.<your-tailnet>.ts.net`. This needs HTTPS certificates enabled in the Tailscale admin
console (DNS page). If `tailscale` isn't found over SSH, the Synology package keeps it at
`/var/packages/Tailscale/target/bin/tailscale`.

**Option B: listen on the network.** Add `HOST=0.0.0.0` to `.env` and open `http://<nas-tailscale-ip>:3000`.
Then also add a Synology Firewall rule allowing port 3000 only from `100.64.0.0/10` (Tailscale), and never forward
that port on your router.

Don't publish it through a public reverse proxy or port forward: it lists subscriber emails and IP addresses.

## Check

You should see the login prompt, then the Landing page, Blog and Code usages tabs.
The top-right pill must say `S3 · YOUR-BUCKET`. If it says "Local file", the `.env` wasn't picked up.
An "AccessDenied" error means the IAM policy above is missing or wrong.

## Updating

Replace `server.js` on the NAS, then stop and run the Task Scheduler task again.
