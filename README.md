# Konihaus Subscribers

Local viewer for the signup lists in your S3 bucket: `emails.json` (landing page) and `blog-emails.json` (blog newsletter). Vanilla JS UI, tiny Node server, binds to `127.0.0.1` only.

## Run

```bash
npm install
cp .env.example .env     # copy S3_BUCKET_NAME, AWS_REGION and AWS keys from your Vercel env
npm start                # → http://localhost:3000
```

- **S3 mode:** active when `S3_BUCKET_NAME` is set. The key needs `s3:GetObject` on both files (a read-only IAM user is recommended; the Vercel app's read/write key also works).
- **Local mode:** with `S3_BUCKET_NAME` empty, reads `./emails.json` and `./blog-emails.json` (sample data included).
- `S3_KEYS` overrides which files are shown.

## Endpoints (local server)

- `GET /api/sources` – mode, bucket, whitelisted files
- `GET /api/file?name=blog-emails.json` – raw file content

Only whitelisted names are readable.
