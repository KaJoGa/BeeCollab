# Setup yang dikerjakan owner

Diverifikasi ke dokumentasi resmi pada 2026-10-07 (Neon, Render, Cloudflare). Nama menu di dashboard bisa sedikit berbeda dari tulisan di sini; kalau ada yang tidak cocok, screenshot dan tanya Claude.

## Aturan keamanan (penting)
- **Jangan kirim connection string, API token, atau JWT secret ke chat.** Isi langsung di dashboard Render.
- **Screenshot halaman yang menampilkan password / token harus ditutup dulu bagian rahasianya.** Halaman "Connect" Neon dan halaman token Cloudflare menampilkan secret.
- Kalau ada langkah yang meminta **kartu kredit**, berhenti dan kabari Claude. Sumber yang kubaca bilang semua layanan di sini bisa dipakai tanpa kartu, tapi itu belum dikonfirmasi langsung untuk akunmu.

## Urutan
1. Neon (sekarang) → 2. Cloudflare TURN (sekarang) → 3. JWT secret (sekarang) → 4. Render (buat akun sekarang, **buat service nanti** setelah Claude bilang kode sudah di-push) → 5. Vercel (nanti).

---

## 1. Neon (database)

### A. Halaman "Create your first project" (yang kamu screenshot)
| Field | Isi | Alasan |
|---|---|---|
| Project name | `BeeCollab` | sudah benar |
| Region | **AWS Asia Pacific 1 (Singapore)** | sudah benar, terdekat dengan Indonesia |
| Postgres database | **ON** | ini yang kita pakai |
| Object storage | **OFF** | app tidak menyimpan file |
| Functions | **OFF** | backend jalan di Render |
| AI gateway | **OFF** | tidak dipakai |
| Neon Auth | **OFF** | kita punya login sendiri (JWT + bcrypt); menyalakan ini hanya menambah kerumitan |

Object storage, Functions, dan AI gateway adalah fitur beta Neon yang tidak kita butuhkan. Klik panah kecil di baris "Postgres database" bila ingin melihat opsi versi Postgres. Biarkan default kecuali kamu mau menyamakan dengan lokal (docker-compose kita memakai Postgres 16; versi berbeda tidak masalah untuk app ini). Lalu klik tombol buat project di bagian bawah halaman.

> Batas paket Free (docs Neon): **100 CU-jam per bulan** (≈400 jam pada 0.25 CU), **1 GB storage per project**, database **tidur otomatis setelah 5 menit** tanpa aktivitas dan ini tidak bisa dimatikan di paket Free. Jadi 24/7 tidak mungkin, dan itu memang bukan rencana kita.

### B. Ambil dua connection string
1. Buka project `BeeCollab` → klik tombol **Connect** di bagian atas console.
2. Di jendela "Connect to your branch": pilih branch `main` (default), database `neondb` (default), role default.
3. Ada toggle **Connection pooling**:
   - **ON** (default) → host berisi `-pooler`. **Ini `DATABASE_URL`.** Salin.
   - **OFF** → host tanpa `-pooler`. **Ini `DIRECT_URL`.** Matikan toggle, lalu salin.
4. Edit **kedua** string: hapus bagian `&channel_binding=require` kalau ada, sisakan `?sslmode=require`. (Neon menambahkannya otomatis. Aku belum bisa memastikan driver `pg` yang kita pakai menerimanya dengan baik, jadi lebih aman dibuang. SSL tetap aktif lewat `sslmode=require`.)
5. Simpan keduanya di catatan pribadi (Notepad lokal / password manager). Bentuknya kira-kira:
   ```
   postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

### C. Terapkan struktur tabel ke Neon (sekali saja; setelah Claude bilang siap)
Dijalankan dari komputermu, di folder `bee-collab-backend`, dengan **DIRECT_URL** (bukan pooled):
```powershell
$env:DIRECT_URL = 'PASTE_DIRECT_URL_DI_SINI'
npx prisma migrate deploy
Remove-Item Env:DIRECT_URL
```
Hasil yang diharapkan: `1 migration found` lalu `All migrations have been successfully applied`. Variabel hanya hidup di jendela PowerShell itu, tidak tersimpan ke file.

### D. Tes koneksi dari komputermu sebelum ke Render
Masih di `bee-collab-backend`:
```powershell
$env:DATABASE_URL = 'PASTE_POOLED_URL_DI_SINI'
$env:JWT_SECRET = 'dev'
npm run build
npm run start:prod
```
Buka `http://localhost:3000/health` di browser. Harus muncul `"db":"up"` (percobaan pertama bisa beberapa detik karena Neon sedang bangun). Setelah itu `Ctrl+C` dan `Remove-Item Env:DATABASE_URL, Env:JWT_SECRET`.

✅ Kirim ke Claude: "Neon siap, migration berhasil, /health db up".

---

## 2. Cloudflare TURN (kamu sudah punya akun Cloudflare)
TURN dipakai saat dua peserta tidak bisa tersambung langsung (wifi kampus, data seluler). Ini **bukan** Worker, jadi tidak ada yang di-deploy. Kamu cukup membuat satu "TURN app" untuk mendapatkan dua nilai.

1. Login ke dashboard Cloudflare.
2. Di sidebar kiri pilih **Realtime**.
3. Di bagian **TURN Server**, klik **Create**.
4. Isi nama, misalnya `beecollab-turn`, lalu klik **Create**.
5. Salin dua nilai yang muncul. **Salin sekarang**, karena token API kemungkinan hanya ditampilkan sekali:
   - **Turn Token ID** → nanti jadi `CF_TURN_KEY_ID`
   - **API Token** → nanti jadi `CF_TURN_API_TOKEN` 🔒
6. Simpan keduanya di catatan pribadi.

Hal yang perlu kamu tahu:
- Jatah gratis: **1.000 GB per bulan**, sesudah itu $0,05/GB. Untuk beberapa teman, jauh dari habis, karena TURN hanya dipakai pada koneksi yang gagal P2P.
- Docs Cloudflare tidak menyebut apakah akun perlu menambah metode pembayaran untuk memakai TURN. Kalau dashboard memintanya, **berhenti dan kabari Claude**. Aplikasi tetap bisa jalan tanpa TURN, hanya sebagian koneksi bisa gagal.
- Key ini tidak dipakai langsung oleh browser. Backend kita yang akan memakainya untuk membuat kredensial sementara (maksimal 48 jam) lewat API Cloudflare, lalu memberikan kredensial itu ke browser. Jadi token tidak pernah masuk ke kode frontend. Claude yang membuat kodenya di Fase 2.

✅ Kirim ke Claude: "TURN key sudah dibuat" (tanpa nilainya).

---

## 3. JWT secret
Di PowerShell:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Salin hasilnya ke catatan pribadi. Ini nilai `JWT_SECRET` untuk Render. Jangan pakai ulang dari tutorial lain.

---

## 4. Render (backend)

### A. Buat akun (sekarang)
1. Buka render.com → **Get Started** → daftar dengan **GitHub**.
2. Beri akses ke repo `KaJoGa/BeeCollab` (boleh pilih "Only select repositories").
3. **Jangan buat service dulu.** Kode Fase 1 belum ada di GitHub, dan Render hanya bisa men-deploy yang sudah di-push.

### B. Buat service (nanti, setelah Claude bilang kode sudah di GitHub)
Di dashboard: **New +** → **Web Service** → pilih repo `BeeCollab`. Isi:

| Field | Isi |
|---|---|
| Name | `beecollab-api` (jadi bagian URL) |
| Language | **Node** |
| Branch | `main` |
| Region | **Singapore** bila tersedia untuk Free (sama dengan Neon); kalau tidak, region terdekat |
| Root Directory | `bee-collab-backend` (di bagian Advanced bila tidak terlihat; docs Render: perintah build dan start dijalankan relatif terhadap folder ini) |
| Build Command | `npm install --include=dev && npx prisma generate && npm run build` |
| Start Command | `npm run start:prod` |
| Instance Type | **Free** |

Alasan `--include=dev`: `nest build` butuh `@nestjs/cli` dan `typescript` yang ada di devDependencies; Render bisa menjalankan install dalam mode production yang melewatinya.

**Environment Variables** (bagian Environment / Advanced, tombol Add Environment Variable):

| Key | Value |
|---|---|
| `NODE_VERSION` | `24` (docs Render: ini cara memilih versi Node; default untuk service baru juga 24.x, tapi kita kunci supaya sama dengan lokal) |
| `DATABASE_URL` | Neon **pooled** string (langkah 1B) |
| `DIRECT_URL` | Neon **direct** string |
| `JWT_SECRET` | hasil langkah 3 |
| `JWT_EXPIRES_IN` | `1d` |
| `CF_TURN_KEY_ID` | Turn Token ID (langkah 2) |
| `CF_TURN_API_TOKEN` | API Token (langkah 2) |
| `FRONTEND_ORIGIN` | URL Vercel, contoh `https://beecollab.vercel.app` (tanpa garis miring di akhir; boleh beberapa, dipisah koma). Isi setelah frontend ada, lalu Render akan redeploy sendiri. Kalau kosong, backend menerima semua origin. |

**Jangan** isi `PORT`: Render menyediakannya sendiri (default 10000) dan backend kita sudah membaca `PORT` dan mendengarkan di `0.0.0.0`, yang disyaratkan Render.

Opsional: di **Settings → Health Checks → Edit**, isi path `/health`. Docs Render tidak menyebut apakah instance Free mendukungnya; kalau opsinya tidak ada, abaikan.

Klik **Create Web Service**. Build pertama beberapa menit. Setelah statusnya **Live**, buka `https://NAMA-KAMU.onrender.com/health`. Harus muncul `"db":"up"`.

### C. Hal yang perlu diingat
- Semua service Free berbagi jatah **750 jam per bulan**. Satu service saja, jangan buat yang lain.
- Service **tidur setelah 15 menit** tanpa HTTP request maupun pesan WebSocket, dan bangun lagi (±1 menit) di request pertama. Frontend kita sudah menangani itu dengan banner "Waking up the server".
- Render tidak membatasi lama koneksi WebSocket dan tidak punya idle timeout untuk WebSocket, tapi menyarankan keepalive ping/pong. Socket.io sudah mengirim ping sendiri; kita buktikan dengan call lebih dari 15 menit.
- Setiap push ke `main` memicu deploy otomatis. Saat deploy, semua koneksi WebSocket terputus (jangan push saat ada yang sedang call).

✅ Kirim ke Claude: URL Render (misal `https://beecollab-api.onrender.com`) setelah Live.

---

## 5. Vercel (nanti, kamu sudah pernah)
Hanya hal yang spesifik untuk proyek ini:
- Root Directory: `bee-collab-frontend`
- Environment variable: `NEXT_PUBLIC_API_URL` = URL Render (tanpa garis miring di akhir)
- `NEXT_PUBLIC_*` dimasukkan ke bundle **saat build**. Kalau kamu ubah nilainya, harus **Redeploy**; mengubah saja tidak cukup.

✅ Kirim ke Claude: URL Vercel.

---

## Ringkasan nilai rahasia dan tempatnya
| Nilai | Disimpan di | Kirim ke Claude? |
|---|---|---|
| Neon pooled/direct string | Render env + catatan pribadi | Tidak |
| JWT secret | Render env + catatan pribadi | Tidak |
| Turn Token ID / API Token | Render env + catatan pribadi | Tidak |
| URL Render, URL Vercel | publik | Ya |
